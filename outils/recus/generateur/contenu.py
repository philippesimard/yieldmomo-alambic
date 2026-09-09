# Generation de la verite terrain : commerce, panier, totaux, paiement, style.
#
# Tout le hasard passe par le random.Random fourni par l'appelant : c'est ce qui rend une
# graine reproductible.
#
# Le tirage se fait a deux niveaux, d'abord le type de commerce (catalogue.POIDS_TYPES) puis
# l'enseigne au sein de ce type. Le type gouverne ensuite le panier, le contexte de service,
# le bloc SEV, les frais, le pourboire, les horaires et le style d'impression.
#
# Toute decision « ce champ est-il present sur le recu ? » se prend ici ; le rendu n'en fait
# que la typographie.

from __future__ import annotations

import datetime as dt
import random
import unicodedata
from decimal import Decimal
from typing import Sequence

from . import catalogue
from .fiscalite import (
    ZERO,
    arrondir_5_cents,
    arrondir_cent,
    calculer_frais_service,
    calculer_monnaie,
    calculer_pourboire,
    calculer_totaux,
    choisir_montant_remis,
    suggestions_pourboire,
)
from .modeles import (
    Adresse,
    Client,
    Commerce,
    ContexteService,
    InfosSev,
    LigneArticle,
    Paiement,
    Recu,
    StyleImpression,
)

DATE_MIN: dt.date = dt.date(2019, 1, 1)
DATE_MAX: dt.date = dt.date(2026, 9, 1)
#: Generalisation des codes QR sur les factures SEV (MEV-WEB).
DATE_QR: dt.date = dt.date(2023, 1, 1)


# ---------------------------------------------------------------------------
# Utilitaires de tirage
# ---------------------------------------------------------------------------


# Biaise vers les terminaisons commerciales (.99, .49, .95) : un prix tire uniformement
# se reconnait au premier coup d'oeil.
def tirer_prix(rng: random.Random, prix_min: Decimal, prix_max: Decimal, decimales: int = 2) -> Decimal:
    facteur = 10**decimales
    u_min = int(prix_min * facteur)
    u_max = int(prix_max * facteur)
    unites = rng.randint(u_min, u_max)
    if decimales == 3:
        if rng.random() < 0.9:
            candidat = (unites // 10) * 10 + 9
            if u_min <= candidat <= u_max:
                unites = candidat
    elif rng.random() < 0.6:
        terminaison = rng.choice((99, 99, 49, 29, 79, 89, 69, 19, 39, 59))
        candidat = (unites // 100) * 100 + terminaison
        if u_min <= candidat <= u_max:
            unites = candidat
    return Decimal(unites) / Decimal(facteur)


def tirer_pondere(rng: random.Random, elements: Sequence[tuple[str, int]]) -> str:
    valeurs = [v for v, _ in elements]
    poids = [p for _, p in elements]
    return rng.choices(valeurs, weights=poids, k=1)[0]


# Minuscules sans accents, pour comparer des mots-cles.
def _simplifier(texte: str) -> str:
    decompose = unicodedata.normalize("NFKD", texte)
    return "".join(c for c in decompose if not unicodedata.combining(c)).lower()


# ---------------------------------------------------------------------------
# Type et enseigne
# ---------------------------------------------------------------------------


def choisir_type(rng: random.Random, types: Sequence[str] | None = None) -> str:
    candidats = list(types) if types else list(catalogue.TYPES_COMMERCE)
    inconnus = [t for t in candidats if t not in catalogue.TYPES_COMMERCE]
    if inconnus:
        raise ValueError(f"Types de commerce inconnus : {inconnus} (attendus : {catalogue.TYPES_COMMERCE})")
    return rng.choices(candidats, weights=[catalogue.POIDS_TYPES[t] for t in candidats], k=1)[0]


def choisir_enseigne(rng: random.Random, type_commerce: str) -> catalogue.Enseigne:
    enseignes = catalogue.ENSEIGNES_PAR_TYPE[type_commerce]
    return rng.choices(enseignes, weights=[e.poids for e in enseignes], k=1)[0]


# ---------------------------------------------------------------------------
# Commerce
# ---------------------------------------------------------------------------


# Format A1A 1A1, coherent avec la ville.
def generer_code_postal(rng: random.Random, ville: catalogue.Ville) -> str:
    prefixe = rng.choice(ville.prefixes_postaux)
    suffixe = (
        str(rng.randint(0, 9))
        + rng.choice(catalogue.LETTRES_CODE_POSTAL)
        + str(rng.randint(0, 9))
    )
    return f"{prefixe} {suffixe}"


def generer_telephone(rng: random.Random, ville: catalogue.Ville) -> str:
    indicatif = rng.choice(ville.indicatifs)
    central = rng.randint(200, 999)
    ligne = rng.randint(0, 9999)
    format_tel = rng.choice(("({i}) {c}-{l:04d}", "{i}-{c}-{l:04d}", "{i} {c}-{l:04d}"))
    return format_tel.format(i=indicatif, c=central, l=ligne)


def generer_adresse(rng: random.Random) -> Adresse:
    ville = rng.choice(catalogue.VILLES)
    return Adresse(
        numero=rng.randint(100, 9999),
        rue=rng.choice(catalogue.RUES),
        ville=ville.nom,
        code_postal=generer_code_postal(rng, ville),
    )


# Neuf chiffres suivis de RT0001.
def generer_numero_tps(rng: random.Random) -> str:
    return f"{rng.randint(100_000_000, 999_999_999)} RT0001"


# Dix chiffres suivis de TQ0001.
def generer_numero_tvq(rng: random.Random) -> str:
    return f"{rng.randint(1_000_000_000, 9_999_999_999)} TQ0001"


# Dix chiffres commencant par 11, 22 ou 33.
def generer_neq(rng: random.Random) -> str:
    return rng.choice(("11", "11", "11", "22", "33")) + f"{rng.randint(0, 99_999_999):08d}"


# Numero de permis RACJ, sept chiffres.
def generer_permis_alcool(rng: random.Random) -> str:
    return f"{rng.randint(1_000_000, 9_999_999)}"


def _slug(texte: str) -> str:
    simple = _simplifier(texte)
    return "".join(c if c.isalnum() else "" for c in simple.replace(" ", "").replace("-", ""))


def generer_courriel(rng: random.Random, enseigne: catalogue.Enseigne, nom_affiche: str) -> str:
    if enseigne.site_web:
        prefixe = rng.choice(("info", "succursale", "service", "commandes", "clientele"))
        return f"{prefixe}@{enseigne.site_web}"
    return f"{_slug(nom_affiche)[:24]}@{rng.choice(catalogue.DOMAINES_COURRIEL)}"


def generer_nom_entreprise(rng: random.Random) -> str:
    patron = rng.choice(catalogue.PATRONS_NOM_ENTREPRISE)
    nom = patron.format(
        secteur=rng.choice(catalogue.SECTEURS_ENTREPRISE),
        nom=rng.choice(catalogue.NOMS_FAMILLE_QUEBEC),
        forme=rng.choice(catalogue.FORMES_JURIDIQUES),
        numero=f"{rng.randint(9000, 9999)}-{rng.randint(1000, 9999)}",
    )
    return " ".join(nom.split())


def generer_client(rng: random.Random) -> Client:
    adresse = generer_adresse(rng) if rng.random() < 0.6 else None
    inscrit = rng.random() < 0.4
    return Client(
        nom=generer_nom_entreprise(rng),
        adresse=adresse,
        numero_tps=generer_numero_tps(rng) if inscrit else None,
        numero_tvq=generer_numero_tvq(rng) if inscrit else None,
    )


def generer_commerce(rng: random.Random, enseigne: catalogue.Enseigne) -> Commerce:
    type_commerce = enseigne.type_commerce
    ville = rng.choice(catalogue.VILLES)
    adresse = Adresse(
        numero=rng.randint(100, 9999),
        rue=rng.choice(catalogue.RUES),
        ville=ville.nom,
        code_postal=generer_code_postal(rng, ville),
    )
    nom_affiche = rng.choice(enseigne.variantes_nom) if enseigne.variantes_nom else enseigne.nom.upper()
    numero_succursale = f"{rng.randint(1, 999):03d}" if (not enseigne.independant and rng.random() < 0.6) else None
    numero_magasin = str(rng.randint(100, 9999)) if (not enseigne.independant and rng.random() < 0.5) else None
    petit_fournisseur = (
        enseigne.independant
        and type_commerce in ("restaurant", "cafe", "depanneur", "detail", "bar")
        and rng.random() < 0.03
    )
    nom_legal = None
    if enseigne.independant and rng.random() < 0.10:
        nom_legal = (
            f"{rng.randint(9000, 9999)}-{rng.randint(1000, 9999)} Québec inc."
            if rng.random() < 0.7
            else f"Gestion {rng.choice(catalogue.NOMS_FAMILLE_QUEBEC)} inc."
        )
    permis_alcool = None
    if type_commerce == "bar" and rng.random() < 0.9:
        permis_alcool = generer_permis_alcool(rng)
    elif "alcool_service" in enseigne.categories and rng.random() < 0.25:
        permis_alcool = generer_permis_alcool(rng)
    return Commerce(
        enseigne=enseigne.nom,
        nom_affiche=nom_affiche,
        adresse=adresse,
        telephone=generer_telephone(rng, ville),
        numero_tps=None if petit_fournisseur else generer_numero_tps(rng),
        numero_tvq=None if petit_fournisseur else generer_numero_tvq(rng),
        slogan=rng.choice(enseigne.slogans) if rng.random() < 0.75 else None,
        numero_succursale=numero_succursale,
        numero_magasin=numero_magasin,
        type_commerce=type_commerce,
        nom_legal=nom_legal,
        neq=generer_neq(rng) if rng.random() < 0.45 else None,
        courriel=generer_courriel(rng, enseigne, nom_affiche) if rng.random() < 0.15 else None,
        site_web=enseigne.site_web if (enseigne.site_web and rng.random() < 0.30) else None,
        permis_alcool=permis_alcool,
        petit_fournisseur=petit_fournisseur,
    )


# ---------------------------------------------------------------------------
# Panier
# ---------------------------------------------------------------------------


# Entier le plus souvent, sinon kg ou litres.
def tirer_quantite(rng: random.Random, produit: catalogue.Produit, type_commerce: str) -> Decimal:
    if produit.unite == "L":
        return Decimal(rng.randint(8_000, 75_000)) / Decimal(1000)
    if produit.unite == "kg" and produit.categorie == "carburant":
        return Decimal(rng.randint(5_000, 20_000)) / Decimal(1000)
    if produit.au_poids:
        grammes = rng.randint(180, 3200)
        return Decimal(grammes) / Decimal(1000)
    tirage = rng.random()
    if type_commerce in catalogue.TYPES_SERVICE or type_commerce in catalogue.TYPES_COMPTOIR:
        if tirage < 0.72:
            return Decimal(1)
        if tirage < 0.94:
            return Decimal(2)
        return Decimal(rng.randint(3, 4))
    if tirage < 0.72:
        return Decimal(1)
    if tirage < 0.90:
        return Decimal(2)
    if tirage < 0.97:
        return Decimal(rng.randint(3, 4))
    return Decimal(rng.randint(5, 12))


# Strictement inferieur au prix brut.
def tirer_rabais(rng: random.Random, prix_brut: Decimal) -> tuple[Decimal, str] | None:
    if rng.random() >= 0.13 or prix_brut < Decimal("1.00"):
        return None
    proportion = Decimal(rng.randint(5, 40)) / Decimal(100)
    rabais = arrondir_cent(prix_brut * proportion)
    if rng.random() < 0.5:
        # Rabais « rond » typique : 0,50 / 1,00 / 2,00...
        rabais = arrondir_cent(Decimal(rng.choice((25, 50, 75, 100, 150, 200, 300))) / Decimal(100))
    if rabais <= Decimal("0.00") or rabais >= prix_brut:
        return None
    return rabais, rng.choice(catalogue.LIBELLES_RABAIS)


#: Probabilite qu'une ligne porte un code produit (SKU / CUP), par type.
_PROBABILITE_CODE_PRODUIT: dict[str, float] = {
    "quincaillerie": 0.7,
    "detail": 0.7,
    "saq": 0.6,
    "pharmacie": 0.4,
    "epicerie": 0.3,
    "depanneur": 0.15,
    "station_service": 0.2,
}


# CUP a 12 chiffres, ou code SAQ a 8.
def generer_code_produit(rng: random.Random, type_commerce: str) -> str:
    if type_commerce == "saq":
        return f"{rng.randint(10_000_000, 99_999_999)}"
    if rng.random() < 0.8:
        return f"{rng.randint(10_000_000_000, 999_999_999_999)}"
    return f"{rng.randint(100_000, 9_999_999)}"


def produits_admissibles(enseigne: catalogue.Enseigne) -> list[catalogue.Produit]:
    return [p for c in enseigne.categories for p in catalogue.PRODUITS_PAR_CATEGORIE[c]]


# Produits distincts, en privilegiant les mots-cles de l'enseigne.
def _choisir_produits(
    rng: random.Random, enseigne: catalogue.Enseigne, nombre: int
) -> list[catalogue.Produit]:
    type_commerce = enseigne.type_commerce
    pool = produits_admissibles(enseigne)
    choisis: list[catalogue.Produit] = []
    if type_commerce == "station_service":
        carburants = [p for p in pool if p.categorie == "carburant" and p.unite == "L"]
        pool = [p for p in pool if p.categorie != "carburant"]
        choisis.append(rng.choice(carburants))
        nombre = rng.choice((0, 0, 0, 1, 1, 2, 3))
    elif type_commerce == "pharmacie":
        ordonnances = [p for p in pool if p.categorie == "ordonnance"]
        pool = [p for p in pool if p.categorie != "ordonnance"]
        if rng.random() < 0.30:
            choisis.extend(rng.sample(ordonnances, k=min(rng.randint(1, 2), len(ordonnances))))
            nombre = max(0, nombre - len(choisis) + rng.choice((0, 1)))
    if enseigne.mots_cles_produits:
        mots = [_simplifier(m) for m in enseigne.mots_cles_produits]
        favoris = [p for p in pool if any(m in _simplifier(p.nom) for m in mots)]
        if len(favoris) >= 5:
            n_favoris = min(len(favoris), max(1, round(nombre * 0.8)) if nombre else 0)
            choisis_favoris = rng.sample(favoris, k=n_favoris)
            reste = [p for p in pool if p not in choisis_favoris]
            choisis_reste = rng.sample(reste, k=min(nombre - n_favoris, len(reste)))
            melange = choisis_favoris + choisis_reste
            rng.shuffle(melange)
            return choisis + melange
    choisis.extend(rng.sample(pool, k=min(nombre, len(pool))))
    return choisis


def generer_lignes(rng: random.Random, enseigne: catalogue.Enseigne) -> list[LigneArticle]:
    type_commerce = enseigne.type_commerce
    nombre = rng.randint(enseigne.articles_min, enseigne.articles_max)
    produits = _choisir_produits(rng, enseigne, nombre)
    p_code = _PROBABILITE_CODE_PRODUIT.get(type_commerce, 0.0)
    avec_codes = rng.random() < 0.85  # les codes sont presents sur toutes les lignes, ou aucune
    rabais_possibles = type_commerce not in catalogue.TYPES_SERVICE and type_commerce not in catalogue.TYPES_COMPTOIR
    lignes: list[LigneArticle] = []
    for produit in produits:
        prix_unitaire = tirer_prix(rng, produit.prix_min, produit.prix_max, produit.decimales_prix)
        quantite = tirer_quantite(rng, produit, type_commerce)
        ligne = LigneArticle(
            nom=produit.nom,
            categorie=produit.categorie,
            taxable=produit.taxable,
            quantite=quantite,
            au_poids=produit.au_poids,
            prix_unitaire=prix_unitaire,
            unite=produit.unite,
            decimales_prix=produit.decimales_prix,
        )
        if rabais_possibles and produit.categorie != "carburant":
            rabais = tirer_rabais(rng, ligne.prix_brut)
            if rabais is not None:
                ligne.rabais, ligne.libelle_rabais = rabais
        if avec_codes and p_code and rng.random() < p_code and produit.categorie not in ("carburant", "ordonnance"):
            ligne.code_produit = generer_code_produit(rng, type_commerce)
        lignes.append(ligne)
    return lignes


# ---------------------------------------------------------------------------
# Service, frais, pourboire, paiement
# ---------------------------------------------------------------------------


def generer_contexte_service(rng: random.Random, type_commerce: str) -> ContexteService | None:
    if type_commerce == "restaurant":
        ctx = ContexteService()
        if rng.random() < 0.85:
            ctx.table = str(rng.randint(1, 40))
        if rng.random() < 0.80:
            ctx.serveur = rng.choice(catalogue.PRENOMS_SERVEURS)
        if rng.random() < 0.60:
            ctx.couverts = rng.choices((1, 2, 3, 4, 5, 6, 7, 8, 10, 12), weights=(10, 30, 12, 20, 5, 8, 4, 6, 3, 2), k=1)[0]
        if rng.random() < 0.15:
            ctx.mode_service = rng.choice(("POUR EMPORTER", "LIVRAISON"))
        return ctx
    if type_commerce == "bar":
        ctx = ContexteService()
        if rng.random() < 0.60:
            ctx.onglet = str(rng.randint(1, 99))
        if rng.random() < 0.70:
            ctx.serveur = rng.choice(catalogue.PRENOMS_SERVEURS)
        if rng.random() < 0.30:
            ctx.table = str(rng.randint(1, 30))
        return ctx
    if type_commerce in catalogue.TYPES_COMPTOIR:
        ctx = ContexteService()
        if rng.random() < 0.85:
            ctx.numero_commande = str(rng.randint(1, 999)) if rng.random() < 0.6 else f"{rng.randint(1000, 9999)}"
        if rng.random() < 0.70:
            ctx.mode_service = rng.choice(catalogue.MODES_SERVICE)
        return ctx
    return None


def generer_frais(
    rng: random.Random,
    type_commerce: str,
    service: ContexteService | None,
    sous_total: Decimal,
) -> tuple[Decimal | None, int | None, Decimal | None]:
    frais_service: Decimal | None = None
    taux: int | None = None
    frais_livraison: Decimal | None = None
    if service is not None and service.couverts is not None and service.couverts >= 6 and rng.random() < 0.8:
        taux = rng.choice((15, 18, 18, 20))
        frais_service = calculer_frais_service(sous_total, taux)
    if service is not None and service.mode_service == "LIVRAISON" and rng.random() < 0.7:
        frais_livraison = Decimal(rng.choice((299, 399, 499, 500, 599, 699, 799))) / Decimal(100)
    elif type_commerce in ("restaurant", "restauration_rapide") and rng.random() < 0.02:
        frais_livraison = Decimal(rng.choice((399, 499, 599))) / Decimal(100)
    return frais_service, taux, frais_livraison


def generer_pourboire(
    rng: random.Random,
    type_commerce: str,
    mode_paiement: str,
    sous_total: Decimal,
    total: Decimal,
) -> tuple[Decimal | None, tuple[tuple[int, Decimal], ...]]:
    if type_commerce in catalogue.TYPES_SERVICE:
        carte = mode_paiement != "COMPTANT"
        if rng.random() < (0.55 if carte else 0.15):
            taux = rng.randint(10, 25)
            base = sous_total if rng.random() < 0.5 else total
            pourboire = calculer_pourboire(base, taux, arrondi_dollar=rng.random() < 0.3)
            if pourboire > ZERO:
                return pourboire, ()
        if rng.random() < (0.6 if carte else 0.4):
            base = sous_total if rng.random() < 0.7 else total
            return None, suggestions_pourboire(base)
        return None, ()
    if type_commerce in catalogue.TYPES_COMPTOIR and rng.random() < 0.08:
        return None, suggestions_pourboire(sous_total)
    return None, ()


def generer_paiement(rng: random.Random, total: Decimal, type_commerce: str = "epicerie") -> Paiement:
    modes = list(catalogue.MODES_PAIEMENT)
    if type_commerce == "bar":
        modes = [(m, p * 2 if m == "COMPTANT" else p) for m, p in modes]
    elif type_commerce in ("restaurant", "quincaillerie"):
        modes = [(m, p // 2 if m == "COMPTANT" else p) for m, p in modes]
    mode = tirer_pondere(rng, modes)
    if mode == "COMPTANT":
        total_arrondi = arrondir_5_cents(total)
        remis = choisir_montant_remis(total_arrondi)
        if rng.random() < 0.25:
            remis = total_arrondi  # montant exact
        return Paiement(
            mode=mode,
            montant_paye=total_arrondi,
            arrondi_comptant=arrondir_cent(total_arrondi - total),
            montant_remis=remis,
            monnaie=calculer_monnaie(total, remis),
        )
    statut = rng.choice(("APPROUVEE", "APPROUVE - MERCI", "00 APPROUVEE", "APPROUVEE 001")) if rng.random() < 0.6 else None
    return Paiement(
        mode=mode,
        montant_paye=total,
        derniers_chiffres=f"{rng.randint(0, 9999):04d}",
        numero_autorisation=f"{rng.randint(0, 999999):06d}",
        statut=statut,
    )


_HEURES_PAR_TYPE: dict[str, tuple[range, tuple[int, ...]]] = {
    "cafe": (range(6, 20), (8, 12, 14, 12, 9, 7, 8, 9, 7, 5, 4, 3, 2, 1)),
    "restauration_rapide": (range(7, 24), (2, 3, 3, 4, 8, 10, 8, 5, 4, 5, 8, 10, 9, 6, 4, 3, 2)),
    "restaurant": (range(8, 24), (1, 2, 3, 5, 9, 9, 5, 2, 2, 4, 8, 12, 12, 9, 5, 2)),
    "bar": (range(0, 24), (6, 4, 2, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 3, 5, 7, 8, 9, 10, 10, 10, 8)),
}


def generer_date_heure(rng: random.Random, type_commerce: str = "epicerie") -> tuple[dt.date, dt.time]:
    jours = (DATE_MAX - DATE_MIN).days
    date = DATE_MIN + dt.timedelta(days=rng.randint(0, jours))
    if type_commerce in _HEURES_PAR_TYPE:
        plage, poids = _HEURES_PAR_TYPE[type_commerce]
        heure = rng.choices(list(plage), weights=poids, k=1)[0]
    else:
        heure = rng.choices(range(6, 24), weights=[1, 3, 4, 5, 6, 8, 9, 8, 7, 7, 8, 10, 10, 9, 7, 5, 3, 2], k=1)[0]
    minute = rng.randint(0, 59)
    return date, dt.time(hour=heure, minute=minute, second=rng.randint(0, 59))


# ---------------------------------------------------------------------------
# SEV (systeme d'enregistrement des ventes)
# ---------------------------------------------------------------------------


# URL MEV-WEB : au plus 100 octets, pour borner la version du QR et donc sa taille.
def generer_url_qr(rng: random.Random, numero_sev: str, total: Decimal) -> str:
    code = "".join(rng.choice("0123456789ABCDEF") for _ in range(6))
    return f"https://mev-web.revenuquebec.ca/verif?no={numero_sev}&m={total:.2f}&c={code}"


def generer_sev(
    rng: random.Random, type_commerce: str, date: dt.date, heure: dt.time, total: Decimal
) -> InfosSev:
    numero = date.strftime("%Y%m%d") + heure.strftime("%H%M%S") + f"{rng.randint(0, 99):02d}"
    p_qr = 0.85 if date >= DATE_QR else 0.15
    qr_url = generer_url_qr(rng, numero, total) if rng.random() < p_qr else None
    p_mev = 0.6 if type_commerce == "bar" else 0.25
    module_mev = f"{rng.randint(10, 99)}-{rng.randint(10_000_000, 99_999_999)}" if rng.random() < p_mev else None
    code_autorisation = (
        "".join(rng.choice("0123456789ABCDEF") for _ in range(8)) if rng.random() < 0.30 else None
    )
    return InfosSev(numero_transaction=numero, qr_url=qr_url, module_mev=module_mev, code_autorisation=code_autorisation)


# ---------------------------------------------------------------------------
# Style d'impression
# ---------------------------------------------------------------------------

FORMATS_POIDS: tuple[str, ...] = (
    "{poids} {u} x {prix}/{u}",
    "{poids} {u} @ {prix}/{u}",
    "{poids}{u} @ ${prix}/{u}",
    "{poids} {u} @ ${prix} /{u}",
    "{poids} {U} X {prix}/{U}",
)

FORMATS_MULTIPLE: tuple[str, ...] = (
    "{n} @ {prix}",
    "{n} x {prix}",
    "{n} @ ${prix}",
    "{n} X {prix}",
    "{n} @ {prix} ch.",
)


def generer_style(
    rng: random.Random, polices: Sequence[str], enseigne: catalogue.Enseigne | None = None
) -> StyleImpression:
    type_commerce = enseigne.type_commerce if enseigne is not None else "epicerie"
    service = type_commerce in catalogue.TYPES_SERVICE
    comptoir = type_commerce in catalogue.TYPES_COMPTOIR
    detail = type_commerce in catalogue.TYPES_DETAIL
    if service:
        abreviations = rng.random() < 0.12
    elif comptoir:
        abreviations = rng.random() < 0.25
    else:
        abreviations = rng.random() < 0.35
    majuscules = True if abreviations else rng.random() < (0.5 if service else 0.7)
    if abreviations:
        sans_accents = True
    elif majuscules:
        sans_accents = rng.random() < 0.7
    else:
        sans_accents = rng.random() < 0.35
    police = rng.choice(list(polices)) if polices else ""
    taille = rng.randint(17, 28)
    teinte_base = rng.randint(228, 252)
    teinte = (
        teinte_base,
        max(0, teinte_base - rng.randint(0, 6)),
        max(0, teinte_base - rng.randint(4, 22)),
    )
    remerciements = ("Merci", "Conservez votre recu", "Bonne journee", "Au revoir")
    if service or comptoir:
        remerciements = ("Merci", "Bonne journee", "Au plaisir", "Merci de votre visite", "A bientot")
    lignes_pied = tuple(rng.sample(remerciements, k=rng.randint(0, 2)))
    lignes_entete: tuple[str, ...] = ()
    if service:
        afficher_codes_taxe = rng.random() < 0.10
        quantite_en_prefixe = rng.random() < 0.70
        afficher_categorie_entete = rng.random() < 0.15
        sku_sous_nom = False
    elif comptoir:
        afficher_codes_taxe = rng.random() < 0.20
        quantite_en_prefixe = rng.random() < 0.50
        afficher_categorie_entete = False
        sku_sous_nom = False
    elif detail:
        afficher_codes_taxe = rng.random() < 0.80
        quantite_en_prefixe = False
        afficher_categorie_entete = rng.random() < 0.10
        sku_sous_nom = rng.random() < 0.60
    else:
        afficher_codes_taxe = rng.random() < 0.75
        quantite_en_prefixe = False
        afficher_categorie_entete = rng.random() < 0.25
        sku_sous_nom = rng.random() < 0.30
    bilingue = bool(enseigne is not None and enseigne.bilingue_possible and rng.random() < 0.35)
    return StyleImpression(
        police=police,
        taille_police=taille,
        largeur_colonnes=rng.randint(32, 46) if service else rng.randint(30, 46),
        marge=rng.randint(10, 40),
        interligne=rng.choice((1.15, 1.2, 1.3, 1.4, 1.5)),
        densite_encre=rng.uniform(0.55, 1.0),
        teinte_papier=teinte,
        majuscules=majuscules,
        sans_accents=sans_accents,
        abreviations=abreviations,
        format_poids=rng.choice(FORMATS_POIDS),
        format_multiple=rng.choice(FORMATS_MULTIPLE),
        separateur=rng.choice(("-", "=", "*", "_", " ", ".")),
        afficher_codes_taxe=afficher_codes_taxe,
        afficher_categorie_entete=afficher_categorie_entete,
        position_prix=rng.choice(("meme_ligne", "meme_ligne", "ligne_quantite")),
        afficher_code_produit=True,
        lignes_pied=lignes_pied,
        lignes_entete=lignes_entete,
        bilingue=bilingue,
        quantite_en_prefixe=quantite_en_prefixe,
        sku_sous_nom=sku_sous_nom,
    )


# ---------------------------------------------------------------------------
# Point d'entree
# ---------------------------------------------------------------------------


def _generer_type_document(rng: random.Random, type_commerce: str) -> str | None:
    if type_commerce in catalogue.TYPES_SEV:
        if rng.random() >= 0.6:
            return None
        if type_commerce in catalogue.TYPES_SERVICE:
            return rng.choices(("FACTURE", "ADDITION", "RECU"), weights=(60, 30, 10), k=1)[0]
        return rng.choice(("FACTURE", "RECU"))
    if rng.random() >= 0.4:
        return None
    return rng.choices(("FACTURE", "RECU"), weights=(40, 60), k=1)[0]


def _generer_mentions(rng: random.Random, enseigne: catalogue.Enseigne) -> tuple[str, ...]:
    mentions: list[str] = []
    if rng.random() < 0.40:
        mentions.extend(rng.sample(catalogue.MENTIONS_PIED, k=rng.randint(1, 2)))
    vend_alcool = enseigne.type_commerce in ("bar", "saq") or "alcool_service" in enseigne.categories
    if vend_alcool and rng.random() < 0.30:
        mentions.append(rng.choice(catalogue.MENTIONS_ALCOOL))
    return tuple(mentions)


# nom_imprime n'est pas pose ici : c'est le rendu qui connait la typographie.
def generer_recu(
    rng: random.Random, identifiant: int = 0, types: Sequence[str] | None = None
) -> Recu:
    type_commerce = choisir_type(rng, types)
    enseigne = choisir_enseigne(rng, type_commerce)
    commerce = generer_commerce(rng, enseigne)
    date, heure = generer_date_heure(rng, type_commerce)
    service = generer_contexte_service(rng, type_commerce)
    lignes = generer_lignes(rng, enseigne)
    sous_total_lignes = arrondir_cent(sum((ligne.prix_net for ligne in lignes), ZERO))
    frais_service, taux_frais, frais_livraison = generer_frais(rng, type_commerce, service, sous_total_lignes)
    frais = [f for f in (frais_service, frais_livraison) if f is not None]
    totaux = calculer_totaux(
        ((ligne.prix_net, ligne.taxable) for ligne in lignes),
        frais_taxables=frais,
        exonere=commerce.petit_fournisseur,
    )
    mode_provisoire = tirer_pondere(rng, catalogue.MODES_PAIEMENT)
    pourboire, suggestions = generer_pourboire(rng, type_commerce, mode_provisoire, totaux.sous_total, totaux.total)
    total_final = arrondir_cent(totaux.total + (pourboire or ZERO))
    paiement = generer_paiement(rng, total_final, type_commerce)
    if pourboire is not None and paiement.mode != mode_provisoire and paiement.mode == "COMPTANT" and rng.random() < 0.5:
        # Un pourboire tire pour une carte reste plausible en comptant ; sinon on le retire.
        pourboire = None
        paiement = generer_paiement(rng, totaux.total, type_commerce)
    sev = generer_sev(rng, type_commerce, date, heure, total_final) if type_commerce in catalogue.TYPES_SEV else None
    client = None
    if type_commerce in ("restaurant", "quincaillerie", "detail", "bar") and rng.random() < 0.08:
        client = generer_client(rng)
    type_document = _generer_type_document(rng, type_commerce)
    mentions = _generer_mentions(rng, enseigne)
    employe = None
    if (type_commerce in catalogue.TYPES_DETAIL and rng.random() < 0.20) or (type_commerce == "epicerie" and rng.random() < 0.10):
        employe = str(rng.randint(1000, 99999))
    infos: dict[str, str] = {}
    if enseigne.nom == "Costco":
        infos["membre"] = f"{rng.randint(100_000_000_000, 999_999_999_999)}"
    if type_commerce == "restaurant" and paiement.mode != "COMPTANT" and rng.random() < 0.4:
        infos["copie"] = rng.choice(("COPIE CLIENT", "COPIE DU CLIENT", "COPIE MARCHAND"))
    if type_commerce == "station_service":
        infos["pompe"] = str(rng.randint(1, 12))
    if type_commerce in catalogue.TYPES_SEV:
        numero_transaction = str(rng.randint(1000, 999_999))
    else:
        numero_transaction = str(rng.randint(1000, 99_999_999))
    return Recu(
        commerce=commerce,
        date=date,
        heure=heure,
        lignes=lignes,
        sous_total=totaux.sous_total,
        tps=totaux.tps,
        tvq=totaux.tvq,
        total=totaux.total,
        paiement=paiement,
        numero_transaction=numero_transaction,
        numero_caisse=str(rng.randint(1, 24)),
        caissier=rng.choice(catalogue.PRENOMS_CAISSIERS),
        identifiant=identifiant,
        infos_supplementaires=infos,
        type_document=type_document,
        client=client,
        service=service,
        sev=sev,
        frais_service=frais_service,
        taux_frais_service=taux_frais,
        frais_livraison=frais_livraison,
        pourboire=pourboire,
        suggestions_pourboire=suggestions,
        mentions=mentions,
        employe=employe,
    )


# Graine independante et stable pour un index donne.
def graine_pour_index(graine: int, index: int) -> int:
    return (graine * 1_000_003 + index * 7_919 + 12_345) % (2**63)


# Rend aussi le Random : la suite de la chaine doit tirer dans le meme flux.
def generer_recu_et_style(
    graine: int, index: int, polices: Sequence[str], types: Sequence[str] | None = None
) -> tuple[Recu, StyleImpression, random.Random]:
    rng = random.Random(graine_pour_index(graine, index))
    recu = generer_recu(rng, identifiant=index, types=types)
    enseigne = next(e for e in catalogue.ENSEIGNES if e.nom == recu.commerce.enseigne)
    style = generer_style(rng, polices, enseigne)
    if style.afficher_categorie_entete:
        # Les recus a en-tetes de rayon regroupent les articles par categorie.
        recu.lignes.sort(key=lambda ligne: catalogue.CATEGORIES.index(ligne.categorie))
    return recu, style, rng
