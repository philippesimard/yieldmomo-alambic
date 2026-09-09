# Mise en page facon imprimante thermique, et capture des boites de mots. Deterministe a partir
# du recu, du style et du random.Random fourni.
#
# Chaque mot imprime est memorise avec son etiquette semantique (nm, price, total_price, tps,
# date...), son indice d'article le cas echeant, et sa boite en pixels sur l'image propre. Ces
# etiquettes sont le contrat que lit l'entrainement : voir ../entrainement/donnees.py.
#
# La mise en page depend du type de commerce : un Compositeur de base (epicerie, depanneur,
# pharmacie) et des sous-classes pour la restauration avec service, les comptoirs, le detail
# specialise et les stations-service. Un bloc est sans effet quand le champ correspondant est
# absent : c'est contenu.py qui decide de la presence d'une information.
#
# Regle absolue : LigneArticle.nom_imprime est pose ici et contient exactement la chaine
# dessinee — majuscules, accents perdus, abreviations et troncature compris.

from __future__ import annotations

import functools
import math
import random
import unicodedata
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Sequence

import numpy as np
import segno
from PIL import Image, ImageDraw, ImageFont

from . import catalogue
from .modeles import (
    LigneArticle,
    Recu,
    StyleImpression,
    formater_montant,
    formater_prix_unitaire,
    formater_quantite,
)

TypePolice = ImageFont.FreeTypeFont | ImageFont.ImageFont

#: Modules de marge (zone silencieuse) autour du code QR.
BORDURE_QR: int = 2


# ---------------------------------------------------------------------------
# Structures
# ---------------------------------------------------------------------------


@dataclass
# En pixels, sur l'image propre.
class BoiteMot:

    texte: str
    etiquette: str
    indice_ligne: int | None
    x0: float
    y0: float
    x1: float
    y1: float

    # Huit coordonnees, sens horaire depuis le coin haut-gauche.
    def quad(self) -> list[float]:
        return [self.x0, self.y0, self.x1, self.y0, self.x1, self.y1, self.x0, self.y1]


@dataclass
# Un fragment de texte etiquete, place a une colonne.
class Segment:

    col: int
    texte: str
    etiquette: str
    indice_ligne: int | None = None


@dataclass
# Segments sur la grille, texte centre ou agrandi, ou code QR.
class Rangee:

    segments: list[Segment] = field(default_factory=list)
    centrer: bool = False
    facteur_taille: float = 1.0
    vide: bool = False
    #: URL encodee dans un code QR (rangee sans segments).
    qr: str | None = None


@dataclass
class ResultatRendu:

    image: Image.Image
    boites: list[BoiteMot]
    recu: Recu
    style: StyleImpression


TypeSegments = Sequence[tuple[str, str, int | None]]


# ---------------------------------------------------------------------------
# Polices
# ---------------------------------------------------------------------------


@functools.lru_cache(maxsize=1)
# Ce que cette machine sait charger : la liste depend du poste, donc un jeu n'est
# reproductible au bit pres que sur une machine aux memes polices.
def polices_disponibles() -> tuple[str, ...]:
    valides: list[str] = []
    for chemin in catalogue.POLICES_CANDIDATES:
        try:
            police = ImageFont.truetype(chemin, 20)
            # On exige que les accents soient dessinables (largeur non nulle).
            if police.getlength("É") > 0:
                valides.append(chemin)
        except OSError:
            continue
    return tuple(valides)


@functools.lru_cache(maxsize=64)
# Repli sur la police bitmap de PIL si rien ne charge.
def charger_police(chemin: str, taille: int) -> TypePolice:
    if chemin:
        try:
            return ImageFont.truetype(chemin, taille)
        except OSError:
            pass
    try:
        return ImageFont.load_default(size=taille)
    except TypeError:  # anciennes versions de Pillow
        return ImageFont.load_default()


# ---------------------------------------------------------------------------
# Code QR
# ---------------------------------------------------------------------------


@functools.lru_cache(maxsize=512)
# Deterministe pour une URL donnee.
def matrice_qr(url: str) -> tuple[tuple[int, ...], ...]:
    code = segno.make_qr(url, error="m", boost_error=False)
    return tuple(tuple(int(v) for v in ligne) for ligne in code.matrix)


def echelle_qr(style: StyleImpression) -> int:
    return max(2, style.taille_police // 6)


def hauteur_rangee(rangee: Rangee, style: StyleImpression, hauteur_ligne_base: int) -> int:
    if rangee.qr is not None:
        modules = len(matrice_qr(rangee.qr))
        return (modules + 2 * BORDURE_QR) * echelle_qr(style) + hauteur_ligne_base // 2
    return int(round(hauteur_ligne_base * rangee.facteur_taille))


# ---------------------------------------------------------------------------
# Texte : accents, majuscules, abreviations, troncature
# ---------------------------------------------------------------------------


# « Epinards » et non « Epinards ».
def retirer_accents(texte: str) -> str:
    decompose = unicodedata.normalize("NFKD", texte)
    return "".join(c for c in decompose if not unicodedata.combining(c))


# Le texte est deja en majuscules et sans accents.
def abreger(texte: str) -> str:
    mots = texte.split(" ")
    return " ".join(catalogue.ABREVIATIONS.get(m, m) for m in mots)


def normaliser_nom(nom: str, style: StyleImpression) -> str:
    texte = nom
    if style.sans_accents:
        texte = retirer_accents(texte)
    if style.majuscules:
        texte = texte.upper()
    if style.abreviations:
        texte = abreger(retirer_accents(texte).upper())
    return " ".join(texte.split())


def tronquer(texte: str, largeur: int) -> str:
    return texte[:largeur].strip()


def formater_nom_imprime(nom: str, style: StyleImpression, largeur: int) -> str:
    return tronquer(normaliser_nom(nom, style), largeur)


# Hors articles : accents et majuscules seulement, jamais d'abreviation.
def texte_general(texte: str, style: StyleImpression) -> str:
    if style.sans_accents:
        texte = retirer_accents(texte)
    if style.majuscules:
        texte = texte.upper()
    return texte


# Par mots, sans jamais perdre de texte.
def couper_en_lignes(texte: str, largeur: int) -> list[str]:
    lignes: list[str] = []
    courante = ""
    for mot in texte.split(" "):
        if not courante:
            courante = mot
        elif len(courante) + 1 + len(mot) <= largeur:
            courante += " " + mot
        else:
            lignes.append(courante)
            courante = mot
    if courante:
        lignes.append(courante)
    return lignes


# ---------------------------------------------------------------------------
# Composition des rangees
# ---------------------------------------------------------------------------


# Gabarit de base : epicerie, depanneur, pharmacie.
class Compositeur:

    def __init__(self, recu: Recu, style: StyleImpression, rng: random.Random) -> None:
        self.recu = recu
        self.style = style
        self.rng = rng
        self.type = recu.type_commerce
        self.colonnes = style.largeur_colonnes
        self.rangees: list[Rangee] = []
        if self.type in catalogue.TYPES_DETAIL:
            codes = rng.choice((("FP", ""), ("FP", ""), ("TX", "DT"), ("F", ""), ("*", ""), ("T", "N")))
        else:
            codes = rng.choice((("TX", "DT"), ("TX", "DT"), ("T", "N"), ("FP", ""), ("TF", ""), ("*", "")))
        self.code_taxable, self.code_detaxe = codes
        self.symbole_dollar = rng.random() < 0.3
        self.numeros_taxes_en_tete = rng.random() < 0.5
        self.format_date = rng.choice(("iso", "iso", "iso", "jma", "amj_barre", "libelle"))
        self.afficher_secondes = rng.random() < 0.4
        self.libelle_paiement = rng.choice(catalogue.LIBELLES_PAIEMENT[recu.paiement.mode])
        self.prefixe_facture = rng.choice(catalogue.PREFIXES_NUMERO_FACTURE)
        self.taxes_nulles_imprimees = rng.random() < 0.5  # petit fournisseur : lignes a 0.00 ou absentes
        self.libelle_tps = rng.choice(("TPS", "TPS 5%", "TPS 5.000%", "TPS (5%)"))
        self.libelle_tvq = rng.choice(("TVQ", "TVQ 9.975%", "TVQ 9,975%", "TVQ (9.975%)"))

    # -- utilitaires --------------------------------------------------------

    def _t(self, texte: str) -> str:
        return texte_general(texte, self.style)

    def _lib(self, texte: str) -> str:
        if self.style.bilingue:
            texte = catalogue.LIBELLES_BILINGUES.get(texte, texte)
        return self._t(texte)

    def vide(self) -> None:
        self.rangees.append(Rangee(vide=True))

    def separateur(self) -> None:
        motif = self.style.separateur
        if motif == " ":
            self.vide()
            return
        self.rangees.append(Rangee([Segment(0, motif * self.colonnes, "autre")]))

    def centre(self, texte: str, etiquette: str, facteur: float = 1.0) -> None:
        for morceau in couper_en_lignes(texte, max(8, int(self.colonnes / facteur))):
            self.rangees.append(
                Rangee([Segment(0, morceau, etiquette)], centrer=True, facteur_taille=facteur)
            )

    def centre_segments(self, segments: TypeSegments) -> None:
        pleins = [(t, e, i) for t, e, i in segments if t]
        if not pleins:
            return
        largeur = sum(len(t) for t, _, _ in pleins) + len(pleins) - 1
        if largeur > self.colonnes:
            for texte, etiquette, _ in pleins:
                self.centre(texte, etiquette)
            return
        rangee = Rangee(centrer=True)
        col = 0
        for texte, etiquette, indice in pleins:
            rangee.segments.append(Segment(col, texte, etiquette, indice))
            col += len(texte) + 1
        self.rangees.append(rangee)

    def gauche(self, segments: TypeSegments) -> None:
        pleins = [(t, e, i) for t, e, i in segments if t]
        rangee = Rangee()
        col = 0
        for texte, etiquette, indice in pleins:
            if rangee.segments and col + len(texte) > self.colonnes:
                self.rangees.append(rangee)
                rangee = Rangee()
                col = 0
            rangee.segments.append(Segment(col, texte, etiquette, indice))
            col += len(texte) + 1
        self.rangees.append(rangee)

    def gauche_droite(self, gauche: TypeSegments, droite: TypeSegments) -> None:
        textes_gauche = [(t, e, i) for t, e, i in gauche if t]
        textes_droite = [(t, e, i) for t, e, i in droite if t]
        largeur_gauche = sum(len(t) for t, _, _ in textes_gauche) + max(0, len(textes_gauche) - 1)
        largeur_droite = sum(len(t) for t, _, _ in textes_droite) + max(0, len(textes_droite) - 1)
        if textes_gauche and textes_droite and largeur_gauche + 1 + largeur_droite > self.colonnes:
            self.gauche(textes_gauche)
            textes_gauche = []
        rangee = Rangee()
        col = 0
        for texte, etiquette, indice in textes_gauche:
            rangee.segments.append(Segment(col, texte, etiquette, indice))
            col += len(texte) + 1
        col_d = max(col, self.colonnes - largeur_droite)
        for texte, etiquette, indice in textes_droite:
            rangee.segments.append(Segment(col_d, texte, etiquette, indice))
            col_d += len(texte) + 1
        if rangee.segments:
            self.rangees.append(rangee)

    def ligne_ou_lignes(self, morceaux: Sequence[TypeSegments]) -> None:
        groupes = [[(t, e, i) for t, e, i in m if t] for m in morceaux]
        groupes = [g for g in groupes if g]
        if not groupes:
            return
        largeur = sum(sum(len(t) for t, _, _ in g) + len(g) - 1 for g in groupes) + 3 * (len(groupes) - 1)
        if largeur <= self.colonnes:
            segments: list[tuple[str, str, int | None]] = []
            for k, g in enumerate(groupes):
                if k:
                    segments.append((" ", "autre", None))
                segments.extend(g)
            self.gauche(segments)
        else:
            for g in groupes:
                self.gauche(g)

    def montant(self, valeur: Decimal, negatif: bool = False) -> str:
        texte = formater_montant(valeur)
        if negatif:
            texte = "-" + texte if self.rng.random() < 0.7 else texte + "-"
        if self.symbole_dollar:
            texte = texte + "$" if self.rng.random() < 0.5 else "$" + texte
        return texte

    # -- en-tete et identification --------------------------------------------

    def entete(self) -> None:
        c = self.recu.commerce
        self.vide()
        self.centre(c.nom_affiche, "marchand", facteur=1.35)
        if c.slogan and self.rng.random() < 0.7:
            self.centre(self._t(c.slogan), "autre")
        if c.numero_succursale:
            self.centre(self._t(f"Succ. {c.numero_succursale}"), "autre")
        elif c.numero_magasin:
            self.centre(self._t(f"Magasin # {c.numero_magasin}"), "autre")
        self.centre(self._t(c.adresse.ligne_rue()), "adresse")
        self.centre(self._t(c.adresse.ligne_ville()), "adresse")
        prefixe_tel = self.rng.choice(("Tel:", "Tel.", "Tél:", "T:", ""))
        self.centre(self._t(f"{prefixe_tel} {c.telephone}".strip()), "telephone")
        self.bloc_identite()
        if self.numeros_taxes_en_tete:
            self.numeros_taxes()
        self.separateur()

    def bloc_identite(self) -> None:
        c = self.recu.commerce
        if c.nom_legal:
            prefixe = self.rng.choice(("Exploité par", "Opéré par", "Une division de", ""))
            self.centre_segments([(self._t(prefixe), "autre", None), (c.nom_legal, "nom_legal", None)])
        if c.neq:
            prefixe = self.rng.choice(("NEQ", "NEQ:", "NEQ #", "No NEQ"))
            self.centre_segments([(prefixe, "autre", None), (c.neq, "neq", None)])
        if c.permis_alcool:
            prefixe = self.rng.choice(("Permis RACJ", "Permis d'alcool", "Permis RACJ no", "RACJ"))
            self.centre_segments([(self._t(prefixe), "autre", None), (c.permis_alcool, "permis_alcool", None)])
        if c.courriel:
            self.centre(c.courriel, "courriel")
        if c.site_web:
            site = ("www." + c.site_web) if self.rng.random() < 0.4 else c.site_web
            self.centre(site, "site_web")

    def numeros_taxes(self) -> None:
        c = self.recu.commerce
        if c.numero_tps is None and c.numero_tvq is None:
            return
        forme = self.rng.choice(("deux_lignes", "deux_lignes", "une_ligne"))
        p_tps = self.rng.choice(("TPS:", "TPS", "No TPS:", "TPS #", "TPS/GST:" if self.style.bilingue else "TPS:"))
        p_tvq = p_tps.replace("TPS", "TVQ").replace("GST", "QST")
        if forme == "une_ligne" and c.numero_tps and c.numero_tvq:
            self.ligne_ou_lignes([
                [(p_tps, "autre", None), (c.numero_tps, "tps_no", None)],
                [(p_tvq, "autre", None), (c.numero_tvq, "tvq_no", None)],
            ])
            return
        if c.numero_tps:
            self.gauche([(p_tps, "autre", None), (c.numero_tps, "tps_no", None)])
        if c.numero_tvq:
            self.gauche([(p_tvq, "autre", None), (c.numero_tvq, "tvq_no", None)])

    # -- document, client, service ---------------------------------------------

    def bloc_document(self) -> None:
        recu = self.recu
        if recu.type_document:
            self.centre(self._t(recu.type_document), "type_document", facteur=1.2)
        self.date_heure()
        self.ligne_caisse()
        prefixe = self.prefixe_facture
        if recu.type_document and prefixe.upper() in ("RECU", "FACTURE"):
            prefixe = self.rng.choice(("No", "No facture", "#", "Facture no", "No"))
        self.gauche([(self._t(prefixe), "autre", None), (recu.numero_transaction, "numero_facture", None)])
        if recu.employe:
            prefixe = self.rng.choice(("Employé", "Empl.", "Vendeur", "Employé #", "Conseiller"))
            self.gauche([(self._t(prefixe), "autre", None), (recu.employe, "employe", None)])
        if "membre" in recu.infos_supplementaires:
            self.gauche([(self._t(f"Membre {recu.infos_supplementaires['membre']}"), "autre", None)])
        self.separateur()

    def ligne_caisse(self) -> None:
        recu = self.recu
        pieces: list[tuple[str, str, int | None]] = [
            (self._t(f"{self._lib('Caisse')} {recu.numero_caisse}"), "autre", None),
            (self._t(f"Caissier: {recu.caissier}"), "autre", None),
        ]
        if len(" ".join(p[0] for p in pieces)) > self.colonnes:
            pieces = pieces[:1]
        self.gauche(pieces)

    def date_heure(self) -> None:
        d, h = self.recu.date, self.recu.heure
        if self.format_date == "iso":
            texte_date = d.isoformat()
        elif self.format_date == "jma":
            texte_date = d.strftime("%d/%m/%Y")
        elif self.format_date == "amj_barre":
            texte_date = d.strftime("%Y/%m/%d")
        else:
            texte_date = d.isoformat()
        texte_heure = h.strftime("%H:%M:%S") if self.afficher_secondes else h.strftime("%H:%M")
        if self.format_date == "libelle":
            self.gauche([(self._lib("Date") + ":", "autre", None), (texte_date, "date", None),
                         (self._lib("Heure") + ":", "autre", None), (texte_heure, "heure", None)])
        else:
            self.gauche_droite([(texte_date, "date", None)], [(texte_heure, "heure", None)])

    def bloc_client(self) -> None:
        client = self.recu.client
        if client is None:
            return
        titre = self.rng.choice(("Facturé à", "Client", "Facturé à", "Vendu à"))
        self.gauche([(self._lib(titre) + ":", "autre", None)])
        for morceau in couper_en_lignes(self._t(client.nom), self.colonnes):
            self.gauche([(morceau, "client_nom", None)])
        if client.adresse is not None:
            for texte in (client.adresse.ligne_rue(), client.adresse.ligne_ville()):
                for morceau in couper_en_lignes(self._t(texte), self.colonnes):
                    self.gauche([(morceau, "client_adresse", None)])
        if client.numero_tps:
            self.gauche([("TPS:", "autre", None), (client.numero_tps, "client_tps_no", None)])
        if client.numero_tvq:
            self.gauche([("TVQ:", "autre", None), (client.numero_tvq, "client_tvq_no", None)])
        self.separateur()

    def bloc_service(self) -> None:  # surcharge par les sous-classes
        return

    # -- articles ---------------------------------------------------------------

    def code_taxe(self, ligne: LigneArticle) -> str:
        if not self.style.afficher_codes_taxe:
            return ""
        return self.code_taxable if ligne.taxable else self.code_detaxe

    def avant_article(self, ligne: LigneArticle, indice: int) -> None:  # crochet (station-service)
        return

    def articles(self) -> None:
        style = self.style
        largeur_code = max(len(self.code_taxable), len(self.code_detaxe)) if style.afficher_codes_taxe else 0
        largeur_prix = 8 + (1 if self.symbole_dollar else 0)
        largeur_nom_avec_prix = self.colonnes - largeur_prix - (largeur_code + 1 if largeur_code else 0) - 1
        largeur_nom_seul = self.colonnes - (largeur_code + 1 if largeur_code else 0) - 1
        categorie_courante: str | None = None
        for indice, ligne in enumerate(self.recu.lignes):
            if style.afficher_categorie_entete and ligne.categorie != categorie_courante:
                categorie_courante = ligne.categorie
                self.gauche([(self._t(ligne.categorie.replace("_", " ").upper()), "autre", None)])
            self.avant_article(ligne, indice)
            if ligne.code_produit and not style.sku_sous_nom:
                self.gauche([(ligne.code_produit, "sku", indice)])
            prefixe = style.quantite_en_prefixe and not ligne.au_poids
            simple = ligne.quantite == 1 and not ligne.au_poids
            detail = "" if simple else self._texte_detail(ligne)
            # Le prix passe sur la ligne du nom si la ligne de quantite ne peut l'accueillir.
            place_detail = self.colonnes - len(detail) - 2 - largeur_prix - (largeur_code + 1 if largeur_code else 0)
            prix_sur_nom = prefixe or simple or style.position_prix == "meme_ligne" or place_detail < 0
            largeur_nom = largeur_nom_avec_prix if prix_sur_nom else largeur_nom_seul
            texte_quantite = formater_quantite(ligne.quantite, False) if prefixe else ""
            if prefixe:
                largeur_nom -= len(texte_quantite) + 1
            nom_imprime = formater_nom_imprime(ligne.nom, style, max(6, largeur_nom))
            ligne.nom_imprime = nom_imprime
            code = self.code_taxe(ligne)
            gauche: list[tuple[str, str, int | None]] = []
            if prefixe:
                gauche.append((texte_quantite, "cnt", indice))
            gauche.append((nom_imprime, "nm", indice))
            droite: list[tuple[str, str, int | None]] = []
            if prix_sur_nom:
                droite.append((self.montant(ligne.prix_brut), "price", indice))
                droite.append((code, "tax", indice))
            self.gauche_droite(gauche, droite)
            if ligne.code_produit and style.sku_sous_nom:
                self.gauche([("  ", "autre", None), (ligne.code_produit, "sku", indice)])
            if not simple:
                segments = self._etiqueter_detail(detail, ligne, indice, "autre" if prefixe else "cnt")
                droite_detail: list[tuple[str, str, int | None]] = []
                if not prix_sur_nom:
                    droite_detail.append((self.montant(ligne.prix_brut), "price", indice))
                    droite_detail.append((code, "tax", indice))
                self.gauche_droite(segments, droite_detail)
            if ligne.rabais is not None and ligne.libelle_rabais:
                libelle = self._t(ligne.libelle_rabais)
                self.gauche_droite(
                    [("  " + libelle, "discount_label", indice)],
                    [(self.montant(ligne.rabais, negatif=True), "discountprice", indice), (code, "tax", indice)],
                )

    def _texte_detail(self, ligne: LigneArticle) -> str:
        prix = formater_prix_unitaire(ligne.prix_unitaire, ligne.decimales_prix)
        if ligne.au_poids:
            unite = ligne.unite or "kg"
            return self.style.format_poids.format(
                poids=formater_quantite(ligne.quantite, True), prix=prix, u=unite, U=unite.upper()
            )
        return self.style.format_multiple.format(n=formater_quantite(ligne.quantite, False), prix=prix)

    # Etiquette chaque mot de « 0.842 kg x 4.39/kg ».
    def _etiqueter_detail(
        self, detail: str, ligne: LigneArticle, indice: int, etiquette_quantite: str = "cnt"
    ) -> list[tuple[str, str, int | None]]:
        quantite = formater_quantite(ligne.quantite, ligne.au_poids)
        prix = formater_prix_unitaire(ligne.prix_unitaire, ligne.decimales_prix)
        unite = (ligne.unite or "kg").lower()
        segments: list[tuple[str, str, int | None]] = [("  ", "autre", None)]
        for mot in detail.split(" "):
            if mot == quantite:
                segments.append((mot, etiquette_quantite, indice))
            elif mot.lower().endswith(unite) and mot[: -len(unite)] == quantite:
                # « 0.842kg » colle : on separe pour garder cnt pur.
                segments.append((quantite, etiquette_quantite, indice))
                segments.append((mot[len(quantite):], "unit", indice))
            elif prix in mot:
                segments.append((mot, "unitprice", indice))
            elif mot.lower() == unite:
                segments.append((mot, "unit", indice))
            else:
                segments.append((mot, "autre", None))
        return segments

    # -- totaux, pourboire, paiement ---------------------------------------------

    def totaux(self) -> None:
        recu = self.recu
        self.separateur()
        self.gauche_droite([(self._lib("Sous-total"), "subtotal_label", None)],
                           [(self.montant(recu.sous_total), "subtotal_price", None)])
        if recu.frais_service is not None:
            libelle = self._lib(self.rng.choice(catalogue.LIBELLES_FRAIS_SERVICE))
            if recu.taux_frais_service and self.rng.random() < 0.7:
                libelle = f"{libelle} {recu.taux_frais_service}%"
            self.gauche_droite([(libelle, "frais_service_label", None)],
                               [(self.montant(recu.frais_service), "frais_service", None)])
        if recu.frais_livraison is not None:
            libelle = self._lib(self.rng.choice(catalogue.LIBELLES_LIVRAISON))
            self.gauche_droite([(libelle, "frais_livraison_label", None)],
                               [(self.montant(recu.frais_livraison), "frais_livraison", None)])
        if not recu.commerce.petit_fournisseur or self.taxes_nulles_imprimees:
            self.gauche_droite([(self._lib(self.libelle_tps) if self.libelle_tps == "TPS" else self.libelle_tps, "tps_label", None)],
                               [(self.montant(recu.tps), "tps", None)])
            self.gauche_droite([(self._lib(self.libelle_tvq) if self.libelle_tvq == "TVQ" else self.libelle_tvq, "tvq_label", None)],
                               [(self.montant(recu.tvq), "tvq", None)])
        self.gauche_droite([(self._lib("TOTAL"), "total_label", None)],
                           [(self.montant(recu.total), "total_price", None)])
        self.ligne_nombre_articles()
        self.separateur()

    def ligne_nombre_articles(self) -> None:
        n = str(self.recu.nombre_articles)
        forme = self.rng.choice(("articles_avant", "articles_apres", "nombre", "nombre"))
        if forme == "articles_avant":
            self.gauche([(n, "menutype_cnt", None), (self._t("article(s)"), "autre", None)])
        elif forme == "articles_apres":
            self.gauche([(self._t("Nombre d'articles:"), "autre", None), (n, "menutype_cnt", None)])
        else:
            libelle = self._lib(self.rng.choice(catalogue.LIBELLES_ARTICLES))
            self.gauche_droite([(libelle, "autre", None)], [(n, "menutype_cnt", None)])

    def bloc_pourboire_ajoute(self) -> None:
        recu = self.recu
        if recu.pourboire is None:
            return
        libelle = self._lib(self.rng.choice(catalogue.LIBELLES_POURBOIRE))
        self.gauche_droite([(libelle, "pourboire_label", None)],
                           [(self.montant(recu.pourboire), "pourboire", None)])
        libelle_total = self._lib(self.rng.choice(catalogue.LIBELLES_TOTAL_FINAL))
        self.gauche_droite([(libelle_total, "total_final_label", None)],
                           [(self.montant(recu.total_final), "total_final", None)])

    # Aucune verite terrain : rien n'est etiquete.
    def bloc_suggestions_pourboire(self) -> None:
        recu = self.recu
        if not recu.suggestions_pourboire:
            return
        self.vide()
        self.centre(self._t(self.rng.choice(catalogue.LIBELLES_SUGGESTION_POURBOIRE)), "autre")
        forme = self.rng.choice(("ligne", "ligne", "colonnes"))
        if forme == "ligne":
            morceaux = [f"{taux}% = {formater_montant(m)}" for taux, m in recu.suggestions_pourboire]
            texte = "   ".join(morceaux)
            if len(texte) > self.colonnes:
                for morceau in morceaux:
                    self.centre(morceau, "autre")
            else:
                self.centre(texte, "autre")
        else:
            for taux, m in recu.suggestions_pourboire:
                self.gauche_droite([(f"{taux}%", "autre", None)], [(formater_montant(m), "autre", None)])
        if self.rng.random() < 0.6:
            trait = "_" * self.rng.randint(8, 12)
            self.vide()
            self.gauche([(self._lib("Pourboire") + ":", "autre", None), (trait, "autre", None)])
            self.gauche([(self._lib("TOTAL") + ":", "autre", None), (trait, "autre", None)])
            if self.rng.random() < 0.5:
                self.gauche([(self._t("Signature:"), "autre", None), (trait + "____", "autre", None)])
        self.vide()

    def paiement(self) -> None:
        p = self.recu.paiement
        if p.mode == "COMPTANT":
            if p.arrondi_comptant is not None and p.arrondi_comptant != Decimal("0.00"):
                signe = "" if p.arrondi_comptant > 0 else "-"
                self.gauche_droite([(self._lib("Arrondi"), "autre", None)],
                                   [(signe + formater_montant(abs(p.arrondi_comptant)), "arrondi", None)])
            self.gauche_droite([(self._t(self.libelle_paiement), "paiement", None)],
                               [(self.montant(p.montant_remis or p.montant_paye), "autre", None)])
            if p.monnaie is not None:
                self.gauche_droite([(self._lib("Monnaie"), "autre", None)],
                                   [(self.montant(p.monnaie), "autre", None)])
        else:
            self.gauche_droite([(self._t(self.libelle_paiement), "paiement", None)],
                               [(self.montant(p.montant_paye), "autre", None)])
            if p.derniers_chiffres and self.rng.random() < 0.8:
                self.gauche([(self._t("Carte"), "autre", None), (f"************{p.derniers_chiffres}", "autre", None)])
            if p.numero_autorisation and self.rng.random() < 0.7:
                self.gauche([(self._t("Autorisation:"), "autre", None), (p.numero_autorisation, "autre", None)])
            if p.statut:
                self.gauche([(self._t(p.statut), "autre", None)])
        if "copie" in self.recu.infos_supplementaires:
            self.centre(self._t(self.recu.infos_supplementaires["copie"]), "autre")

    # -- SEV, mentions, pied ---------------------------------------------------

    def bloc_sev(self) -> None:
        sev = self.recu.sev
        if sev is None:
            return
        self.vide()
        if sev.qr_url:
            self.rangees.append(Rangee(qr=sev.qr_url))
        prefixe = self._t(self.rng.choice(catalogue.LIBELLES_NUMERO_SEV))
        if self.rng.random() < 0.5:
            self.centre_segments([(prefixe, "autre", None), (sev.numero_transaction, "numero_sev", None)])
        else:
            self.gauche([(prefixe, "autre", None), (sev.numero_transaction, "numero_sev", None)])
        if self.rng.random() < 0.7:
            self.centre(self._t(self.rng.choice(catalogue.LIBELLES_SEV)), "autre")
        if sev.module_mev:
            prefixe_mev = self.rng.choice(("MEV:", "MEV", "Module MEV", "No MEV"))
            self.gauche([(prefixe_mev, "autre", None), (sev.module_mev, "mev", None)])
        if sev.code_autorisation:
            prefixe_code = self._t(self.rng.choice(("Code d'autorisation:", "Autorisation SEV", "Code aut.", "Code SEV")))
            self.gauche([(prefixe_code, "autre", None), (sev.code_autorisation, "code_autorisation", None)])

    def bloc_petit_fournisseur(self) -> None:
        if not self.recu.commerce.petit_fournisseur:
            return
        mention = self.rng.choice((
            "Petit fournisseur - aucune taxe applicable",
            "Petit fournisseur: TPS et TVQ non applicables",
            "Aucune taxe applicable (petit fournisseur)",
            "Petit fournisseur non inscrit - taxes non percues",
        ))
        self.vide()
        self.centre(self._t(mention), "petit_fournisseur")

    def pied(self) -> None:
        recu = self.recu
        if not self.numeros_taxes_en_tete and not recu.commerce.petit_fournisseur:
            self.separateur()
            self.numeros_taxes()
        enseigne = next((e for e in catalogue.ENSEIGNES if e.nom == recu.commerce.enseigne), None)
        self.vide()
        if enseigne is not None and enseigne.lignes_pied and self.rng.random() < 0.8:
            self.centre(self._t(self.rng.choice(enseigne.lignes_pied)), "autre")
        for mention in recu.mentions:
            self.centre(self._t(mention), "autre")
        for ligne in self.style.lignes_pied:
            self.centre(self._lib(ligne), "autre")
        self.vide()

    def composer(self) -> list[Rangee]:
        self.entete()
        self.bloc_document()
        self.bloc_client()
        self.bloc_service()
        self.articles()
        self.totaux()
        self.bloc_pourboire_ajoute()
        self.paiement()
        self.bloc_suggestions_pourboire()
        self.bloc_sev()
        self.bloc_petit_fournisseur()
        self.pied()
        return self.rangees


# Avec service : table, serveur, couverts, onglet.
class CompositeurRestaurant(Compositeur):

    def ligne_caisse(self) -> None:
        # Les additions n'affichent pas toujours la caisse ; le serveur remplace le caissier.
        if self.rng.random() < 0.5:
            self.gauche([(self._t(f"{self._lib('Caisse')} {self.recu.numero_caisse}"), "autre", None)])

    def bloc_service(self) -> None:
        s = self.recu.service
        if s is None:
            return
        groupes: list[TypeSegments] = []
        if s.onglet:
            groupes.append([(self._t(self.rng.choice(("Onglet", "Onglet #", "Tab", "Onglet no"))), "autre", None), (s.onglet, "onglet", None)])
        if s.table:
            groupes.append([(self._lib("Table") + self.rng.choice(("", ":", " #")), "autre", None), (s.table, "table", None)])
        if s.serveur:
            groupes.append([(self._lib("Serveur") + self.rng.choice((":", "", " :")), "autre", None), (self._t(s.serveur), "serveur", None)])
        if s.couverts is not None:
            groupes.append([(self._t(self.rng.choice(("Couverts:", "Couverts", "Clients:", "Pers.:"))), "autre", None), (str(s.couverts), "couverts", None)])
        self.ligne_ou_lignes(groupes)
        if s.mode_service:
            self.centre(self._t(s.mode_service), "service")
        if groupes or s.mode_service:
            self.separateur()


# Cafes et restauration rapide : numero de commande.
class CompositeurComptoir(Compositeur):

    def bloc_service(self) -> None:
        s = self.recu.service
        if s is None:
            return
        gauche: list[tuple[str, str, int | None]] = []
        if s.numero_commande:
            prefixe = self._lib(self.rng.choice(("Commande", "Commande", "No commande", "Cmd")))
            if self.rng.random() < 0.6:
                gauche = [(prefixe, "autre", None), ("#", "autre", None), (s.numero_commande, "commande", None)]
            else:
                gauche = [(prefixe + ":", "autre", None), (s.numero_commande, "commande", None)]
        droite: list[tuple[str, str, int | None]] = []
        if s.mode_service:
            droite = [(self._t(s.mode_service), "service", None)]
        if gauche or droite:
            if gauche and droite and len(" ".join(t for t, _, _ in gauche)) + 1 + len(droite[0][0]) > self.colonnes:
                self.gauche(gauche)
                self.centre(droite[0][0], "service")
            elif gauche:
                self.gauche_droite(gauche, droite)
            else:
                self.centre(droite[0][0], "service")
            self.separateur()


# Quincaillerie, SAQ : codes produit, employe.
class CompositeurDetail(Compositeur):
    pass


# Ligne de pompe avant le carburant.
class CompositeurStationService(CompositeurDetail):

    def avant_article(self, ligne: LigneArticle, indice: int) -> None:
        if ligne.categorie == "carburant" and ligne.unite == "L":
            pompe = self.recu.infos_supplementaires.get("pompe", "1")
            self.gauche([(self._t(self.rng.choice(("Pompe", "Pompe #", "Pompe no"))), "autre", None), (pompe, "autre", None)])


COMPOSITEURS: dict[str, type[Compositeur]] = {
    "epicerie": Compositeur,
    "depanneur": Compositeur,
    "pharmacie": Compositeur,
    "restaurant": CompositeurRestaurant,
    "bar": CompositeurRestaurant,
    "cafe": CompositeurComptoir,
    "restauration_rapide": CompositeurComptoir,
    "quincaillerie": CompositeurDetail,
    "detail": CompositeurDetail,
    "saq": CompositeurDetail,
    "station_service": CompositeurStationService,
}


def creer_compositeur(recu: Recu, style: StyleImpression, rng: random.Random) -> Compositeur:
    return COMPOSITEURS.get(recu.type_commerce, Compositeur)(recu, style, rng)


# ---------------------------------------------------------------------------
# Dessin
# ---------------------------------------------------------------------------


def _mesurer_largeur(police: TypePolice, texte: str) -> float:
    return float(police.getlength(texte))


# Boite serree d'un mot dessine a partir de x_debut.
def _boite_mot(
    police: TypePolice, texte_ligne: str, x_debut: float, y: float, col: int, mot: str
) -> tuple[float, float, float, float]:
    x0 = x_debut + _mesurer_largeur(police, texte_ligne[:col])
    x1 = x_debut + _mesurer_largeur(police, texte_ligne[: col + len(mot)])
    b = police.getbbox(mot)
    return x0, y + b[1], x1, y + b[3]


# Rend la boite du QR, bordure exclue.
def _dessiner_qr(
    dessin: ImageDraw.ImageDraw, url: str, style: StyleImpression, largeur: int, y: float
) -> tuple[float, float, float, float]:
    matrice = matrice_qr(url)
    modules = len(matrice)
    echelle = echelle_qr(style)
    cote = modules * echelle
    x0 = (largeur - cote) / 2
    y0 = y + BORDURE_QR * echelle
    for r, ligne in enumerate(matrice):
        for c, sombre in enumerate(ligne):
            if sombre:
                x = x0 + c * echelle
                yy = y0 + r * echelle
                dessin.rectangle([x, yy, x + echelle - 1, yy + echelle - 1], fill=255)
    return x0, y0, x0 + cote, y0 + cote


# Image RGB du seul recu, sans fond ni deformation.
def rendre(
    recu: Recu,
    style: StyleImpression,
    rng: random.Random,
    rangees: list[Rangee] | None = None,
) -> ResultatRendu:
    if rangees is None:
        rangees = creer_compositeur(recu, style, rng).composer()

    police_base = charger_police(style.police, style.taille_police)
    largeur_caractere = _mesurer_largeur(police_base, "M")
    hauteur_ligne_base = int(round(style.taille_police * style.interligne))
    largeur = int(math.ceil(largeur_caractere * style.largeur_colonnes)) + 2 * style.marge

    # Pre-calcul des hauteurs pour connaitre la taille de l'image.
    hauteurs = [hauteur_rangee(rangee, style, hauteur_ligne_base) for rangee in rangees]
    hauteur_code_barres = int(style.taille_police * 2.2) if rng.random() < 0.6 else 0
    hauteur = sum(hauteurs) + 2 * style.marge + hauteur_code_barres + style.taille_police

    masque = Image.new("L", (largeur, hauteur), 0)
    dessin = ImageDraw.Draw(masque)
    boites: list[BoiteMot] = []

    y = style.marge
    for rangee, h in zip(rangees, hauteurs):
        if rangee.qr is not None:
            x0, y0, x1, y1 = _dessiner_qr(dessin, rangee.qr, style, largeur, y)
            boites.append(BoiteMot(rangee.qr, "qr", None, x0, y0, x1, y1))
            y += h
            continue
        if rangee.vide or not rangee.segments:
            y += h
            continue
        taille = max(6, int(round(style.taille_police * rangee.facteur_taille)))
        police = police_base if rangee.facteur_taille == 1.0 else charger_police(style.police, taille)
        # Texte complet de la rangee sur la grille des colonnes.
        fin = max(s.col + len(s.texte) for s in rangee.segments)
        tampon = [" "] * fin
        for s in rangee.segments:
            for k, ch in enumerate(s.texte):
                tampon[s.col + k] = ch
        texte_ligne = "".join(tampon)
        if rangee.centrer:
            x_debut = max(0.0, (largeur - _mesurer_largeur(police, texte_ligne)) / 2)
        else:
            x_debut = float(style.marge)
        dessin.text((x_debut, y), texte_ligne, font=police, fill=255)
        for s in rangee.segments:
            if s.etiquette == "autre" and not s.texte.strip():
                continue
            # Decoupage en mots avec suivi de la colonne de depart.
            col = s.col
            for mot in s.texte.split(" "):
                if mot:
                    x0, y0, x1, y1 = _boite_mot(police, texte_ligne, x_debut, y, col, mot)
                    boites.append(BoiteMot(mot, s.etiquette, s.indice_ligne, x0, y0, x1, y1))
                col += len(mot) + 1
        y += h

    # Code-barres decoratif en bas (boite « code_barres », texte = numero de facture).
    if hauteur_code_barres:
        y_cb = y + style.taille_police // 2
        x_cb = style.marge + int(largeur * 0.12)
        x_fin = largeur - style.marge - int(largeur * 0.12)
        x_debut_cb = x_cb
        while x_cb < x_fin:
            epaisseur = rng.choice((1, 1, 2, 2, 3))
            if rng.random() < 0.55:
                dessin.rectangle([x_cb, y_cb, x_cb + epaisseur - 1, y_cb + hauteur_code_barres - 8], fill=255)
            x_cb += epaisseur + rng.choice((1, 2))
        boites.append(BoiteMot(recu.numero_transaction, "code_barres", None,
                               float(x_debut_cb), float(y_cb), float(x_fin), float(y_cb + hauteur_code_barres - 8)))

    image = _composer_encre(masque, style, rng)
    return ResultatRendu(image=image, boites=boites, recu=recu, style=style)


# Densite d'encre et bandes thermiques : c'est ici que le papier devient une image.
def _composer_encre(masque: Image.Image, style: StyleImpression, rng: random.Random) -> Image.Image:
    graine = rng.getrandbits(32)
    gen = np.random.default_rng(graine)
    m = np.asarray(masque, dtype=np.float32) / 255.0
    h, w = m.shape

    # Densite globale + variation lente ligne par ligne (tete thermique fatiguee).
    profil_lignes = 1.0 - gen.uniform(0.0, 0.25, size=(h // 6 + 1,)).repeat(6)[:h]
    profil_colonnes = 1.0 - gen.uniform(0.0, 0.12, size=(w // 24 + 1,)).repeat(24)[:w]
    densite = style.densite_encre * profil_lignes[:, None] * profil_colonnes[None, :]
    bruit_encre = gen.uniform(0.85, 1.0, size=(h, w)).astype(np.float32)
    alpha = np.clip(m * densite * bruit_encre, 0.0, 1.0)

    papier = np.empty((h, w, 3), dtype=np.float32)
    grain = gen.normal(0.0, 2.5, size=(h, w)).astype(np.float32)
    for c in range(3):
        papier[:, :, c] = np.clip(style.teinte_papier[c] + grain, 0, 255)
    encre = np.array([rng.randint(8, 40)] * 3, dtype=np.float32)
    rgb = papier * (1.0 - alpha[:, :, None]) + encre[None, None, :] * alpha[:, :, None]
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), mode="RGB")


COULEURS_ETIQUETTES: dict[str, tuple[int, int, int]] = {
    "nm": (220, 30, 30),
    "price": (30, 150, 30),
    "cnt": (200, 120, 0),
    "unitprice": (0, 150, 150),
    "unit": (120, 120, 0),
    "tax": (150, 0, 150),
    "sku": (90, 90, 90),
    "discountprice": (200, 0, 100),
    "discount_label": (255, 120, 180),
    "total_price": (0, 0, 220),
    "subtotal_price": (0, 100, 200),
    "tps": (120, 0, 200),
    "tvq": (160, 0, 160),
    "frais_service": (0, 140, 90),
    "frais_livraison": (0, 140, 90),
    "pourboire": (230, 90, 0),
    "total_final": (230, 0, 0),
    "arrondi": (100, 100, 200),
    "date": (0, 120, 0),
    "heure": (0, 160, 60),
    "marchand": (200, 0, 0),
    "adresse": (200, 100, 0),
    "telephone": (100, 100, 0),
    "paiement": (0, 120, 120),
    "menutype_cnt": (80, 80, 200),
    "numero_facture": (0, 80, 160),
    "type_document": (160, 0, 80),
    "tps_no": (120, 60, 0),
    "tvq_no": (120, 60, 0),
    "neq": (120, 60, 0),
    "nom_legal": (160, 80, 0),
    "courriel": (0, 100, 100),
    "site_web": (0, 100, 100),
    "permis_alcool": (140, 0, 140),
    "petit_fournisseur": (255, 0, 0),
    "numero_sev": (0, 60, 200),
    "mev": (0, 60, 200),
    "code_autorisation": (0, 60, 200),
    "table": (0, 150, 100),
    "serveur": (0, 150, 100),
    "couverts": (0, 150, 100),
    "commande": (0, 150, 100),
    "service": (0, 150, 100),
    "onglet": (0, 150, 100),
    "employe": (100, 100, 0),
    "client_nom": (200, 50, 50),
    "client_adresse": (200, 100, 50),
    "client_tps_no": (120, 60, 0),
    "client_tvq_no": (120, 60, 0),
    "qr": (0, 0, 0),
    "code_barres": (60, 60, 60),
    "autre": (170, 170, 170),
}
