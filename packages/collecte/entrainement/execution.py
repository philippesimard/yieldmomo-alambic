# Ce que l'entrainement et l'evaluation font tous les deux : choisir l'appareil, assembler un
# lot, et rendre une etiquette par mot a partir des fenetres du modele.
import torch

from donnees import ETIQUETTE_EXTERIEURE, ETIQUETTE_IGNOREE, encoder

# Le bourrage prend l'identifiant de padding du tokenizer, un masque a zero, la boite vide et
# l'etiquette ignoree : rien de tout cela ne contribue ni a la sortie ni au cout.
BOITE_VIDE = [0, 0, 0, 0]

# Les longueurs sont arrondies au palier : sur MPS, chaque forme de tenseur inedite fait
# recompiler le graphe, et un lot par longueur exacte en produirait des centaines. Huit
# paliers suffisent a couvrir la fenetre du modele.
PALIER_LONGUEUR = 64


def choisir_appareil(demande):
    if demande != 'auto':
        return torch.device(demande)
    if torch.cuda.is_available():
        return torch.device('cuda')
    if torch.backends.mps.is_available():
        return torch.device('mps')
    return torch.device('cpu')


def assembler_lot(fenetres, id_bourrage):
    plus_longue = max(len(fenetre['input_ids']) for fenetre in fenetres)
    longueur = min(512, -(-plus_longue // PALIER_LONGUEUR) * PALIER_LONGUEUR)
    # Bourrer au palier au-dessus de la plus longue du lot, et non a la fenetre du modele : la
    # plupart des recus font moins de 400 tokens, et bourrer a 512 ferait payer du calcul pour
    # rien.
    remplir = lambda suite, valeur: suite + [valeur] * (longueur - len(suite))
    return {
        'input_ids': torch.tensor(
            [remplir(f['input_ids'], id_bourrage) for f in fenetres], dtype=torch.long
        ),
        'attention_mask': torch.tensor(
            [remplir(f['attention_mask'], 0) for f in fenetres], dtype=torch.long
        ),
        'bbox': torch.tensor([remplir(f['bbox'], BOITE_VIDE) for f in fenetres], dtype=torch.long),
        'labels': torch.tensor(
            [remplir(f['labels'], ETIQUETTE_IGNOREE) for f in fenetres], dtype=torch.long
        ),
    }


def decouper_en_fenetres(tokenizer, recus, index_etiquettes, longueur_max, chevauchement):
    fenetres = []
    for numero, recu in enumerate(recus):
        for fenetre in encoder(tokenizer, recu, index_etiquettes, longueur_max, chevauchement):
            fenetres.append((numero, fenetre))
    return fenetres


@torch.inference_mode()
def predire(modele, tokenizer, recus, index_etiquettes, etiquettes, options, appareil):
    # Meme regle qu'au sidecar : le premier sous-token du mot, dans la premiere fenetre ou il
    # apparait. La mesure porte donc sur ce que la Collecte lira vraiment.
    modele.eval()
    fenetres = decouper_en_fenetres(
        tokenizer, recus, index_etiquettes, options.longueur, options.chevauchement
    )
    predictions = [[None] * len(recu['textes']) for recu in recus]

    for depart in range(0, len(fenetres), options.lot):
        tranche = fenetres[depart : depart + options.lot]
        lot = assembler_lot([fenetre for _, fenetre in tranche], tokenizer.pad_token_id)
        entrees = {cle: valeur.to(appareil) for cle, valeur in lot.items() if cle != 'labels'}
        choisies = modele(**entrees).logits.argmax(dim=-1).cpu()

        for rang, (numero, fenetre) in enumerate(tranche):
            for position, id_mot in enumerate(fenetre['word_ids']):
                if id_mot is None or predictions[numero][id_mot] is not None:
                    continue
                predictions[numero][id_mot] = etiquettes[int(choisies[rang, position])]

    # Un mot tronque hors de toute fenetre n'a pas de prediction : l'exterieur est la reponse
    # prudente, et c'est exactement ce que le sidecar rend dans ce cas.
    return [
        [etiquette if etiquette is not None else ETIQUETTE_EXTERIEURE for etiquette in suite]
        for suite in predictions
    ]
