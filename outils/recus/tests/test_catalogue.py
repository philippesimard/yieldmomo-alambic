# Integrite du catalogue de produits et des enseignes.

from __future__ import annotations

from collections import Counter

from generateur import catalogue
from generateur.contenu import produits_admissibles


def test_taille_et_unicite_du_catalogue() -> None:
    assert len(catalogue.PRODUITS) >= 2200
    doublons = [n for n, c in Counter(p.nom for p in catalogue.PRODUITS).items() if c > 1]
    assert not doublons, doublons


def test_produits_bien_formes() -> None:
    for p in catalogue.PRODUITS:
        assert p.categorie in catalogue.CATEGORIES, p
        assert p.prix_min <= p.prix_max, p
        assert p.prix_min > 0, p
        assert len(p.nom) <= 40, p
        if p.unite == "kg":
            assert p.au_poids
        if p.decimales_prix == 3:
            assert p.unite is not None


def test_chaque_categorie_est_garnie() -> None:
    for categorie in catalogue.CATEGORIES:
        assert catalogue.PRODUITS_PAR_CATEGORIE[categorie], categorie


def test_chaque_enseigne_a_assez_de_produits() -> None:
    for enseigne in catalogue.ENSEIGNES:
        admissibles = produits_admissibles(enseigne)
        assert len(admissibles) >= enseigne.articles_max, enseigne.nom
        assert all(c in catalogue.CATEGORIES for c in enseigne.categories), enseigne.nom


def test_epiceries_sans_categories_de_service() -> None:
    for enseigne in catalogue.ENSEIGNES_PAR_TYPE["epicerie"]:
        assert not set(enseigne.categories) & set(catalogue.CATEGORIES_SERVICE), enseigne.nom


def test_types_et_poids_coherents() -> None:
    assert set(catalogue.POIDS_TYPES) == set(catalogue.TYPES_COMMERCE)
    assert sum(catalogue.POIDS_TYPES.values()) == 100
    for t in catalogue.TYPES_COMMERCE:
        assert catalogue.ENSEIGNES_PAR_TYPE[t], t
