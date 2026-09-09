# Lecture du jeu de recus annotes et mise en fenetres pour LiLT. Partage par l'entrainement et
# l'evaluation : le decoupage doit etre identique des deux cotes, sinon la mesure ne dit rien
# de ce qui a ete appris.
#
# Le jeu vient du generateur de recus quebecois : un json par image sous <split>/boxes/,
# portant les mots dans l'ordre de lecture, leur boite en pixels, et l'etiquette du mot.
import json
from pathlib import Path

# L'etiquette que le generateur pose sur un mot qui n'appartient a aucun champ.
ETIQUETTE_EXTERIEURE_JEU = 'autre'

# Celle du modele, convention BIO.
ETIQUETTE_EXTERIEURE = 'O'

# Les champs que le generateur sait annoter. Fige ici et non deduit du dossier : l'ordre de
# cette liste devient l'ordre des classes du modele, et un jeu de donnees different ne doit pas
# pouvoir renumeroter silencieusement un checkpoint deja entraine. Les 25 premiers champs
# gardent leur rang d'origine ; les suivants viennent de la version 0.2 du generateur (types de
# commerce, SEV, pourboire, frais, client, codes produit).
CHAMPS = (
    'adresse',
    'cnt',
    'date',
    'discount_label',
    'discountprice',
    'heure',
    'marchand',
    'menutype_cnt',
    'nm',
    'paiement',
    'price',
    'subtotal_label',
    'subtotal_price',
    'tax',
    'telephone',
    'total_label',
    'total_price',
    'tps',
    'tps_label',
    'tps_no',
    'tvq',
    'tvq_label',
    'tvq_no',
    'unit',
    'unitprice',
    'arrondi',
    'client_adresse',
    'client_nom',
    'client_tps_no',
    'client_tvq_no',
    'code_autorisation',
    'commande',
    'courriel',
    'couverts',
    'employe',
    'frais_livraison',
    'frais_livraison_label',
    'frais_service',
    'frais_service_label',
    'mev',
    'neq',
    'nom_legal',
    'numero_facture',
    'numero_sev',
    'onglet',
    'permis_alcool',
    'petit_fournisseur',
    'pourboire',
    'pourboire_label',
    'serveur',
    'service',
    'site_web',
    'sku',
    'table',
    'total_final',
    'total_final_label',
    'type_document',
)

# Etiquettes posees sur des elements graphiques (code QR, code-barres) : leur « mot » n'est pas
# un texte que l'ocr lirait a l'inference. On les replie sur l'exterieur plutot que d'en faire
# des classes.
ETIQUETTES_REPLIEES = frozenset({'qr', 'code_barres'})

# LiLT lit des coordonnees entieres sur une grille de 0 a 1000, quelle que soit la taille de
# l'image : c'est ce qui rend la geometrie comparable d'un recu a l'autre.
COTE_GRILLE = 1000

# Ignore par la fonction de cout : sous-tokens qui ne sont pas le premier de leur mot, et
# bourrage.
ETIQUETTE_IGNOREE = -100


def construire_etiquettes():
    etiquettes = [ETIQUETTE_EXTERIEURE]
    for champ in CHAMPS:
        etiquettes.append(f'B-{champ}')
        etiquettes.append(f'I-{champ}')
    return etiquettes


def normaliser_boite(boite, largeur, hauteur):
    x0, y0, x1, y1 = boite
    echelle = lambda valeur, cote: min(COTE_GRILLE, max(0, int(valeur * COTE_GRILLE / cote)))
    return [
        echelle(min(x0, x1), largeur),
        echelle(min(y0, y1), hauteur),
        echelle(max(x0, x1), largeur),
        echelle(max(y0, y1), hauteur),
    ]


def lire_recu(chemin):
    donnees = json.loads(chemin.read_text(encoding='utf-8'))
    largeur = donnees['largeur']
    hauteur = donnees['hauteur']

    textes = []
    boites = []
    etiquettes = []
    champ_precedent = None
    ligne_precedente = None

    for mot in donnees['mots']:
        texte = str(mot['texte']).strip()
        # Un mot vide n'a pas de sous-token : il decalerait l'alignement mot/etiquette sans
        # rien apporter au modele.
        if not texte:
            continue
        champ = mot['etiquette']
        if champ in ETIQUETTES_REPLIEES:
            champ = ETIQUETTE_EXTERIEURE_JEU
        if champ != ETIQUETTE_EXTERIEURE_JEU and champ not in CHAMPS:
            raise ValueError(f'{chemin.name} : etiquette inconnue « {champ} »')
        ligne = mot['indice_ligne']

        if champ == ETIQUETTE_EXTERIEURE_JEU:
            etiquettes.append(ETIQUETTE_EXTERIEURE)
        else:
            # Deux articles voisins portent le meme champ : sans le changement de ligne, leurs
            # libelles fusionneraient en une seule entite.
            ouvre = champ != champ_precedent or ligne != ligne_precedente
            etiquettes.append(f'{"B" if ouvre else "I"}-{champ}')

        textes.append(texte)
        boites.append(normaliser_boite(mot['bbox'], largeur, hauteur))
        champ_precedent = champ if champ != ETIQUETTE_EXTERIEURE_JEU else None
        ligne_precedente = ligne

    return {'nom': chemin.stem, 'textes': textes, 'boites': boites, 'etiquettes': etiquettes}


def charger_split(racine, split, limite=0):
    dossier = Path(racine) / split / 'boxes'
    if not dossier.is_dir():
        raise FileNotFoundError(f'{dossier} est introuvable')
    chemins = sorted(dossier.glob('*.json'))
    if limite > 0:
        chemins = chemins[:limite]
    recus = [lire_recu(chemin) for chemin in chemins]
    if not recus:
        raise ValueError(f'aucun recu dans {dossier}')
    return recus


def encoder(tokenizer, recu, index_etiquettes, longueur_max, chevauchement):
    # Un recu long deborde de la fenetre du modele : on le decoupe, avec du contexte partage
    # des deux cotes plutot que de perdre son pied de ticket.
    encodage = tokenizer(
        recu['textes'],
        is_split_into_words=True,
        truncation=True,
        max_length=longueur_max,
        stride=chevauchement,
        return_overflowing_tokens=True,
        return_attention_mask=True,
    )

    fenetres = []
    for numero in range(len(encodage['input_ids'])):
        ids_mots = encodage.word_ids(batch_index=numero)
        boites = []
        etiquettes = []
        mots_vus = set()
        for id_mot in ids_mots:
            if id_mot is None:
                # Boite hors de tout mot : celle des tokens speciaux et du bourrage.
                boites.append([0, 0, 0, 0])
                etiquettes.append(ETIQUETTE_IGNOREE)
                continue
            boites.append(recu['boites'][id_mot])
            # Le premier sous-token porte l'etiquette du mot ; les suivants ne sont pas notes,
            # c'est lui seul que le sidecar lit a l'inference.
            if id_mot in mots_vus:
                etiquettes.append(ETIQUETTE_IGNOREE)
            else:
                mots_vus.add(id_mot)
                etiquettes.append(index_etiquettes[recu['etiquettes'][id_mot]])
        fenetres.append(
            {
                'input_ids': encodage['input_ids'][numero],
                'attention_mask': encodage['attention_mask'][numero],
                'bbox': boites,
                'labels': etiquettes,
                'word_ids': ids_mots,
            }
        )
    return fenetres
