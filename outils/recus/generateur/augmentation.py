# Simulation de photo au telephone d'un recu imprime, appliquee a l'image propre de rendu.py :
#
#   1. ombrage de plis et eclairage inegal (multiplicatif, sans deformation) ;
#   2. homographie (perspective + rotation) appliquee a l'image ET aux boites ;
#   3. composition sur une texture de fond, avec ombre portee ;
#   4. eclairage global inegal, flou de mise au point, bruit de capteur ;
#   5. redimensionnement d'apres la largeur cible, et choix de la qualite jpeg.
#
# Une homographie et non un maillage : c'est ce qui permet de transporter les boites
# exactement, par la meme transformation que les pixels.
#
# Tout est deterministe a partir du numpy.random.Generator et du random.Random fournis.

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

import numpy as np
from PIL import Image, ImageFilter

from .rendu import BoiteMot


@dataclass
# Apres homographie : le quadrilatere (8 coordonnees) et la boite alignee qui l'englobe.
class BoiteTransformee:

    texte: str
    etiquette: str
    indice_ligne: int | None
    quad: list[float]
    bbox: list[float]

    def vers_dict(self) -> dict[str, object]:
        return {
            "texte": self.texte,
            "etiquette": self.etiquette,
            "indice_ligne": self.indice_ligne,
            "quad": [round(v, 2) for v in self.quad],
            "bbox": [round(v, 2) for v in self.bbox],
        }


@dataclass
class ResultatAugmentation:

    image: Image.Image
    boites: list[BoiteTransformee]
    qualite_jpeg: int
    homographie: np.ndarray = field(repr=False)


# ---------------------------------------------------------------------------
# Homographie
# ---------------------------------------------------------------------------


# Matrice 3x3 envoyant les 4 points source sur destination, par DLT.
def calculer_homographie(source: np.ndarray, destination: np.ndarray) -> np.ndarray:
    a: list[list[float]] = []
    b: list[float] = []
    for (x, y), (u, v) in zip(source, destination):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        b.append(u)
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        b.append(v)
    h = np.linalg.solve(np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64))
    return np.append(h, 1.0).reshape(3, 3)


# Transporte un tableau de points (n, 2).
def appliquer_homographie(h: np.ndarray, points: np.ndarray) -> np.ndarray:
    homogenes = np.hstack([points, np.ones((len(points), 1))])
    projetes = homogenes @ h.T
    return projetes[:, :2] / projetes[:, 2:3]


# Les quatre coins de chaque boite passent par h, puis par l'echelle : c'est la meme
# transformation que les pixels, sans quoi les boites deriveraient de l'image.
def transporter_boites(boites: list[BoiteMot], h: np.ndarray, echelle: float = 1.0) -> list[BoiteTransformee]:
    resultat: list[BoiteTransformee] = []
    for b in boites:
        coins = np.asarray(b.quad(), dtype=np.float64).reshape(4, 2)
        projetes = appliquer_homographie(h, coins) * echelle
        quad = [float(v) for v in projetes.reshape(-1)]
        xs, ys = projetes[:, 0], projetes[:, 1]
        bbox = [float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max())]
        resultat.append(BoiteTransformee(b.texte, b.etiquette, b.indice_ligne, quad, bbox))
    return resultat


# Chemin « sans augmentation » : identite plus echelle.
def boites_sans_deformation(boites: list[BoiteMot], echelle: float = 1.0) -> list[BoiteTransformee]:
    return transporter_boites(boites, np.eye(3), echelle)


# ---------------------------------------------------------------------------
# Ombrage, textures
# ---------------------------------------------------------------------------


# Bruit basse frequence dans [0, 1], par interpolation bilineaire d'une grille.
def _bruit_lisse(gen: np.random.Generator, h: int, w: int, echelle: int) -> np.ndarray:
    gh, gw = max(2, h // echelle + 2), max(2, w // echelle + 2)
    grille = gen.uniform(0.0, 1.0, size=(gh, gw)).astype(np.float32)
    petit = Image.fromarray((grille * 255).astype(np.uint8), mode="L")
    grand = petit.resize((w, h), Image.BILINEAR)
    return np.asarray(grand, dtype=np.float32) / 255.0


# Carte multiplicative : elle assombrit, elle ne deforme pas.
def ombrage_plis(gen: np.random.Generator, h: int, w: int) -> np.ndarray:
    carte = np.ones((h, w), dtype=np.float32)
    # Froissement doux : bruit lisse peu contraste.
    intensite = gen.uniform(0.0, 0.18)
    carte *= 1.0 - intensite * _bruit_lisse(gen, h, w, echelle=max(24, w // 5))
    # Plis nets : quelques lignes, chacune avec un cote sombre et un cote clair.
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    for _ in range(int(gen.integers(0, 4))):
        angle = gen.uniform(-0.35, 0.35) + (0.0 if gen.random() < 0.7 else math.pi / 2)
        nx, ny = math.cos(angle), math.sin(angle)
        px, py = gen.uniform(0, w), gen.uniform(0, h)
        distance = (xs - px) * nx + (ys - py) * ny
        largeur = gen.uniform(6.0, 30.0)
        force = gen.uniform(0.08, 0.28)
        profil = np.exp(-(distance / largeur) ** 2)
        signe = np.sign(distance)
        carte *= 1.0 - force * profil * (0.6 + 0.4 * signe)
        carte *= 1.0 + force * 0.35 * profil * (signe > 0)
    return np.clip(carte, 0.4, 1.15)


# RGB float32 dans [0, 255].
def texture_fond(gen: np.random.Generator, h: int, w: int) -> np.ndarray:
    genre = gen.choice(["bois", "comptoir", "uni", "carrelage"])
    base = np.zeros((h, w, 3), dtype=np.float32)
    if genre == "bois":
        teinte = np.array(gen.choice([[150, 105, 60], [120, 80, 45], [190, 150, 100], [90, 60, 35]]), dtype=np.float32)
        veines = _bruit_lisse(gen, h, w, echelle=max(4, h // 40))
        ys = np.arange(h, dtype=np.float32)[:, None] if gen.random() < 0.5 else np.arange(w, dtype=np.float32)[None, :]
        ondes = 0.5 + 0.5 * np.sin(ys / gen.uniform(6, 20) + veines * 8.0)
        facteur = 0.75 + 0.35 * ondes + 0.15 * veines
        base = teinte[None, None, :] * facteur[:, :, None]
    elif genre == "comptoir":
        teinte = np.array(gen.choice([[200, 200, 195], [60, 60, 65], [230, 225, 215], [130, 130, 128]]), dtype=np.float32)
        grain = gen.normal(0.0, 1.0, size=(h, w)).astype(np.float32)
        taches = _bruit_lisse(gen, h, w, echelle=max(3, min(h, w) // 60))
        facteur = 1.0 + 0.06 * grain + 0.25 * (taches - 0.5)
        base = teinte[None, None, :] * facteur[:, :, None]
    elif genre == "carrelage":
        teinte = np.array(gen.choice([[215, 215, 210], [180, 175, 170], [240, 240, 235]]), dtype=np.float32)
        pas = int(gen.integers(80, 200))
        ys, xs = np.mgrid[0:h, 0:w]
        joints = ((xs % pas) < 4) | ((ys % pas) < 4)
        facteur = np.where(joints, 0.7, 1.0).astype(np.float32)
        facteur *= 1.0 + 0.04 * gen.normal(0.0, 1.0, size=(h, w)).astype(np.float32)
        base = teinte[None, None, :] * facteur[:, :, None]
    else:
        teinte = np.array(gen.choice([[40, 40, 45], [90, 95, 100], [170, 160, 150], [220, 220, 220]]), dtype=np.float32)
        degrade = _bruit_lisse(gen, h, w, echelle=max(32, w // 2))
        base = teinte[None, None, :] * (0.85 + 0.3 * degrade)[:, :, None]
    return np.clip(base, 0, 255)


# Vignettage, gradient directionnel, et parfois un reflet de flash.
def eclairage_inegal(gen: np.random.Generator, h: int, w: int) -> np.ndarray:
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = gen.uniform(0.2, 0.8) * w, gen.uniform(0.2, 0.8) * h
    rayon = math.hypot(w, h) * gen.uniform(0.6, 1.2)
    vignette = 1.0 - gen.uniform(0.1, 0.45) * np.clip(np.hypot(xs - cx, ys - cy) / rayon, 0, 1) ** 2
    angle = gen.uniform(0, 2 * math.pi)
    gradient = ((xs - w / 2) * math.cos(angle) + (ys - h / 2) * math.sin(angle)) / max(w, h)
    carte = vignette * (1.0 + gen.uniform(0.0, 0.3) * gradient)
    if gen.random() < 0.3:  # reflet de flash
        fx, fy = gen.uniform(0.2, 0.8) * w, gen.uniform(0.1, 0.9) * h
        r = min(w, h) * gen.uniform(0.15, 0.4)
        carte += gen.uniform(0.1, 0.3) * np.exp(-(((xs - fx) ** 2 + (ys - fy) ** 2) / (2 * r * r)))
    return np.clip(carte, 0.3, 1.4).astype(np.float32)


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------


def _coins_destination(
    gen: np.random.Generator, w: int, h: int
) -> tuple[np.ndarray, np.ndarray, int, int]:
    source = np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float64)
    # Perspective : perturbation independante de chaque coin.
    amplitude_x = w * gen.uniform(0.0, 0.12)
    amplitude_y = h * gen.uniform(0.0, 0.05)
    perturbe = source + np.stack(
        [gen.uniform(-amplitude_x, amplitude_x, 4), gen.uniform(-amplitude_y, amplitude_y, 4)], axis=1
    )
    # Leger retrecissement d'un cote (angle de vue).
    if gen.random() < 0.6:
        cote = gen.uniform(0.0, 0.18) * w
        if gen.random() < 0.5:
            perturbe[1, 0] -= cote
            perturbe[2, 0] -= cote * gen.uniform(0.0, 0.5)
        else:
            perturbe[0, 0] += cote
            perturbe[3, 0] += cote * gen.uniform(0.0, 0.5)
    # Rotation autour du centre.
    angle = math.radians(gen.uniform(-7.0, 7.0))
    if gen.random() < 0.06:
        angle += math.radians(gen.choice([-90.0, 90.0]))
    centre = perturbe.mean(axis=0)
    rot = np.array([[math.cos(angle), -math.sin(angle)], [math.sin(angle), math.cos(angle)]])
    tourne = (perturbe - centre) @ rot.T + centre
    # Recadrage du canevas avec marge de fond.
    marge_x = w * gen.uniform(0.04, 0.25)
    marge_y = h * gen.uniform(0.02, 0.10)
    min_xy = tourne.min(axis=0) - [marge_x, marge_y]
    max_xy = tourne.max(axis=0) + [marge_x, marge_y]
    destination = tourne - min_xy
    largeur_canevas = int(math.ceil(max_xy[0] - min_xy[0]))
    hauteur_canevas = int(math.ceil(max_xy[1] - min_xy[1]))
    return source, destination, largeur_canevas, hauteur_canevas


# Image.transform(PERSPECTIVE) attend la transformation inverse : ses coefficients
# envoient un pixel de la destination vers la source, pas l'inverse.
def _coefficients_pil(h_inverse: np.ndarray) -> tuple[float, ...]:
    m = h_inverse / h_inverse[2, 2]
    return tuple(float(v) for v in m.reshape(-1)[:8])


def augmenter(
    image_propre: Image.Image,
    boites: list[BoiteMot],
    rng: random.Random,
    largeur_cible: int = 1100,
    qualite_jpeg: tuple[int, int] = (45, 92),
) -> ResultatAugmentation:
    gen = np.random.default_rng(rng.getrandbits(32))
    w, h = image_propre.size

    # 1. Ombrage de plis sur le papier (avant transformation).
    papier = np.asarray(image_propre.convert("RGB"), dtype=np.float32)
    papier *= ombrage_plis(gen, h, w)[:, :, None]
    image_papier = Image.fromarray(np.clip(papier, 0, 255).astype(np.uint8), mode="RGB")

    # 2. Homographie.
    source, destination, lc, hc = _coins_destination(gen, w, h)
    hom = calculer_homographie(source, destination)
    coefficients = _coefficients_pil(np.linalg.inv(hom))
    recu_deforme = image_papier.transform((lc, hc), Image.Transform.PERSPECTIVE, coefficients, Image.Resampling.BICUBIC)
    masque = Image.new("L", (w, h), 255).transform((lc, hc), Image.Transform.PERSPECTIVE, coefficients, Image.Resampling.BILINEAR)

    # 3. Fond + ombre portee + composition.
    fond = texture_fond(gen, hc, lc)
    decalage = (int(gen.integers(-12, 13)), int(gen.integers(4, 18)))
    ombre = masque.transform(
        (lc, hc), Image.Transform.AFFINE, (1, 0, -decalage[0], 0, 1, -decalage[1]), Image.Resampling.BILINEAR
    ).filter(ImageFilter.GaussianBlur(radius=float(gen.uniform(4, 14))))
    alpha_ombre = np.asarray(ombre, dtype=np.float32) / 255.0 * gen.uniform(0.25, 0.6)
    fond *= (1.0 - alpha_ombre)[:, :, None]
    alpha = (np.asarray(masque, dtype=np.float32) / 255.0)[:, :, None]
    composite = np.asarray(recu_deforme, dtype=np.float32) * alpha + fond * (1.0 - alpha)

    # 4. Eclairage inegal, balance des couleurs, flou, bruit.
    composite *= eclairage_inegal(gen, hc, lc)[:, :, None]
    balance = gen.uniform(0.92, 1.08, size=3).astype(np.float32)
    composite *= balance[None, None, :]
    image = Image.fromarray(np.clip(composite, 0, 255).astype(np.uint8), mode="RGB")
    if gen.random() < 0.7:
        image = image.filter(ImageFilter.GaussianBlur(radius=float(gen.uniform(0.3, 1.6))))

    # 5. Redimensionnement d'apres la largeur cible.
    echelle = largeur_cible / lc
    nouvelle_taille = (largeur_cible, max(1, int(round(hc * echelle))))
    image = image.resize(nouvelle_taille, Image.Resampling.LANCZOS)
    tableau = np.asarray(image, dtype=np.float32)
    sigma = gen.uniform(1.0, 7.0)
    tableau += gen.normal(0.0, sigma, size=tableau.shape).astype(np.float32)
    image = Image.fromarray(np.clip(tableau, 0, 255).astype(np.uint8), mode="RGB")

    boites_finales = transporter_boites(boites, hom, echelle)
    q_min, q_max = qualite_jpeg
    qualite = int(gen.integers(min(q_min, q_max), max(q_min, q_max) + 1))
    return ResultatAugmentation(image=image, boites=boites_finales, qualite_jpeg=qualite, homographie=hom)


# Sortie propre : redimensionnement d'apres la largeur cible, rien d'autre.
def sans_augmentation(
    image_propre: Image.Image, boites: list[BoiteMot], largeur_cible: int = 1100
) -> ResultatAugmentation:
    w, h = image_propre.size
    echelle = largeur_cible / w
    image = image_propre.resize((largeur_cible, max(1, int(round(h * echelle)))), Image.Resampling.LANCZOS)
    return ResultatAugmentation(
        image=image, boites=boites_sans_deformation(boites, echelle), qualite_jpeg=95, homographie=np.eye(3)
    )
