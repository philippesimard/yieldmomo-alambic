#!/usr/bin/env python3
# Ligne de commande du generateur de recus quebecois.
#
#   npm run generer-recus -- --n 4000 --jobs 4
#
# La graine est derivee de (graine, index) : le resultat ne depend ni du nombre de processus
# ni de l'ordre d'execution.

from __future__ import annotations

import argparse
import multiprocessing
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from generateur import catalogue
from generateur.augmentation import augmenter, sans_augmentation
from generateur.contenu import generer_recu_et_style
from generateur.export import (
    SPLITS,
    analyser_split,
    ecrire_exemple,
    ecrire_metadata,
    planche_contact,
    preparer_dossiers,
    repartir,
)
from generateur.rendu import polices_disponibles, rendre

# Ancre sur le fichier et non sur le cwd : npm lance depuis la racine du depot, ou un defaut
# relatif ecrirait plus d'un Go a cote.
RACINE = Path(__file__).resolve().parent
JEU_PAR_DEFAUT = RACINE.parent / "jeu"


@dataclass(frozen=True)
# Partage par tous les processus : doit rester picklable.
class Options:

    racine: Path
    graine: int
    largeur_cible: int
    qualite_jpeg: tuple[int, int]
    augmentation: bool
    types: tuple[str, ...] | None = None


# La graine derive de (graine, index) : le resultat ne depend ni du nombre de
# processus ni de l'ordre d'execution.
def generer_element(tache: tuple[int, str, int, Options]) -> tuple[int, str, dict[str, str]]:
    index, split, numero, options = tache
    recu, style, rng = generer_recu_et_style(options.graine, index, polices_disponibles(), options.types)
    rendu = rendre(recu, style, rng)
    if options.augmentation:
        resultat = augmenter(rendu.image, rendu.boites, rng, options.largeur_cible, options.qualite_jpeg)
    else:
        resultat = sans_augmentation(rendu.image, rendu.boites, options.largeur_cible)
    ligne = ecrire_exemple(options.racine, split, numero, resultat, recu, options.augmentation)
    return index, split, ligne


def analyser_arguments(argv: list[str] | None = None) -> argparse.Namespace:
    analyseur = argparse.ArgumentParser(
        description="Génère des reçus québécois synthétiques annotés (format CORD / Donut)."
    )
    analyseur.add_argument("--n", type=int, default=100, help="nombre total de reçus")
    analyseur.add_argument("--out", type=Path, default=JEU_PAR_DEFAUT, help="dossier de sortie")
    analyseur.add_argument("--seed", type=int, default=42, help="graine aléatoire")
    analyseur.add_argument("--split", type=str, default="0.8,0.1,0.1", help="proportions train,valid,test")
    analyseur.add_argument("--largeur-cible", type=int, default=1100, help="largeur des images finales (px)")
    analyseur.add_argument("--qualite-jpeg", type=str, default="45,92", help="plage de qualité JPEG min,max")
    analyseur.add_argument("--sans-augmentation", action="store_true", help="rendu propre, sans simulation photo")
    analyseur.add_argument("--planche", action="store_true", help="produit dataset/apercu.jpg")
    analyseur.add_argument("--jobs", type=int, default=1, help="nombre de processus")
    analyseur.add_argument(
        "--ecraser", action="store_true", help="autorise l'ecriture dans un jeu deja peuple"
    )
    analyseur.add_argument(
        "--types",
        type=str,
        default=None,
        help="types de commerce à générer, séparés par des virgules (défaut : tous, selon POIDS_TYPES) ; "
        "valeurs : " + ",".join(catalogue.TYPES_COMMERCE),
    )
    return analyseur.parse_args(argv)


def principal(argv: list[str] | None = None) -> int:
    args = analyser_arguments(argv)
    if args.n <= 0:
        print("--n doit être strictement positif.", file=sys.stderr)
        return 2
    proportions = analyser_split(args.split)
    q_min, q_max = (int(v) for v in args.qualite_jpeg.split(","))
    types: tuple[str, ...] | None = None
    if args.types:
        types = tuple(t.strip() for t in args.types.split(",") if t.strip())
        inconnus = [t for t in types if t not in catalogue.TYPES_COMMERCE]
        if inconnus:
            print(f"--types : types inconnus {inconnus} ; attendus : {', '.join(catalogue.TYPES_COMMERCE)}", file=sys.stderr)
            return 2
    options = Options(
        racine=args.out,
        graine=args.seed,
        largeur_cible=args.largeur_cible,
        qualite_jpeg=(q_min, q_max),
        augmentation=not args.sans_augmentation,
        types=types,
    )
    # Le defaut ecrit dans outils/jeu, qui porte le corpus ayant produit le checkpoint en
    # service. Une generation plus courte y laisserait les images en trop et tronquerait
    # metadata.jsonl, qui s'ecrit en entier : le jeu serait incoherent sans que rien ne le dise.
    peuples = [s for s in SPLITS if any((args.out / s / "boxes").glob("*.json"))]
    if peuples and not args.ecraser:
        print(
            f"{args.out} contient deja un jeu ({', '.join(peuples)}).\n"
            "Choisis un autre --out, ou passe --ecraser pour le remplacer.",
            file=sys.stderr,
        )
        return 2

    preparer_dossiers(args.out)
    attribution = repartir(args.n, proportions)
    taches = [(i, split, numero, options) for i, (split, numero) in enumerate(attribution)]

    debut = time.time()
    resultats: dict[int, tuple[str, dict[str, str]]] = {}
    jobs = max(1, args.jobs)
    if jobs == 1:
        for k, tache in enumerate(taches, start=1):
            index, split, ligne = generer_element(tache)
            resultats[index] = (split, ligne)
            _afficher_progression(k, args.n, debut)
    else:
        with multiprocessing.get_context("spawn").Pool(jobs) as bassin:
            for k, (index, split, ligne) in enumerate(bassin.imap_unordered(generer_element, taches, chunksize=4), start=1):
                resultats[index] = (split, ligne)
                _afficher_progression(k, args.n, debut)

    # metadata.jsonl dans l'ordre des index, par split.
    for split in SPLITS:
        lignes = [resultats[i][1] for i in sorted(resultats) if resultats[i][0] == split]
        ecrire_metadata(args.out, split, lignes)
        print(f"{split:6s} : {len(lignes):6d} reçus")

    if args.planche:
        chemins: list[Path] = []
        for i in sorted(resultats):
            if len(chemins) >= 16:
                break
            split, ligne = resultats[i]
            chemins.append(args.out / split / ligne["file_name"])
        sortie = planche_contact(chemins, args.out / "apercu.jpg")
        print(f"planche-contact : {sortie}")

    print(f"terminé en {time.time() - debut:.1f} s → {args.out}")
    return 0


def _afficher_progression(fait: int, total: int, debut: float) -> None:
    if fait == total or fait % max(1, total // 20) == 0:
        ecoule = time.time() - debut
        print(f"  {fait}/{total} ({ecoule:.1f} s)", file=sys.stderr)


if __name__ == "__main__":
    sys.exit(principal())
