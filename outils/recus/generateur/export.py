# Ecriture du jeu : images jpeg, metadata.jsonl, boites, planche-contact.
#
#   <sortie>/{train,valid,test}/images/000000.jpg
#   <sortie>/{train,valid,test}/boxes/000000.json
#   <sortie>/{train,valid,test}/metadata.jsonl
#
# metadata.jsonl suit la convention imagefolder de Hugging Face. Les boites sont ce que lit
# l'entrainement (../entrainement/donnees.py) ; les images ne lui servent pas.

from __future__ import annotations

import json
from pathlib import Path
from typing import Sequence

from PIL import Image, ImageDraw, ImageFont

from .augmentation import ResultatAugmentation
from .modeles import Recu

SPLITS: tuple[str, ...] = ("train", "valid", "test")


# Analyse « 0.8,0.1,0.1 » et verifie que la somme vaut 1.
def analyser_split(texte: str) -> tuple[float, float, float]:
    parts = [float(p) for p in texte.split(",")]
    if len(parts) != 3 or any(p < 0 for p in parts):
        raise ValueError("--split attend trois proportions positives, ex. 0.8,0.1,0.1")
    total = sum(parts)
    if abs(total - 1.0) > 1e-6:
        raise ValueError(f"Les proportions de --split doivent sommer à 1 (obtenu {total}).")
    return parts[0], parts[1], parts[2]


# Par blocs contigus : un index donne tombe toujours dans le meme split, quel que soit
# le nombre de processus.
def repartir(n: int, proportions: tuple[float, float, float]) -> list[tuple[str, int]]:
    n_train = int(round(n * proportions[0]))
    n_valid = int(round(n * proportions[1]))
    n_train = min(n_train, n)
    n_valid = min(n_valid, n - n_train)
    attribution: list[tuple[str, int]] = []
    for index in range(n):
        if index < n_train:
            attribution.append(("train", index))
        elif index < n_train + n_valid:
            attribution.append(("valid", index - n_train))
        else:
            attribution.append(("test", index - n_train - n_valid))
    return attribution


def preparer_dossiers(racine: Path) -> None:
    for split in SPLITS:
        (racine / split / "images").mkdir(parents=True, exist_ok=True)
        (racine / split / "boxes").mkdir(parents=True, exist_ok=True)


def nom_fichier(numero: int) -> str:
    return f"{numero:06d}"


# Rend la ligne destinee a metadata.jsonl.
def ecrire_exemple(
    racine: Path,
    split: str,
    numero: int,
    resultat: ResultatAugmentation,
    recu: Recu,
    augmente: bool,
) -> dict[str, str]:
    base = nom_fichier(numero)
    chemin_image = racine / split / "images" / f"{base}.jpg"
    chemin_boites = racine / split / "boxes" / f"{base}.json"
    resultat.image.save(chemin_image, format="JPEG", quality=resultat.qualite_jpeg, optimize=True)
    largeur, hauteur = resultat.image.size
    donnees_boites = {
        "file_name": f"images/{base}.jpg",
        "largeur": largeur,
        "hauteur": hauteur,
        "augmente": augmente,
        "qualite_jpeg": resultat.qualite_jpeg,
        "mots": [b.vers_dict() for b in resultat.boites],
    }
    chemin_boites.write_text(json.dumps(donnees_boites, ensure_ascii=False), encoding="utf-8")
    return {
        "file_name": f"images/{base}.jpg",
        "ground_truth": json.dumps(recu.vers_gt_parse(), ensure_ascii=False),
    }


def ecrire_metadata(racine: Path, split: str, lignes: Sequence[dict[str, str]]) -> Path:
    chemin = racine / split / "metadata.jsonl"
    with chemin.open("w", encoding="utf-8") as f:
        for ligne in lignes:
            f.write(json.dumps(ligne, ensure_ascii=False) + "\n")
    return chemin


def planche_contact(
    chemins: Sequence[Path],
    sortie: Path,
    colonnes: int = 4,
    largeur_vignette: int = 320,
    hauteur_vignette: int = 520,
) -> Path:
    if not chemins:
        raise ValueError("Aucune image pour la planche-contact.")
    colonnes = max(1, min(colonnes, len(chemins)))
    rangees = (len(chemins) + colonnes - 1) // colonnes
    bandeau = 22
    largeur = colonnes * largeur_vignette
    hauteur = rangees * (hauteur_vignette + bandeau)
    planche = Image.new("RGB", (largeur, hauteur), (40, 40, 40))
    dessin = ImageDraw.Draw(planche)
    try:
        police = ImageFont.load_default(size=14)
    except TypeError:
        police = ImageFont.load_default()
    for i, chemin in enumerate(chemins):
        vignette = Image.open(chemin).convert("RGB")
        vignette.thumbnail((largeur_vignette - 8, hauteur_vignette - 8), Image.Resampling.LANCZOS)
        cx = (i % colonnes) * largeur_vignette + (largeur_vignette - vignette.width) // 2
        cy = (i // colonnes) * (hauteur_vignette + bandeau) + (hauteur_vignette - vignette.height) // 2
        planche.paste(vignette, (cx, cy))
        etiquette = f"{chemin.parent.parent.name}/{chemin.name}"
        dessin.text(
            ((i % colonnes) * largeur_vignette + 6, (i // colonnes) * (hauteur_vignette + bandeau) + hauteur_vignette + 3),
            etiquette,
            font=police,
            fill=(230, 230, 230),
        )
    planche.save(sortie, format="JPEG", quality=85)
    return sortie
