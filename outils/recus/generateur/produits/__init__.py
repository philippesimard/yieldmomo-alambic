# Catalogue de produits, regroupe par famille de commerces. PRODUITS concatene les quatre
# familles, PRODUITS_PAR_CATEGORIE indexe par categorie. Les noms sont uniques sur l'ensemble.

from __future__ import annotations

from typing import Final

from . import detail, epicerie, pharmacie, restauration
from .base import (
    CATEGORIES,
    CATEGORIES_DETAIL,
    CATEGORIES_EPICERIE,
    CATEGORIES_SERVICE,
    Produit,
)

PRODUITS: Final[tuple[Produit, ...]] = (
    epicerie.PRODUITS + restauration.PRODUITS + detail.PRODUITS + pharmacie.PRODUITS
)

PRODUITS_PAR_CATEGORIE: Final[dict[str, tuple[Produit, ...]]] = {
    categorie: tuple(p for p in PRODUITS if p.categorie == categorie) for categorie in CATEGORIES
}

__all__ = [
    "CATEGORIES",
    "CATEGORIES_DETAIL",
    "CATEGORIES_EPICERIE",
    "CATEGORIES_SERVICE",
    "PRODUITS",
    "PRODUITS_PAR_CATEGORIE",
    "Produit",
]
