# Mesures de qualite de l'etiquetage, au mot et a l'entite.
#
# L'entite est la mesure qui compte : la Collecte ne lit pas des mots isoles, elle recompose
# « BIERE MOLSON CAN 12 X 341 » en un libelle d'article. Un mot juste au milieu d'une entite
# mal decoupee ne sert a rien, et seule la mesure a l'entite le dit.
from collections import defaultdict

from donnees import ETIQUETTE_EXTERIEURE


def extraire_entites(etiquettes):
    entites = []
    champ_courant = None
    debut = 0
    for position, etiquette in enumerate(etiquettes):
        if etiquette == ETIQUETTE_EXTERIEURE:
            prefixe, champ = None, None
        else:
            prefixe, champ = etiquette[0], etiquette[2:]
        # Un I- orphelin ouvre une entite plutot que d'etre jete : le modele oublie parfois le
        # B-, et l'entite reste lisible.
        ouvre = prefixe == 'B' or (prefixe == 'I' and champ != champ_courant)
        if champ_courant is not None and (champ != champ_courant or ouvre):
            entites.append((champ_courant, debut, position))
            champ_courant = None
        if champ is not None and champ_courant is None:
            champ_courant = champ
            debut = position
    if champ_courant is not None:
        entites.append((champ_courant, debut, len(etiquettes)))
    return entites


def _f1(justes, predites, attendues):
    precision = justes / predites if predites else 0.0
    rappel = justes / attendues if attendues else 0.0
    f1 = 2 * precision * rappel / (precision + rappel) if precision + rappel else 0.0
    return {'precision': precision, 'rappel': rappel, 'f1': f1, 'attendues': attendues}


def mesurer(verites, predictions):
    justes_mots = 0
    total_mots = 0
    justes = defaultdict(int)
    predites = defaultdict(int)
    attendues = defaultdict(int)

    for verite, prediction in zip(verites, predictions):
        total_mots += len(verite)
        justes_mots += sum(1 for a, b in zip(verite, prediction) if a == b)

        entites_verite = set(extraire_entites(verite))
        entites_prediction = set(extraire_entites(prediction))
        for champ, _, _ in entites_verite:
            attendues[champ] += 1
        for entite in entites_prediction:
            predites[entite[0]] += 1
            if entite in entites_verite:
                justes[entite[0]] += 1

    champs = sorted(set(attendues) | set(predites))
    par_champ = {champ: _f1(justes[champ], predites[champ], attendues[champ]) for champ in champs}
    global_ = _f1(sum(justes.values()), sum(predites.values()), sum(attendues.values()))
    global_['exactitude_mots'] = justes_mots / total_mots if total_mots else 0.0
    return {'global': global_, 'par_champ': par_champ}


def formater(mesure):
    lignes = [f'{"champ":<18}{"prec.":>8}{"rappel":>8}{"F1":>8}{"n":>8}']
    lignes.append('-' * 50)
    for champ, valeurs in sorted(
        mesure['par_champ'].items(), key=lambda paire: paire[1]['f1']
    ):
        lignes.append(
            f'{champ:<18}{valeurs["precision"]:>8.3f}{valeurs["rappel"]:>8.3f}'
            f'{valeurs["f1"]:>8.3f}{valeurs["attendues"]:>8d}'
        )
    lignes.append('-' * 50)
    global_ = mesure['global']
    lignes.append(
        f'{"ENTITES":<18}{global_["precision"]:>8.3f}{global_["rappel"]:>8.3f}'
        f'{global_["f1"]:>8.3f}{global_["attendues"]:>8d}'
    )
    lignes.append(f'exactitude au mot : {global_["exactitude_mots"]:.4f}')
    return '\n'.join(lignes)
