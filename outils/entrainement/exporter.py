"""Exporte le modele de la Collecte en ONNX pour le moteur sans Python.

Trois etapes, puis un controle :

1. le vocabulaire est reduit aux jetons ecrits avec les seuls caracteres que l'ocr sait rendre :
   112 403 sur 250 002. Le texte lu ne contient que ces caracteres, donc aucun autre jeton ne
   peut servir a le decouper, et le decoupage reste celui du vocabulaire complet ;
2. le modele est exporte en ONNX ;
3. ses poids sont ramenes a 8 bits : ceux des multiplications seuls (MatMulNBits), les calculs
   restant en flottant, et ceux des embeddings. Quantifier aussi les activations, comme le fait
   la quantification dynamique, coute plus de 3 points de parite a LiLT ;
4. le controle : sur les mots que l'ocr a vraiment lus au banc, l'etiquette de chaque mot doit
   etre celle que rend PyTorch dans au moins 99,5 % des cas. Sinon rien n'est ecrit.

    npm run exporter-modele
    npm run exporter-modele -- --modele modeles/lilt-alambic --sortie modeles/lilt-alambic-onnx
"""

import argparse
import json
import shutil
import tempfile
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
import onnx
from onnxruntime.quantization import QuantType, quantize_dynamic
from onnxruntime.quantization.matmul_nbits_quantizer import (
    DefaultWeightOnlyQuantConfig,
    MatMulNBitsQuantizer,
)
from tokenizers import Tokenizer
from transformers import AutoTokenizer, LiltForTokenClassification, PreTrainedTokenizerFast

ICI = Path(__file__).parent
DEPOT = ICI.parent.parent

# Les fenetres du sidecar de la Collecte, a l'identique.
LONGUEUR_MAX_TOKENS = 512
CHEVAUCHEMENT_TOKENS = 128
BOITE_VIDE = [0, 0, 0, 0]
ETIQUETTE_EXTERIEURE = 'O'

PARITE_MINIMALE = 0.995

# Poids des multiplications sur 8 bits, par blocs de 32 : la precision de reference de
# MatMulNBits, ou 4 bits perdent 2 points de parite.
BITS = 8
TAILLE_BLOC = 32

# Le dictionnaire de l'ocr : les caracteres que le texte lu peut contenir.
DICTIONNAIRE_OCR = DEPOT / 'packages/condensation/modeles/dictionnaire.txt'

# Les exports du banc : les mots tels que le service les envoie au modele (texte et boite 0-1000).
EXPORTS = [DEPOT / 'outils/jeu/banc-test/sorties', DEPOT / 'corpus/sorties']

ESPACE_SENTENCEPIECE = '▁'


def jetons_gardes(tokenizer):
    caracteres = set(DICTIONNAIRE_OCR.read_text().split('\n')) - {''}
    caracteres.add(ESPACE_SENTENCEPIECE)
    gardes = set(tokenizer.all_special_ids)
    for jeton, identifiant in tokenizer.get_vocab().items():
        if jeton and all(caractere in caracteres for caractere in jeton):
            gardes.add(identifiant)
    return sorted(gardes)


def tokenizer_reduit(tokenizer, gardes, dossier):
    """Le meme tokenizer, avec le vocabulaire reduit et des ids renumerotes dans l'ordre."""
    brut = json.loads(tokenizer.backend_tokenizer.to_str())
    nouvel_id = {ancien: nouveau for nouveau, ancien in enumerate(gardes)}
    brut['model']['vocab'] = [brut['model']['vocab'][ancien] for ancien in gardes]
    brut['model']['unk_id'] = nouvel_id[brut['model']['unk_id']]
    for ajoute in brut['added_tokens']:
        ajoute['id'] = nouvel_id[ajoute['id']]
    for special in brut['post_processor']['special_tokens'].values():
        special['ids'] = [nouvel_id[ancien] for ancien in special['ids']]
    rapide = PreTrainedTokenizerFast(
        tokenizer_object=Tokenizer.from_str(json.dumps(brut)),
        bos_token='<s>', eos_token='</s>', unk_token='<unk>', sep_token='</s>',
        cls_token='<s>', pad_token='<pad>', mask_token='<mask>',
        model_max_length=LONGUEUR_MAX_TOKENS,
    )
    rapide.save_pretrained(dossier)
    return rapide


def modele_reduit(modele, gardes):
    embeddings = modele.lilt.embeddings.word_embeddings
    reduit = torch.nn.Embedding(len(gardes), embeddings.embedding_dim, padding_idx=embeddings.padding_idx)
    reduit.weight.data = embeddings.weight.data[gardes].clone()
    modele.lilt.embeddings.word_embeddings = reduit
    modele.config.vocab_size = len(gardes)
    return modele


def exporter_onnx(modele, chemin):
    exemple = (
        torch.ones((1, 8), dtype=torch.long),
        torch.zeros((1, 8, 4), dtype=torch.long),
        torch.ones((1, 8), dtype=torch.long),
    )
    torch.onnx.export(
        modele, exemple, str(chemin),
        input_names=['input_ids', 'bbox', 'attention_mask'],
        output_names=['logits'],
        dynamic_axes={
            'input_ids': {0: 'fenetres', 1: 'jetons'},
            'bbox': {0: 'fenetres', 1: 'jetons'},
            'attention_mask': {0: 'fenetres', 1: 'jetons'},
            'logits': {0: 'fenetres', 1: 'jetons'},
        },
        opset_version=17,
        dynamo=False,
    )


def quantifier(source, cible):
    reglage = DefaultWeightOnlyQuantConfig(
        block_size=TAILLE_BLOC, is_symmetric=True, accuracy_level=4, bits=BITS
    )
    multiplications = MatMulNBitsQuantizer(
        onnx.load(str(source)), block_size=TAILLE_BLOC, is_symmetric=True, algo_config=reglage
    )
    multiplications.process()
    intermediaire = source.with_name('modele-nbits.onnx')
    multiplications.model.save_model_to_file(str(intermediaire), use_external_data_format=False)
    # Les embeddings ne servent qu'a une lecture de table : leurs poids sur 8 bits n'introduisent
    # aucun calcul quantifie.
    quantize_dynamic(
        str(intermediaire), str(cible), weight_type=QuantType.QInt8, op_types_to_quantize=['Gather']
    )
    source.unlink()
    intermediaire.unlink()


def fenetres(tokenizer, textes, boites):
    encodage = tokenizer(
        textes, is_split_into_words=True, truncation=True, max_length=LONGUEUR_MAX_TOKENS,
        stride=CHEVAUCHEMENT_TOKENS, return_overflowing_tokens=True, padding=True,
        return_tensors='np',
    )
    ids_mots = [encodage.word_ids(batch_index=f) for f in range(encodage['input_ids'].shape[0])]
    bbox = np.array(
        [[BOITE_VIDE if i is None else boites[i] for i in ids] for ids in ids_mots], dtype=np.int64
    )
    return encodage['input_ids'].astype(np.int64), bbox, encodage['attention_mask'].astype(np.int64), ids_mots


def premieres_etiquettes(logits, ids_mots, nombre):
    """Le premier jeton de chaque mot, dans la premiere fenetre ou il apparait."""
    etiquettes = [None] * nombre
    for fenetre, ids in enumerate(ids_mots):
        for position, id_mot in enumerate(ids):
            if id_mot is not None and etiquettes[id_mot] is None:
                etiquettes[id_mot] = int(np.argmax(logits[fenetre, position]))
    return etiquettes


def recus_du_banc():
    for dossier in EXPORTS:
        for fichier in sorted(dossier.glob('*--collecte.json')):
            mots = json.loads(fichier.read_text())['mots']
            if mots:
                yield [m['texte'] for m in mots], [m['boite'] for m in mots]


def parite(tokenizer, modele, tokenizer_onnx, session):
    accords = total = 0
    duree_torch = duree_onnx = 0.0
    for textes, boites in recus_du_banc():
        ids, bbox, masque, ids_mots = fenetres(tokenizer, textes, boites)
        debut = time.perf_counter()
        with torch.inference_mode():
            logits = modele(
                input_ids=torch.from_numpy(ids), bbox=torch.from_numpy(bbox),
                attention_mask=torch.from_numpy(masque),
            ).logits.numpy()
        duree_torch += time.perf_counter() - debut
        attendues = premieres_etiquettes(logits, ids_mots, len(textes))

        ids, bbox, masque, ids_mots = fenetres(tokenizer_onnx, textes, boites)
        debut = time.perf_counter()
        logits = session.run(None, {'input_ids': ids, 'bbox': bbox, 'attention_mask': masque})[0]
        duree_onnx += time.perf_counter() - debut
        obtenues = premieres_etiquettes(logits, ids_mots, len(textes))

        accords += sum(a == o for a, o in zip(attendues, obtenues))
        total += len(textes)
    return accords / total, total, duree_torch, duree_onnx


def principal():
    parseur = argparse.ArgumentParser()
    parseur.add_argument('--modele', default=str(ICI / 'modeles/lilt-alambic'))
    parseur.add_argument('--sortie', default=str(ICI / 'modeles/lilt-alambic-onnx'))
    parseur.add_argument('--ecraser', action='store_true')
    # Pour isoler ce qui coute en parite : chacune des deux reductions se mesure seule.
    parseur.add_argument('--sans-reduction', action='store_true')
    parseur.add_argument('--sans-quantification', action='store_true')
    arguments = parseur.parse_args()

    sortie = Path(arguments.sortie)
    if sortie.exists() and not arguments.ecraser:
        raise SystemExit(f'{sortie} existe deja : --ecraser pour le remplacer.')

    # Le drapeau du sidecar : le tokenizer de LiLT n'a rien a corriger, on le charge tel quel.
    tokenizer = AutoTokenizer.from_pretrained(
        arguments.modele, model_max_length=LONGUEUR_MAX_TOKENS, fix_mistral_regex=False
    )
    modele = LiltForTokenClassification.from_pretrained(arguments.modele).eval()
    gardes = (
        list(range(len(tokenizer)))
        if arguments.sans_reduction
        else jetons_gardes(tokenizer)
    )
    print(f'vocabulaire : {len(gardes)} jetons gardes sur {len(tokenizer)}')

    with tempfile.TemporaryDirectory() as brouillon:
        brouillon = Path(brouillon)
        tokenizer_onnx = tokenizer_reduit(tokenizer, gardes, brouillon)
        reduit = modele_reduit(LiltForTokenClassification.from_pretrained(arguments.modele).eval(), gardes)
        exporter_onnx(reduit, brouillon / 'modele-fp32.onnx')
        if arguments.sans_quantification:
            (brouillon / 'modele-fp32.onnx').rename(brouillon / 'modele.onnx')
        else:
            quantifier(brouillon / 'modele-fp32.onnx', brouillon / 'modele.onnx')

        reglages = ort.SessionOptions()
        reglages.intra_op_num_threads = 4
        session = ort.InferenceSession(str(brouillon / 'modele.onnx'), reglages)
        accord, mots, duree_torch, duree_onnx = parite(tokenizer, modele, tokenizer_onnx, session)
        taille = (brouillon / 'modele.onnx').stat().st_size / 1e6
        print(f'parite : {accord:.4%} des {mots} mots ; {taille:.0f} Mo ; '
              f'torch {duree_torch:.1f} s, onnx {duree_onnx:.1f} s')
        if accord < PARITE_MINIMALE:
            raise SystemExit(f'Parite sous {PARITE_MINIMALE:.1%} : rien n\'est ecrit.')

        # La table des etiquettes du modele, la seule chose de sa config que le moteur lit.
        etiquettes = {int(i): e for i, e in modele.config.id2label.items()}
        (brouillon / 'etiquettes.json').write_text(
            json.dumps([etiquettes[i] for i in range(len(etiquettes))], ensure_ascii=False) + '\n'
        )
        if sortie.exists():
            shutil.rmtree(sortie)
        shutil.copytree(brouillon, sortie)
    print(f'ecrit dans {sortie}')


if __name__ == '__main__':
    principal()
