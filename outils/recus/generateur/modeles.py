# Modeles de donnees : ligne d'article, commerce, client, recu, style d'impression.
#
# Le recu porte la verite terrain. vers_gt_parse la serialise au format CORD (gt_parse ->
# info / menu / sub_total / total), ce qui permet de partir d'un Donut pre-entraine sur
# CORD-v2. Les cles historiques sont inchangees ; les cles ajoutees sont optionnelles et ne
# figurent que si le champ est renseigne — auquel cas il est imprime sur le recu avec une
# boite de mot portant l'etiquette homonyme.

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from .fiscalite import ZERO, arrondir_cent


# Deux decimales, point comme separateur.
def formater_montant(montant: Decimal) -> str:
    return f"{arrondir_cent(montant):.2f}"


# 1.459 au litre, 4.29 sinon.
def formater_prix_unitaire(prix: Decimal, decimales: int = 2) -> str:
    if decimales == 2:
        return formater_montant(prix)
    return f"{prix.quantize(Decimal(1).scaleb(-decimales)):.{decimales}f}"


# Entier, ou mesure a trois decimales.
def formater_quantite(quantite: Decimal, au_poids: bool) -> str:
    if au_poids:
        return f"{quantite.quantize(Decimal('0.001')):.3f}"
    return str(int(quantite))


@dataclass
# nom_imprime est rempli par le rendu : c'est exactement la chaine dessinee.
class LigneArticle:

    nom: str
    categorie: str
    taxable: bool
    quantite: Decimal
    au_poids: bool
    prix_unitaire: Decimal
    rabais: Decimal | None = None
    libelle_rabais: str | None = None
    nom_imprime: str | None = None
    unite: str | None = None
    decimales_prix: int = 2
    code_produit: str | None = None

    def __post_init__(self) -> None:
        if self.au_poids and self.unite is None:
            self.unite = "kg"
        if self.unite is not None:
            self.au_poids = True

    @property
    # Quantite x prix unitaire, arrondi au cent.
    def prix_brut(self) -> Decimal:
        return arrondir_cent(self.quantite * self.prix_unitaire)

    @property
    def prix_net(self) -> Decimal:
        if self.rabais is None:
            return self.prix_brut
        return arrondir_cent(self.prix_brut - self.rabais)

    @property
    # TX taxable, DT detaxe.
    def code_taxe(self) -> str:
        return "TX" if self.taxable else "DT"

    # Entree « menu » au format CORD.
    def vers_gt(self) -> dict[str, str]:
        if self.nom_imprime is None:
            raise ValueError(
                f"La ligne « {self.nom} » n'a pas été rendue : nom_imprime manquant."
            )
        entree: dict[str, str] = {
            "nm": self.nom_imprime,
            "cnt": formater_quantite(self.quantite, self.au_poids),
            "unitprice": formater_prix_unitaire(self.prix_unitaire, self.decimales_prix),
            "price": formater_montant(self.prix_net),
            "cat": self.categorie,
            "tax": self.code_taxe,
        }
        if self.unite is not None:
            entree["unit"] = self.unite
        if self.rabais is not None:
            entree["discountprice"] = formater_montant(self.rabais)
        if self.code_produit is not None:
            entree["sku"] = self.code_produit
        return entree


@dataclass(frozen=True)
class Adresse:

    numero: int
    rue: str
    ville: str
    code_postal: str
    province: str = "QC"

    def ligne_rue(self) -> str:
        return f"{self.numero} {self.rue}"

    def ligne_ville(self) -> str:
        return f"{self.ville}, {self.province} {self.code_postal}"

    def sur_une_ligne(self) -> str:
        return f"{self.ligne_rue()}, {self.ligne_ville()}"


@dataclass(frozen=True)
# numero_tps et numero_tvq sont absents chez un petit fournisseur, qui ne percoit pas.
class Commerce:

    enseigne: str
    nom_affiche: str
    adresse: Adresse
    telephone: str
    numero_tps: str | None
    numero_tvq: str | None
    slogan: str | None = None
    numero_succursale: str | None = None
    numero_magasin: str | None = None
    type_commerce: str = "epicerie"
    nom_legal: str | None = None
    neq: str | None = None
    courriel: str | None = None
    site_web: str | None = None
    permis_alcool: str | None = None
    petit_fournisseur: bool = False


@dataclass(frozen=True)
# Client identifie sur une facture B2B, pour ses credits de taxe.
class Client:

    nom: str
    adresse: Adresse | None = None
    numero_tps: str | None = None
    numero_tvq: str | None = None


@dataclass
class ContexteService:

    table: str | None = None
    serveur: str | None = None
    couverts: int | None = None
    numero_commande: str | None = None
    mode_service: str | None = None
    onglet: str | None = None


@dataclass
# Systeme d'enregistrement des ventes (SEV / MEV-WEB).
class InfosSev:

    numero_transaction: str
    qr_url: str | None = None
    module_mev: str | None = None
    code_autorisation: str | None = None


@dataclass
# montant_paye couvre le total final, pourboire compris.
class Paiement:

    mode: str
    montant_paye: Decimal
    arrondi_comptant: Decimal | None = None
    montant_remis: Decimal | None = None
    monnaie: Decimal | None = None
    derniers_chiffres: str | None = None
    numero_autorisation: str | None = None
    statut: str | None = None


@dataclass
# La source de la verite terrain. Invariant : sous_total est la somme des prix nets, et
# total ajoute taxes et frais.
class Recu:

    commerce: Commerce
    date: dt.date
    heure: dt.time
    lignes: list[LigneArticle]
    sous_total: Decimal
    tps: Decimal
    tvq: Decimal
    total: Decimal
    paiement: Paiement
    numero_transaction: str
    numero_caisse: str
    caissier: str
    identifiant: int = 0
    infos_supplementaires: dict[str, str] = field(default_factory=dict)
    type_document: str | None = None
    client: Client | None = None
    service: ContexteService | None = None
    sev: InfosSev | None = None
    frais_service: Decimal | None = None
    taux_frais_service: int | None = None
    frais_livraison: Decimal | None = None
    pourboire: Decimal | None = None
    suggestions_pourboire: tuple[tuple[int, Decimal], ...] = ()
    mentions: tuple[str, ...] = ()
    employe: str | None = None

    @property
    def nombre_articles(self) -> int:
        return len(self.lignes)

    @property
    def type_commerce(self) -> str:
        return self.commerce.type_commerce

    @property
    def total_final(self) -> Decimal:
        return arrondir_cent(self.total + (self.pourboire or ZERO))

    # Format CORD : les cles ajoutees sont optionnelles et ne figurent que si le champ est
    # renseigne — auquel cas il est imprime, avec une boite portant l'etiquette homonyme.
    def vers_gt_parse(self) -> dict[str, Any]:
        c = self.commerce
        info: dict[str, Any] = {
            "marchand": c.nom_affiche,
            "adresse": c.adresse.sur_une_ligne(),
            "telephone": c.telephone,
            "date": self.date.isoformat(),
            "heure": self.heure.strftime("%H:%M"),
            "type_commerce": c.type_commerce,
            "numero_facture": self.numero_transaction,
        }
        optionnels: list[tuple[str, Any]] = [
            ("type_document", self.type_document),
            ("tps_no", c.numero_tps),
            ("tvq_no", c.numero_tvq),
            ("neq", c.neq),
            ("nom_legal", c.nom_legal),
            ("courriel", c.courriel),
            ("site_web", c.site_web),
            ("permis_alcool", c.permis_alcool),
            ("petit_fournisseur", "oui" if c.petit_fournisseur else None),
        ]
        if self.sev is not None:
            optionnels += [
                ("numero_sev", self.sev.numero_transaction),
                ("mev", self.sev.module_mev),
                ("code_autorisation", self.sev.code_autorisation),
            ]
        if self.service is not None:
            s = self.service
            optionnels += [
                ("table", s.table),
                ("serveur", s.serveur),
                ("couverts", str(s.couverts) if s.couverts is not None else None),
                ("commande", s.numero_commande),
                ("service", s.mode_service),
                ("onglet", s.onglet),
            ]
        optionnels.append(("employe", self.employe))
        for cle, valeur in optionnels:
            if valeur is not None:
                info[cle] = valeur
        if self.client is not None:
            client: dict[str, str] = {"nom": self.client.nom}
            if self.client.adresse is not None:
                client["adresse"] = self.client.adresse.sur_une_ligne()
            if self.client.numero_tps is not None:
                client["tps_no"] = self.client.numero_tps
            if self.client.numero_tvq is not None:
                client["tvq_no"] = self.client.numero_tvq
            info["client"] = client

        sub_total: dict[str, str] = {
            "subtotal_price": formater_montant(self.sous_total),
            "tps": formater_montant(self.tps),
            "tvq": formater_montant(self.tvq),
        }
        if self.frais_service is not None:
            sub_total["frais_service"] = formater_montant(self.frais_service)
        if self.frais_livraison is not None:
            sub_total["frais_livraison"] = formater_montant(self.frais_livraison)

        total: dict[str, str] = {
            "total_price": formater_montant(self.total),
            "menutype_cnt": str(self.nombre_articles),
            "paiement": self.paiement.mode,
        }
        if self.pourboire is not None:
            total["pourboire"] = formater_montant(self.pourboire)
            total["total_final"] = formater_montant(self.total_final)
        if self.paiement.arrondi_comptant is not None and self.paiement.arrondi_comptant != ZERO:
            total["arrondi"] = formater_montant(self.paiement.arrondi_comptant)

        return {
            "gt_parse": {
                "info": info,
                "menu": [ligne.vers_gt() for ligne in self.lignes],
                "sub_total": sub_total,
                "total": total,
            }
        }


@dataclass(frozen=True)
# Tire par contenu.py ; le rendu ne fait qu'appliquer.
class StyleImpression:

    police: str
    taille_police: int
    largeur_colonnes: int
    marge: int
    interligne: float
    densite_encre: float
    teinte_papier: tuple[int, int, int]
    majuscules: bool
    sans_accents: bool
    abreviations: bool
    format_poids: str
    format_multiple: str
    separateur: str
    afficher_codes_taxe: bool
    afficher_categorie_entete: bool
    position_prix: str
    afficher_code_produit: bool
    lignes_pied: tuple[str, ...]
    lignes_entete: tuple[str, ...]
    bilingue: bool = False
    quantite_en_prefixe: bool = False
    sku_sous_nom: bool = False
