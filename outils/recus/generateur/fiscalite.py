# Regles fiscales quebecoises : TPS, TVQ et arrondis. Tout est en Decimal, aucun float n'est
# accepte pour un montant.
#
# * TPS 5 % et TVQ 9,975 % en parallele sur le sous-total taxable. La TVQ n'est pas composee
#   sur la TPS : elle l'etait avant le 1er janvier 2013, et c'est l'erreur classique.
# * Arrondi commercial au cent (ROUND_HALF_UP).
# * Comptant : total arrondi au 5 cents (la piece d'un cent a disparu en 2013), puis monnaie.
# * Frais de service et de livraison : dans la base taxable, ajoutes au total mais distincts
#   du sous-total des articles.
# * Petit fournisseur (ventes annuelles sous 30 000 $) : aucune taxe percue.
# * Pourboire : jamais taxe, ajoute apres le total.
# * Alcool : la taxe specifique est incluse dans le prix de vente et n'apparait jamais comme
#   ligne distincte.

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Iterable, Sequence

TAUX_TPS: Decimal = Decimal("0.05")
TAUX_TVQ: Decimal = Decimal("0.09975")

CENT: Decimal = Decimal("0.01")
CINQ_CENTS: Decimal = Decimal("0.05")
ZERO: Decimal = Decimal("0.00")


# Refuse explicitement les float : un montant qui passe par un float a deja perdu.
def en_decimal(valeur: Decimal | int | str) -> Decimal:
    if isinstance(valeur, float):
        raise TypeError("Les montants doivent être des Decimal, jamais des float.")
    if isinstance(valeur, Decimal):
        return valeur
    return Decimal(valeur)


# Arrondi commercial : demi vers le haut.
def arrondir_cent(montant: Decimal | int | str) -> Decimal:
    return en_decimal(montant).quantize(CENT, rounding=ROUND_HALF_UP)


def calculer_tps(sous_total_taxable: Decimal | int | str) -> Decimal:
    return arrondir_cent(en_decimal(sous_total_taxable) * TAUX_TPS)


# Sur le sous-total hors TPS. La TVQ n'est pas composee sur la TPS depuis 2013.
def calculer_tvq(sous_total_taxable: Decimal | int | str) -> Decimal:
    return arrondir_cent(en_decimal(sous_total_taxable) * TAUX_TVQ)


# TPS et TVQ en parallele, sur la meme base.
def calculer_taxes(sous_total_taxable: Decimal | int | str) -> tuple[Decimal, Decimal]:
    base = en_decimal(sous_total_taxable)
    return calculer_tps(base), calculer_tvq(base)


# La piece d'un cent a disparu en 2013 : seul le comptant est arrondi ainsi.
def arrondir_5_cents(montant: Decimal | int | str) -> Decimal:
    valeur = en_decimal(montant)
    multiples = (valeur / CINQ_CENTS).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return (multiples * CINQ_CENTS).quantize(CENT)


# Le total est d'abord arrondi au 5 cents, puis la monnaie s'en deduit.
def calculer_monnaie(total: Decimal | int | str, montant_remis: Decimal | int | str) -> Decimal:
    total_arrondi = arrondir_5_cents(total)
    remis = en_decimal(montant_remis)
    if remis < total_arrondi:
        raise ValueError(
            f"Montant remis ({remis}) insuffisant pour le total arrondi ({total_arrondi})."
        )
    return arrondir_cent(remis - total_arrondi)


# Billets et pieces courants, pour simuler un client plausible.
def choisir_montant_remis(total_arrondi: Decimal | int | str) -> Decimal:
    total = en_decimal(total_arrondi)
    paliers = [Decimal(p) for p in (5, 10, 20, 40, 50, 60, 80, 100, 120, 140, 160, 200, 300, 500)]
    for palier in paliers:
        if palier >= total:
            return palier.quantize(CENT)
    # Au-dela des paliers : on arrondit a la vingtaine superieure.
    vingtaines = (total / Decimal(20)).to_integral_value(rounding="ROUND_CEILING")
    return (vingtaines * Decimal(20)).quantize(CENT)


@dataclass(frozen=True)
class Totaux:

    sous_total: Decimal
    sous_total_taxable: Decimal
    sous_total_detaxe: Decimal
    tps: Decimal
    tvq: Decimal
    total: Decimal
    #: Frais taxables (service, livraison) hors sous-total des articles.
    frais: Decimal = ZERO


# lignes est une suite de couples (montant_net, taxable). Les frais entrent dans la base
# taxable mais restent distincts du sous-total des articles.
def calculer_totaux(
    lignes: Iterable[tuple[Decimal, bool]],
    *,
    frais_taxables: Iterable[Decimal | int | str] = (),
    exonere: bool = False,
) -> Totaux:
    sous_total_taxable = ZERO
    sous_total_detaxe = ZERO
    for montant, taxable in lignes:
        montant = arrondir_cent(montant)
        if taxable:
            sous_total_taxable += montant
        else:
            sous_total_detaxe += montant
    frais = arrondir_cent(sum((arrondir_cent(f) for f in frais_taxables), ZERO))
    sous_total = arrondir_cent(sous_total_taxable + sous_total_detaxe)
    if exonere:
        tps, tvq = ZERO, ZERO
    else:
        tps, tvq = calculer_taxes(sous_total_taxable + frais)
    total = arrondir_cent(sous_total + frais + tps + tvq)
    return Totaux(
        sous_total=sous_total,
        sous_total_taxable=arrondir_cent(sous_total_taxable),
        sous_total_detaxe=arrondir_cent(sous_total_detaxe),
        tps=tps,
        tvq=tvq,
        total=total,
        frais=frais,
    )


def calculer_frais_service(sous_total: Decimal | int | str, taux_pct: int) -> Decimal:
    return arrondir_cent(en_decimal(sous_total) * Decimal(taux_pct) / Decimal(100))


# Le pourboire n'est jamais taxe ; arrondi_dollar arrondit au dollar superieur.
def calculer_pourboire(
    base: Decimal | int | str, taux_pct: int, arrondi_dollar: bool = False
) -> Decimal:
    montant = en_decimal(base) * Decimal(taux_pct) / Decimal(100)
    if arrondi_dollar:
        montant = max(Decimal(1), montant.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return arrondir_cent(montant)


# Grille imprimee au bas des additions : ((15, 5.52), ...).
def suggestions_pourboire(
    base: Decimal | int | str, taux: Sequence[int] = (15, 18, 20)
) -> tuple[tuple[int, Decimal], ...]:
    return tuple((t, calculer_pourboire(base, t)) for t in taux)
