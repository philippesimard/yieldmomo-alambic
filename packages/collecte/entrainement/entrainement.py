# Fine-tuning de LiLT sur le jeu de recus quebecois annotes, pour l'etape Collecte.
#
# Le checkpoint en service (CORD, anglais/indonesien) etiquette en zero-shot : il lit les prix
# a peu pres et ignore tout ce qui est quebecois (TPS, TVQ, INTERAC, marchands d'ici). Ce
# script en produit un qui a vu le domaine, dans le format exact que le sidecar charge.
#
#   .venv/bin/python entrainement.py --jeu <dossier-dataset>
#
# Rien ici ne tourne en production : l'entrainement est un outil de poste, le service ne fait
# que charger le dossier produit (MODELE_COLLECTE).
import argparse
import json
import random
import sys
import time
from pathlib import Path

import torch
from transformers import LiltForTokenClassification, XLMRobertaTokenizerFast, get_scheduler

from donnees import charger_split, construire_etiquettes
from execution import assembler_lot, choisir_appareil, decouper_en_fenetres, predire
from mesures import formater, mesurer

# LiLT multilingue (XLM-R) : le tokenizer d'un modele anglais decoupe mal « Épicerie » et
# « Métro », et un recu quebecois en est plein.
BASE_PAR_DEFAUT = 'SCUT-DLVCLab/lilt-infoxlm-base'

# La fenetre du modele. Les positions apprises s'arretent la, on ne peut pas l'augmenter.
LONGUEUR_MAX = 512

# Contexte partage entre deux fenetres d'un meme recu : un recu long garde de quoi lire son
# pied de ticket.
CHEVAUCHEMENT = 128

# Les embeddings de mots pesent 192 M des 284 M parametres du modele. Les geler divise par
# quatre la memoire de l'optimiseur, ce qui fait tenir l'entrainement sur une machine de 8 Go,
# et ne coute rien ici : le vocabulaire est fixe, c'est la geometrie et la tete qui apprennent.
# Les activations gardees pour la retropropagation sont ce qui sature une machine de 8 Go :
# LiLT fait tourner deux flux (texte et geometrie), et a 512 tokens les seules matrices
# d'attention pesent plus d'un Go. On ne les garde donc pas, on les recalcule — environ 30 %
# de temps en plus, et la memoire passe de 6,4 a 2,1 Go, la seule difference qui compte quand
# l'alternative est de paginer.
#
# use_reentrant=False est obligatoire ici : en mode reentrant, un segment dont l'entree ne
# demande pas de gradient (nos embeddings sont geles) n'en produit aucun, et l'entrainement
# tourne a vide sans rien signaler.
CHECKPOINTING = {'use_reentrant': False}

# Au-dela, un gradient est une instabilite et non un apprentissage.
NORME_MAX_GRADIENT = 1.0

PROPORTION_ECHAUFFEMENT = 0.06

# Une vingtaine de lignes de progression par epoque, quelle que soit la taille du passage : un
# intervalle fixe ne dirait rien sur un essai de dix recus et noierait une epoque complete.
LIGNES_PAR_EPOQUE = 20


def analyser_arguments():
    parseur = argparse.ArgumentParser()
    parseur.add_argument('--jeu', required=True, help='dossier du dataset (train/valid/test)')
    parseur.add_argument('--base', default=BASE_PAR_DEFAUT)
    parseur.add_argument('--sortie', default='modeles/lilt-alambic')
    parseur.add_argument('--epoques', type=int, default=5)
    parseur.add_argument('--lot', type=int, default=1)
    parseur.add_argument('--accumulation', type=int, default=16)
    parseur.add_argument('--taux', type=float, default=5e-5)
    parseur.add_argument('--graine', type=int, default=42)
    parseur.add_argument('--appareil', default='auto')
    parseur.add_argument('--limite', type=int, default=0, help='n recus par split, 0 = tout')
    parseur.add_argument('--degeler-embeddings', action='store_true')
    parseur.add_argument('--sans-checkpointing', action='store_true')
    arguments = parseur.parse_args()
    arguments.longueur = LONGUEUR_MAX
    arguments.chevauchement = CHEVAUCHEMENT
    return arguments


def preparer_modele(base, etiquettes, geler_embeddings, checkpointing):
    modele = LiltForTokenClassification.from_pretrained(
        base,
        num_labels=len(etiquettes),
        id2label={numero: nom for numero, nom in enumerate(etiquettes)},
        label2id={nom: numero for numero, nom in enumerate(etiquettes)},
    )
    if geler_embeddings:
        modele.lilt.embeddings.word_embeddings.weight.requires_grad_(False)
    if checkpointing:
        modele.gradient_checkpointing_enable(gradient_checkpointing_kwargs=CHECKPOINTING)
    return modele


def entrainer_une_epoque(modele, optimiseur, planificateur, fenetres, id_bourrage, options, appareil):
    modele.train()
    somme = 0.0
    lots = 0
    debut = time.monotonic()
    total_lots = max(1, -(-len(fenetres) // options.lot))
    intervalle = max(1, total_lots // LIGNES_PAR_EPOQUE)
    optimiseur.zero_grad(set_to_none=True)

    for depart in range(0, len(fenetres), options.lot):
        tranche = [fenetre for _, fenetre in fenetres[depart : depart + options.lot]]
        lot = assembler_lot(tranche, id_bourrage)
        lot = {cle: valeur.to(appareil) for cle, valeur in lot.items()}

        # Le cout est divise par l'accumulation : sans cela, accumuler huit lots multiplierait
        # le pas par huit au lieu de simuler un lot huit fois plus grand.
        cout = modele(**lot).loss / options.accumulation
        cout.backward()

        somme += cout.detach().item() * options.accumulation
        lots += 1
        if lots % options.accumulation == 0:
            torch.nn.utils.clip_grad_norm_(modele.parameters(), NORME_MAX_GRADIENT)
            optimiseur.step()
            planificateur.step()
            optimiseur.zero_grad(set_to_none=True)
        if lots % intervalle == 0 or lots == total_lots:
            vues = min(lots * options.lot, len(fenetres))
            vitesse = vues / (time.monotonic() - debut)
            reste = (len(fenetres) - vues) / vitesse
            print(
                f'  lot {lots:>5}/{total_lots}  {vues:>5}/{len(fenetres)} fenetres'
                f'  cout {somme / lots:.4f}  {vitesse:.2f} fen/s  reste {reste / 60:.1f} min'
            )

    # Un reliquat de lots accumules sans pas d'optimisation serait du calcul jete.
    if lots % options.accumulation != 0:
        torch.nn.utils.clip_grad_norm_(modele.parameters(), NORME_MAX_GRADIENT)
        optimiseur.step()
        planificateur.step()
        optimiseur.zero_grad(set_to_none=True)

    return somme / max(1, lots)


def principal():
    # Redirige vers un fichier, python bufferise par bloc : l'entrainement dure des heures et
    # sa progression n'a de valeur que si elle sort au fil de l'eau.
    sys.stdout.reconfigure(line_buffering=True)

    options = analyser_arguments()
    random.seed(options.graine)
    torch.manual_seed(options.graine)

    appareil = choisir_appareil(options.appareil)
    etiquettes = construire_etiquettes()
    index_etiquettes = {nom: numero for numero, nom in enumerate(etiquettes)}

    entrainement = charger_split(options.jeu, 'train', options.limite)
    validation = charger_split(options.jeu, 'valid', options.limite)
    print(f'appareil {appareil} | {len(etiquettes)} etiquettes')
    print(f'{len(entrainement)} recus d entrainement, {len(validation)} de validation')

    tokenizer = XLMRobertaTokenizerFast.from_pretrained(options.base)
    modele = preparer_modele(
        options.base,
        etiquettes,
        not options.degeler_embeddings,
        not options.sans_checkpointing,
    ).to(appareil)
    entrainables = [p for p in modele.parameters() if p.requires_grad]
    print(f'parametres entraines : {sum(p.numel() for p in entrainables) / 1e6:.1f} M')

    fenetres = decouper_en_fenetres(
        tokenizer, entrainement, index_etiquettes, options.longueur, options.chevauchement
    )
    print(f'{len(fenetres)} fenetres d entrainement')

    pas_par_epoque = max(1, len(fenetres) // (options.lot * options.accumulation))
    pas_total = pas_par_epoque * options.epoques
    optimiseur = torch.optim.AdamW(entrainables, lr=options.taux, weight_decay=0.01)
    planificateur = get_scheduler(
        'linear',
        optimiseur,
        num_warmup_steps=int(pas_total * PROPORTION_ECHAUFFEMENT),
        num_training_steps=pas_total,
    )

    sortie = Path(options.sortie)
    meilleur = -1.0
    for epoque in range(1, options.epoques + 1):
        print(f'\n--- epoque {epoque}/{options.epoques} ---', flush=True)
        random.shuffle(fenetres)
        debut = time.monotonic()
        cout = entrainer_une_epoque(
            modele, optimiseur, planificateur, fenetres, tokenizer.pad_token_id, options, appareil
        )
        duree = time.monotonic() - debut

        print('mesure sur la validation...')
        predictions = predire(
            modele, tokenizer, validation, index_etiquettes, etiquettes, options, appareil
        )
        mesure = mesurer([recu['etiquettes'] for recu in validation], predictions)
        print(f'cout moyen {cout:.4f} | epoque entrainee en {duree / 60:.1f} min')
        print(formater(mesure), flush=True)

        # Seul le meilleur passage sur la validation est conserve : les epoques suivantes
        # peuvent surapprendre, et c'est ce dossier que le sidecar chargera.
        if mesure['global']['f1'] > meilleur:
            meilleur = mesure['global']['f1']
            sortie.mkdir(parents=True, exist_ok=True)
            modele.save_pretrained(sortie)
            tokenizer.save_pretrained(sortie)
            (sortie / 'mesures-validation.json').write_text(
                json.dumps({'epoque': epoque, **mesure}, indent=2), encoding='utf-8'
            )
            print(f'checkpoint conserve dans {sortie} (F1 entites {meilleur:.4f})', flush=True)

    print(f'\nmeilleur F1 entites en validation : {meilleur:.4f}')


if __name__ == '__main__':
    principal()
