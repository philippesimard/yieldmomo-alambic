# Socle du catalogue : categories, Produit et fabriques.
#
# Trois familles de categories : CATEGORIES_EPICERIE (epicerie, depanneur, pharmacie),
# CATEGORIES_SERVICE (restaurants, cafes, comptoirs, bars) et CATEGORIES_DETAIL (quincaillerie,
# SAQ, station-service, ordonnances et sante). CATEGORIES les concatene, et son ordre est
# l'ordre d'impression quand le recu affiche des en-tetes de rayon.
#
# Taxation (voir fiscalite.py) : les aliments de base sont detaxes ; sont taxables boissons
# gazeuses, friandises, grignotines, plats prepares et servis, alcool, produits non
# alimentaires. Chaque produit porte son drapeau taxable pour les exceptions.

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Final, Sequence

CATEGORIES_EPICERIE: Final[tuple[str, ...]] = (
    "fruits_legumes",
    "produits_laitiers",
    "viandes_poissons",
    "boulangerie",
    "epicerie_seche",
    "surgeles",
    "grignotines",
    "boissons",
    "alcool",
    "pret_a_manger",
    "menager",
    "hygiene",
)

CATEGORIES_SERVICE: Final[tuple[str, ...]] = (
    "entrees",
    "plats",
    "desserts",
    "boissons_chaudes",
    "boissons_froides",
    "alcool_service",
    "repas_rapide",
    "viennoiseries",
)

CATEGORIES_DETAIL: Final[tuple[str, ...]] = (
    "quincaillerie",
    "vins",
    "spiritueux",
    "carburant",
    "ordonnance",
    "sante",
)

CATEGORIES: Final[tuple[str, ...]] = CATEGORIES_EPICERIE + CATEGORIES_SERVICE + CATEGORIES_DETAIL

#: Categories taxables par defaut (TPS + TVQ). Les medicaments sur
#: ordonnance (``ordonnance``) sont detaxes.
_CATEGORIES_TAXABLES_PAR_DEFAUT: Final[frozenset[str]] = frozenset(
    {"grignotines", "boissons", "alcool", "pret_a_manger", "menager", "hygiene"}
    | set(CATEGORIES_SERVICE)
    | {"quincaillerie", "vins", "spiritueux", "carburant", "sante"}
)


@dataclass(frozen=True)
# unite vaut « kg » ou « L » pour une mesure ; au_poids en decoule.
class Produit:

    nom: str
    categorie: str
    prix_min: Decimal
    prix_max: Decimal
    au_poids: bool
    taxable: bool
    unite: str | None = None
    decimales_prix: int = 2


# taxable suit la categorie par defaut.
def _p(
    nom: str,
    categorie: str,
    prix_min: str,
    prix_max: str,
    au_poids: bool = False,
    taxable: bool | None = None,
    unite: str | None = None,
    decimales_prix: int = 2,
) -> Produit:
    if categorie not in CATEGORIES:
        raise ValueError(f"Catégorie inconnue : {categorie!r} ({nom})")
    if taxable is None:
        taxable = categorie in _CATEGORIES_TAXABLES_PAR_DEFAUT
    if au_poids and unite is None:
        unite = "kg"
    if unite == "kg":
        au_poids = True
    return Produit(nom, categorie, Decimal(prix_min), Decimal(prix_max), au_poids, taxable, unite, decimales_prix)


# Decline un produit en saveurs ou formats : nom_base porte la partie commune.
def _variantes(
    nom_base: str,
    categorie: str,
    prix_min: str,
    prix_max: str,
    variantes: Sequence[str],
    **kw: object,
) -> tuple[Produit, ...]:
    if "{}" not in nom_base:
        nom_base = nom_base + " {}"
    return tuple(_p(nom_base.format(v), categorie, prix_min, prix_max, **kw) for v in variantes)  # type: ignore[arg-type]
