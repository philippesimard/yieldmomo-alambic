# Mesure un checkpoint sur un split, sans l'entrainer. Sert a juger sur le test une fois pour
# toutes, quand la validation a fini de choisir.
#
#   npm run evaluer-modele -- --split test
import argparse
from pathlib import Path

from transformers import AutoTokenizer, LiltForTokenClassification

from donnees import charger_split
from execution import choisir_appareil, predire
from mesures import formater, mesurer

LONGUEUR_MAX = 512
CHEVAUCHEMENT = 128

# Ancres sur le fichier et non sur le cwd : npm lance depuis la racine du depot, et un defaut
# relatif y ecrirait a cote.
RACINE = Path(__file__).resolve().parent
JEU_PAR_DEFAUT = RACINE.parent / 'jeu'
MODELE_PAR_DEFAUT = RACINE / 'modeles' / 'lilt-alambic'


def analyser_arguments():
    parseur = argparse.ArgumentParser()
    parseur.add_argument('--jeu', default=JEU_PAR_DEFAUT)
    parseur.add_argument('--modele', default=MODELE_PAR_DEFAUT)
    parseur.add_argument('--split', default='test')
    parseur.add_argument('--lot', type=int, default=4)
    parseur.add_argument('--appareil', default='auto')
    parseur.add_argument('--limite', type=int, default=0)
    arguments = parseur.parse_args()
    arguments.longueur = LONGUEUR_MAX
    arguments.chevauchement = CHEVAUCHEMENT
    return arguments


def principal():
    options = analyser_arguments()
    appareil = choisir_appareil(options.appareil)

    tokenizer = AutoTokenizer.from_pretrained(options.modele)
    modele = LiltForTokenClassification.from_pretrained(options.modele).to(appareil)
    # Les etiquettes viennent du checkpoint et non du code : mesurer avec une autre table que
    # celle qu'il a apprise ne dirait rien de juste.
    etiquettes = [modele.config.id2label[numero] for numero in range(modele.config.num_labels)]
    index_etiquettes = {nom: numero for numero, nom in enumerate(etiquettes)}

    recus = charger_split(options.jeu, options.split, options.limite)
    predictions = predire(
        modele, tokenizer, recus, index_etiquettes, etiquettes, options, appareil
    )
    print(f'{options.modele} sur « {options.split} » ({len(recus)} recus, appareil {appareil})\n')
    print(formater(mesurer([recu['etiquettes'] for recu in recus], predictions)))


if __name__ == '__main__':
    principal()
