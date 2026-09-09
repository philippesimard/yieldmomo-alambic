# Tests des regles fiscales quebecoises.

from decimal import Decimal

import pytest

from generateur.fiscalite import (
    TAUX_TPS,
    TAUX_TVQ,
    arrondir_5_cents,
    arrondir_cent,
    calculer_monnaie,
    calculer_taxes,
    calculer_totaux,
    calculer_tps,
    calculer_tvq,
    choisir_montant_remis,
)


def test_taux_officiels() -> None:
    assert TAUX_TPS == Decimal("0.05")
    assert TAUX_TVQ == Decimal("0.09975")


@pytest.mark.parametrize(
    "base, tps, tvq",
    [
        ("100.00", "5.00", "9.98"),  # 9.975 -> 9.98 (demi vers le haut)
        ("10.00", "0.50", "1.00"),  # 0.9975 -> 1.00
        ("1.00", "0.05", "0.10"),
        ("47.83", "2.39", "4.77"),  # 2.3915 -> 2.39 ; 4.7710 -> 4.77
        ("0.01", "0.00", "0.00"),
        ("0.00", "0.00", "0.00"),
    ],
)
def test_taxes_valeurs_connues(base: str, tps: str, tvq: str) -> None:
    calcul_tps, calcul_tvq = calculer_taxes(Decimal(base))
    assert calcul_tps == Decimal(tps)
    assert calcul_tvq == Decimal(tvq)


@pytest.mark.parametrize(
    "base",
    ["1.00", "10.00", "100.00", "12.34", "99.99", "250.50", "1234.56", "7.77", "0.99"],
)
# La TVQ se calcule sur le sous-total hors TPS, jamais sur (sous-total + TPS).
def test_tvq_jamais_composee(base: str) -> None:
    montant = Decimal(base)
    tvq_parallele = arrondir_cent(montant * TAUX_TVQ)
    tvq_composee = arrondir_cent((montant + calculer_tps(montant)) * TAUX_TVQ)
    assert calculer_tvq(montant) == tvq_parallele
    # La difference de base (5 %) doit se voir des que le montant est assez grand.
    if montant >= Decimal("10"):
        assert calculer_tvq(montant) != tvq_composee
        assert calculer_tvq(montant) < tvq_composee


# Avant 2013 la TVQ etait composee. On verifie explicitement qu'on obtient 9,98 et non les
# 10,47 que donnerait 9,975 % de 105 $.
def test_tvq_composee_sur_100_dollars_donnerait_10_47() -> None:
    assert calculer_tvq(Decimal("100")) == Decimal("9.98")
    assert arrondir_cent(Decimal("105") * TAUX_TVQ) == Decimal("10.47")


def test_panier_entierement_detaxe() -> None:
    totaux = calculer_totaux(
        [
            (Decimal("4.29"), False),
            (Decimal("3.99"), False),
            (Decimal("12.47"), False),
        ]
    )
    assert totaux.sous_total == Decimal("20.75")
    assert totaux.sous_total_taxable == Decimal("0.00")
    assert totaux.tps == Decimal("0.00")
    assert totaux.tvq == Decimal("0.00")
    assert totaux.total == Decimal("20.75")


def test_panier_mixte() -> None:
    totaux = calculer_totaux(
        [
            (Decimal("10.00"), True),
            (Decimal("5.00"), False),
            (Decimal("20.00"), True),
        ]
    )
    assert totaux.sous_total == Decimal("35.00")
    assert totaux.sous_total_taxable == Decimal("30.00")
    assert totaux.sous_total_detaxe == Decimal("5.00")
    assert totaux.tps == Decimal("1.50")
    assert totaux.tvq == Decimal("2.99")  # 2.9925 -> 2.99
    assert totaux.total == Decimal("39.49")
    assert totaux.total == totaux.sous_total + totaux.tps + totaux.tvq


# Les taxes portent sur le sous-total taxable agrege, ce qui peut differer d'une somme de
# taxes par ligne a cause des arrondis.
def test_taxes_calculees_sur_le_total_taxable_et_non_ligne_par_ligne() -> None:
    lignes = [(Decimal("0.03"), True)] * 10
    totaux = calculer_totaux(lignes)
    assert totaux.sous_total_taxable == Decimal("0.30")
    assert totaux.tps == Decimal("0.02")  # 0.015 -> 0.02 ; ligne par ligne on aurait 0.00
    assert totaux.tvq == Decimal("0.03")


@pytest.mark.parametrize(
    "montant, attendu",
    [
        ("10.00", "10.00"),
        ("10.01", "10.00"),
        ("10.02", "10.00"),
        ("10.03", "10.05"),
        ("10.04", "10.05"),
        ("10.05", "10.05"),
        ("10.06", "10.05"),
        ("10.07", "10.05"),
        ("10.08", "10.10"),
        ("10.09", "10.10"),
        ("0.01", "0.00"),
        ("0.03", "0.05"),
        ("99.98", "100.00"),
        ("99.97", "99.95"),
    ],
)
def test_arrondi_comptant_5_cents(montant: str, attendu: str) -> None:
    assert arrondir_5_cents(Decimal(montant)) == Decimal(attendu)


def test_monnaie_comptant() -> None:
    assert calculer_monnaie(Decimal("17.23"), Decimal("20.00")) == Decimal("2.75")
    assert calculer_monnaie(Decimal("17.22"), Decimal("20.00")) == Decimal("2.80")
    assert calculer_monnaie(Decimal("20.00"), Decimal("20.00")) == Decimal("0.00")


def test_monnaie_insuffisante() -> None:
    with pytest.raises(ValueError):
        calculer_monnaie(Decimal("25.00"), Decimal("20.00"))


def test_montant_remis_couvre_toujours_le_total() -> None:
    for cents in range(0, 60_000, 137):
        total = arrondir_5_cents(Decimal(cents) / Decimal(100))
        remis = choisir_montant_remis(total)
        assert remis >= total
        assert remis.as_tuple().exponent == -2


def test_arrondi_cent_demi_vers_le_haut() -> None:
    assert arrondir_cent(Decimal("1.005")) == Decimal("1.01")
    assert arrondir_cent(Decimal("1.004")) == Decimal("1.00")
    assert arrondir_cent(Decimal("2.675")) == Decimal("2.68")


def test_refus_des_float() -> None:
    with pytest.raises(TypeError):
        calculer_tps(1.0)  # type: ignore[arg-type]
    with pytest.raises(TypeError):
        arrondir_cent(0.1)  # type: ignore[arg-type]


def test_types_decimaux_en_sortie() -> None:
    totaux = calculer_totaux([(Decimal("3.50"), True)])
    for champ in (totaux.sous_total, totaux.tps, totaux.tvq, totaux.total):
        assert isinstance(champ, Decimal)
        assert champ.as_tuple().exponent == -2


# ---------------------------------------------------------------------------
# Frais, exoneration, pourboires
# ---------------------------------------------------------------------------

from generateur.fiscalite import (  # noqa: E402
    calculer_frais_service,
    calculer_pourboire,
    suggestions_pourboire,
)


def test_frais_taxables_entrent_dans_la_base_et_le_total() -> None:
    lignes = [(Decimal("50.00"), True), (Decimal("10.00"), False)]
    totaux = calculer_totaux(lignes, frais_taxables=[Decimal("9.00")])
    assert totaux.sous_total == Decimal("60.00")
    assert totaux.frais == Decimal("9.00")
    # Base taxable = 50 + 9 = 59.
    assert totaux.tps == Decimal("2.95")
    assert totaux.tvq == Decimal("5.89")
    assert totaux.total == totaux.sous_total + totaux.frais + totaux.tps + totaux.tvq


def test_sans_frais_le_champ_frais_vaut_zero() -> None:
    totaux = calculer_totaux([(Decimal("10.00"), True)])
    assert totaux.frais == Decimal("0.00")


def test_exonere_annule_les_taxes_sans_toucher_aux_montants() -> None:
    lignes = [(Decimal("25.00"), True), (Decimal("5.00"), False)]
    totaux = calculer_totaux(lignes, exonere=True)
    assert totaux.sous_total == Decimal("30.00")
    assert totaux.tps == Decimal("0.00")
    assert totaux.tvq == Decimal("0.00")
    assert totaux.total == Decimal("30.00")


def test_suggestions_pourboire() -> None:
    assert suggestions_pourboire(Decimal("36.79")) == (
        (15, Decimal("5.52")),
        (18, Decimal("6.62")),
        (20, Decimal("7.36")),
    )


def test_pourboire_arrondi_au_dollar() -> None:
    assert calculer_pourboire(Decimal("61.68"), 18) == Decimal("11.10")
    assert calculer_pourboire(Decimal("61.68"), 18, arrondi_dollar=True) == Decimal("11.00")
    assert calculer_pourboire(Decimal("2.00"), 10, arrondi_dollar=True) == Decimal("1.00")


def test_frais_de_service() -> None:
    assert calculer_frais_service(Decimal("120.00"), 15) == Decimal("18.00")
    assert calculer_frais_service(Decimal("33.33"), 18) == Decimal("6.00")
