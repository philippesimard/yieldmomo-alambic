#!/usr/bin/env python3
# Redessine les quadrilateres des mots sur une image du jeu, pour verifier a l'oeil que les
# boites restent alignees sur le texte apres deformation.
#
#   npm run verifier-boites -- outils/jeu/train/images/000000.jpg
#   npm run verifier-boites -- outils/jeu/train --tous 8

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

from generateur.rendu import COULEURS_ETIQUETTES


def chemin_boites(chemin_image: Path) -> Path:
    return chemin_image.parent.parent / "boxes" / (chemin_image.stem + ".json")


def dessiner(chemin_image: Path, sortie: Path, bbox: bool = False) -> Path:
    image = Image.open(chemin_image).convert("RGB")
    donnees = json.loads(chemin_boites(chemin_image).read_text(encoding="utf-8"))
    dessin = ImageDraw.Draw(image)
    for mot in donnees["mots"]:
        couleur = COULEURS_ETIQUETTES.get(mot["etiquette"], (0, 0, 255))
        q = mot["quad"]
        dessin.polygon([(q[0], q[1]), (q[2], q[3]), (q[4], q[5]), (q[6], q[7])], outline=couleur, width=2)
        if bbox:
            dessin.rectangle(mot["bbox"], outline=(255, 255, 0), width=1)
    sortie.parent.mkdir(parents=True, exist_ok=True)
    image.save(sortie)
    return sortie


def principal(argv: list[str] | None = None) -> int:
    analyseur = argparse.ArgumentParser(description="Vérification visuelle des boîtes.")
    analyseur.add_argument("cible", type=Path, help="image .jpg ou dossier de split")
    analyseur.add_argument("--sortie", type=Path, default=None, help="fichier ou dossier de sortie")
    analyseur.add_argument("--tous", type=int, default=0, help="traiter les N premières images d'un split")
    analyseur.add_argument("--bbox", action="store_true", help="dessiner aussi les boîtes alignées aux axes")
    args = analyseur.parse_args(argv)

    if args.cible.is_dir():
        images = sorted((args.cible / "images").glob("*.jpg"))
        if args.tous:
            images = images[: args.tous]
        dossier = args.sortie or (args.cible / "verification")
        for image in images:
            print(dessiner(image, dossier / (image.stem + "_boites.png"), args.bbox))
        return 0
    sortie = args.sortie or args.cible.with_name(args.cible.stem + "_boites.png")
    print(dessiner(args.cible, sortie, args.bbox))
    return 0


if __name__ == "__main__":
    sys.exit(principal())
