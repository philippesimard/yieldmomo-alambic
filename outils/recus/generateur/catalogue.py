# Catalogue statique : produits, commerces, rues, villes, modes de paiement. Rien que des
# constantes ; le tirage aleatoire vit dans contenu.py. Les prix sont en Decimal, jamais en
# float.
#
# Taxation (voir fiscalite.py) : les aliments de base sont detaxes. Sont taxables les boissons
# gazeuses, friandises, grignotines, plats prepares, alcool et produits non alimentaires.
# Chaque produit porte son propre drapeau taxable, pour les exceptions (eau a l'unite,
# patisserie a l'unite, jus pur non taxable).

from __future__ import annotations

from dataclasses import dataclass
from typing import Final


# Le catalogue de produits vit dans ``generateur.produits`` ; il est re-exporte
# ici pour compatibilite (``catalogue.PRODUITS``, ``catalogue.CATEGORIES``...).
from .produits import (  # noqa: E402
    CATEGORIES,
    CATEGORIES_DETAIL,
    CATEGORIES_EPICERIE,
    CATEGORIES_SERVICE,
    PRODUITS,
    PRODUITS_PAR_CATEGORIE,
    Produit,
)



# ---------------------------------------------------------------------------
# Abreviations de caisse
# ---------------------------------------------------------------------------

#: Abreviations typiques des systemes de caisse (appliquees mot par mot,
#: sur le nom mis en majuscules et sans accents).
ABREVIATIONS: Final[dict[str, str]] = {
    "POULET": "PLT",
    "POITRINES": "POIT",
    "POITRINE": "POIT",
    "FROMAGE": "FROM",
    "BISCUITS": "BISC",
    "CHOCOLAT": "CHOC",
    "YOGOURT": "YOG",
    "BOUTEILLE": "BTL",
    "PAQUET": "PQT",
    "SAUCE": "SCE",
    "BOEUF": "BF",
    "TRANCHE": "TR",
    "TRANCHEE": "TR",
    "TRANCHES": "TR",
    "GRANDE": "GDE",
    "GRAND": "GD",
    "PETIT": "PT",
    "PETITS": "PTS",
    "ROUGE": "RGE",
    "ROUGES": "RGES",
    "BLANC": "BLC",
    "BLANCS": "BLCS",
    "NATURE": "NAT",
    "NATUREL": "NAT",
    "BIOLOGIQUE": "BIO",
    "SANS": "SS",
    "LEGUMES": "LEG",
    "SURGELE": "SURG",
    "SURGELEE": "SURG",
    "SURGELES": "SURG",
    "SURGELEES": "SURG",
    "POMMES": "POM",
    "POMME": "POM",
    "TERRE": "TER",
    "CROUSTILLES": "CROUST",
    "BOISSON": "BOIS",
    "GAZEUSE": "GAZ",
    "MELANGES": "MEL",
    "MELANGEES": "MEL",
    "ENTIER": "ENT",
    "ENTIERE": "ENT",
    "DESOSSEES": "DESOS",
    "EXTRA": "X",
    "MAIGRE": "MGR",
    "HACHE": "HACH",
    "CREME": "CRM",
    "GLACEE": "GLC",
    "PAPIER": "PAP",
    "HYGIENIQUE": "HYG",
    "DETERGENT": "DETERG",
    "NETTOYANT": "NETT",
    "USAGE": "USG",
    "SANDWICH": "SANDW",
    "SAUCISSES": "SAUC",
    "ROULEAUX": "RLX",
    "CANNEBERGES": "CANNEB",
    "PREPARATION": "PREP",
    "VANILLE": "VAN",
    "ARACHIDE": "ARACH",
    "ARACHIDES": "ARACH",
    "MOUCHOIRS": "MOUCH",
    "MICRO-ONDES": "M-O",
    "NOURRITURE": "NOURR",
    "REGULIERE": "REG",
    "ASSORTIMENT": "ASST",
    "ITALIENNES": "ITAL",
    "ATLANTIQUE": "ATL",
    "CONSERVE": "CONS",
    "DEJEUNER": "DEJ",
    "HYDRATANTE": "HYDR",
    "DESINFECTANT": "DESINF",
    "REVITALISANT": "REVIT",
    "PELLICULE": "PELL",
    "PLASTIQUE": "PLAST",
    "ALUMINIUM": "ALU",
    "ASSOUPLISSANTES": "ASSOUPL",
    "REUTILISABLE": "REUTIL",
    "MULTIGRAINS": "MULTIGR",
    "CROISSANTS": "CROIS",
    "CHAMPIGNONS": "CHAMP",
    "CONCOMBRE": "CONC",
    "ANGLAIS": "ANGL",
    "CLEMENTINES": "CLEMENT",
    "FRAMBOISES": "FRAMB",
    "BLEUETS": "BLEU",
    "FRAISES": "FRAIS",
    "GRELOT": "GREL",
    "POIVRONS": "POIV",
    "OIGNONS": "OIGN",
    "JAUNES": "JN",
    "CAROTTES": "CAROT",
    "EPINARDS": "EPIN",
    "COTELETTES": "COTEL",
    "SURLONGE": "SURL",
    "CREVETTES": "CREV",
    "CANADIAN": "CAN",
    "ENERGISANTE": "ENERG",
    "CALIBRE": "CAL",
    "MOYEN": "MOY",
    "FILTRE": "FILT",
    "VINAIGRETTE": "VINAIGR",
    "MOUTARDE": "MOUT",
    "CONFITURE": "CONF",
    "CEREALES": "CER",
    "CUISSON": "CUIS",
    "RAPIDE": "RAP",
    "HARICOTS": "HARIC",
    "LENTILLES": "LENT",
    "BOUILLON": "BOUIL",
    "GAZEIFIEE": "GAZ",
    "CANETTE": "CAN",
    "SANDWICH": "SDW",
    "BOUTEILLE": "BOUT",
    "PINTE": "PTE",
    "PICHET": "PICH",
    "BIERE": "BIER",
    "PRESSION": "PRESS",
    "GARNITURE": "GARN",
    "SUPPLEMENT": "SUPP",
    "DEJEUNER": "DEJ",
    "CROUSTILLANT": "CROUST",
    "SPAGHETTI": "SPAG",
    "ORDINAIRE": "ORD",
    "INTERMEDIAIRE": "INTER",
    "PEINTURE": "PEINT",
    "INTERIEURE": "INT",
    "EXTERIEURE": "EXT",
    "ELECTRIQUE": "ELEC",
    "PERCEUSE": "PERC",
    "AMPOULES": "AMP",
    "COMPRIMES": "CO",
    "CAPSULES": "CAPS",
    "VITAMINE": "VIT",
    "EXTRA": "EX",
    "MOUSSEUX": "MOUSS",
    "BLANC": "BL",
    "ROUGE": "RG",
}


# ---------------------------------------------------------------------------
# Types de commerce et enseignes
# ---------------------------------------------------------------------------

#: Types de commerce reconnus ; ``info.type_commerce`` dans la verite terrain.
TYPES_COMMERCE: Final[tuple[str, ...]] = (
    "epicerie",
    "depanneur",
    "pharmacie",
    "restaurant",
    "cafe",
    "restauration_rapide",
    "bar",
    "quincaillerie",
    "detail",
    "saq",
    "station_service",
)

#: Poids relatif de chaque type dans le jeu de donnees (somme 100).
POIDS_TYPES: Final[dict[str, int]] = {
    "epicerie": 27,
    "restaurant": 18,
    "cafe": 8,
    "restauration_rapide": 8,
    "depanneur": 7,
    "pharmacie": 7,
    "bar": 5,
    "quincaillerie": 6,
    "detail": 3,
    "saq": 4,
    "station_service": 7,
}

#: Types dont les ventes passent par un systeme d'enregistrement des ventes
#: (SEV / MEV-WEB) : numero de transaction, code QR de validation.
TYPES_SEV: Final[frozenset[str]] = frozenset({"restaurant", "cafe", "restauration_rapide", "bar"})

#: Types « restauration » (quantite en prefixe, pas de codes de taxe, pourboire).
TYPES_SERVICE: Final[frozenset[str]] = frozenset({"restaurant", "bar"})
TYPES_COMPTOIR: Final[frozenset[str]] = frozenset({"cafe", "restauration_rapide"})
TYPES_DETAIL: Final[frozenset[str]] = frozenset({"quincaillerie", "detail", "saq", "station_service"})


@dataclass(frozen=True)
# Une banniere commerciale et les categories qu'elle vend.
class Enseigne:

    nom: str
    categories: tuple[str, ...]
    slogans: tuple[str, ...]
    lignes_pied: tuple[str, ...]
    #: Nombre minimum et maximum d'articles typique d'un panier.
    articles_min: int
    articles_max: int
    #: Poids relatif de tirage au sein de son type.
    poids: int = 10
    #: Variantes du nom imprime en tete (ex. « METRO PLUS »).
    variantes_nom: tuple[str, ...] = ()
    type_commerce: str = "epicerie"
    #: Commerce independant : raison sociale numerotee, petit fournisseur possible.
    independant: bool = False
    #: Libelles bilingues (FR/EN) possibles.
    bilingue_possible: bool = False
    site_web: str | None = None
    #: Mots-cles privilegies dans le nom des produits (ex. « Sous-marin » chez Subway).
    mots_cles_produits: tuple[str, ...] = ()


_EPICERIE_COMPLETE: Final[tuple[str, ...]] = CATEGORIES_EPICERIE
_GRANDE_SURFACE: Final[tuple[str, ...]] = CATEGORIES_EPICERIE + ("sante",)
_DEPANNEUR: Final[tuple[str, ...]] = (
    "boissons",
    "grignotines",
    "alcool",
    "pret_a_manger",
    "produits_laitiers",
    "boulangerie",
    "hygiene",
    "menager",
)
_PHARMACIE: Final[tuple[str, ...]] = (
    "hygiene",
    "menager",
    "grignotines",
    "boissons",
    "produits_laitiers",
    "epicerie_seche",
    "ordonnance",
    "sante",
)
_RESTAURANT: Final[tuple[str, ...]] = (
    "entrees",
    "plats",
    "desserts",
    "boissons_chaudes",
    "boissons_froides",
    "alcool_service",
)
_RESTAURANT_SANS_ALCOOL: Final[tuple[str, ...]] = tuple(c for c in _RESTAURANT if c != "alcool_service")
_CAFE: Final[tuple[str, ...]] = ("boissons_chaudes", "viennoiseries", "repas_rapide", "boissons_froides")
_RAPIDE: Final[tuple[str, ...]] = ("repas_rapide", "boissons_froides", "desserts")
_BAR: Final[tuple[str, ...]] = ("alcool_service", "entrees", "boissons_froides")
_QUINCAILLERIE: Final[tuple[str, ...]] = ("quincaillerie", "menager")
_DOLLAR: Final[tuple[str, ...]] = ("menager", "hygiene", "grignotines", "boissons", "epicerie_seche")
_SAQ: Final[tuple[str, ...]] = ("vins", "spiritueux")
_STATION: Final[tuple[str, ...]] = ("carburant", "boissons", "grignotines", "pret_a_manger")

_MOTS_ST_HUBERT: Final[tuple[str, ...]] = (
    "poulet", "côtes levées", "brochette", "salade de chou", "poutine", "frites",
    "tarte au sucre", "pouding", "liqueur", "café", "trio",
)
_MOTS_CASSE_CROUTE: Final[tuple[str, ...]] = (
    "hot-dog", "hamburger", "cheeseburger", "poutine", "frites", "pogo", "michigan",
    "liqueur", "sauce", "rondelles", "club", "trio",
)

ENSEIGNES: Final[tuple[Enseigne, ...]] = (
    # --- Epiceries -----------------------------------------------------------
    Enseigne(
        "Metro",
        _EPICERIE_COMPLETE,
        ("Merci de magasiner chez Metro", "metro.ca"),
        ("Conservez votre reçu pour tout échange", "Politique de retour: 30 jours avec reçu"),
        3,
        22,
        poids=14,
        variantes_nom=("METRO", "METRO PLUS"),
        site_web="metro.ca",
    ),
    Enseigne(
        "IGA",
        _EPICERIE_COMPLETE,
        ("Vive la bouffe!", "iga.net", "IGA - Vive la bouffe"),
        ("Merci et a bientot", "Nous vous remercions de votre visite"),
        3,
        22,
        poids=14,
        variantes_nom=("IGA", "IGA EXTRA", "IGA MARCHE"),
        site_web="iga.net",
    ),
    Enseigne(
        "Provigo",
        _EPICERIE_COMPLETE,
        ("Provigo, bien plus qu'un marche", "provigo.ca"),
        ("Merci de votre visite", "Garantie de fraicheur"),
        3,
        20,
        poids=10,
        variantes_nom=("PROVIGO", "PROVIGO LE MARCHE"),
        site_web="provigo.ca",
    ),
    Enseigne(
        "Super C",
        _EPICERIE_COMPLETE,
        ("Super C - Economisez plus", "superc.ca"),
        ("Merci de magasiner chez Super C",),
        4,
        25,
        poids=9,
        variantes_nom=("SUPER C",),
        site_web="superc.ca",
    ),
    Enseigne(
        "Maxi",
        _GRANDE_SURFACE,
        ("Maxi - Les bas prix, c'est notre affaire", "maxi.ca"),
        ("Merci de votre visite chez Maxi", "Garantie des bas prix"),
        4,
        25,
        poids=9,
        variantes_nom=("MAXI", "MAXI & CIE"),
        site_web="maxi.ca",
    ),
    Enseigne(
        "Costco",
        _GRANDE_SURFACE,
        ("Costco Wholesale", "COSTCO WHOLESALE"),
        ("Merci de votre visite", "Membre depuis"),
        4,
        18,
        poids=7,
        variantes_nom=("COSTCO WHOLESALE",),
        bilingue_possible=True,
        site_web="costco.ca",
    ),
    Enseigne(
        "Adonis",
        _EPICERIE_COMPLETE,
        ("Marche Adonis", "adonis.ca"),
        ("Merci et a la prochaine",),
        3,
        18,
        poids=4,
        variantes_nom=("MARCHE ADONIS",),
    ),
    Enseigne(
        "Marché Richelieu",
        _EPICERIE_COMPLETE,
        ("Marche Richelieu", "Votre epicier de quartier"),
        ("Merci de votre visite",),
        2,
        15,
        poids=3,
        variantes_nom=("MARCHE RICHELIEU",),
        independant=True,
    ),
    Enseigne(
        "Bonichoix",
        _EPICERIE_COMPLETE,
        ("Bonichoix",),
        ("Merci de votre encouragement",),
        2,
        14,
        poids=2,
        variantes_nom=("BONICHOIX",),
        independant=True,
    ),
    Enseigne(
        "Walmart",
        _GRANDE_SURFACE,
        ("Walmart Supercentre", "Economisez. Vivez mieux."),
        ("Merci de magasiner chez Walmart", "Conservez votre recu"),
        2,
        20,
        poids=6,
        variantes_nom=("WALMART", "WALMART SUPERCENTRE"),
        bilingue_possible=True,
        site_web="walmart.ca",
    ),
    # --- Depanneurs ----------------------------------------------------------
    Enseigne(
        "Couche-Tard",
        _DEPANNEUR,
        ("Couche-Tard", "Ouvert 24h"),
        ("Merci! Bonne journee", "Merci de votre visite"),
        1,
        6,
        poids=12,
        variantes_nom=("COUCHE-TARD",),
        type_commerce="depanneur",
        site_web="couche-tard.com",
    ),
    Enseigne(
        "Dépanneur du coin",
        _DEPANNEUR,
        ("Depanneur", "Ouvert 7 jours"),
        ("Merci",),
        1,
        6,
        poids=6,
        variantes_nom=(
            "DEPANNEUR CHEZ DENIS", "DEP. DU COIN", "DEPANNEUR 7 JOURS", "DEP. ST-LAURENT",
            "DEPANNEUR BEAU-SOIR", "MARCHE EXPRESS", "DEPANNEUR LA FONTAINE", "ACCOMMODATION ST-JEAN",
        ),
        type_commerce="depanneur",
        independant=True,
    ),
    Enseigne(
        "Boni-Soir",
        _DEPANNEUR,
        ("Boni-Soir",),
        ("Merci de votre visite",),
        1,
        6,
        poids=3,
        variantes_nom=("BONI-SOIR",),
        type_commerce="depanneur",
    ),
    # --- Pharmacies ----------------------------------------------------------
    Enseigne(
        "Jean Coutu",
        _PHARMACIE,
        ("Jean Coutu - On trouve de tout, meme un ami", "jeancoutu.com"),
        ("Merci de votre confiance", "Conservez ce recu"),
        1,
        10,
        poids=8,
        variantes_nom=("PJC JEAN COUTU", "JEAN COUTU"),
        type_commerce="pharmacie",
        site_web="jeancoutu.com",
    ),
    Enseigne(
        "Pharmaprix",
        _PHARMACIE,
        ("Pharmaprix", "pharmaprix.ca"),
        ("Merci de magasiner chez Pharmaprix",),
        1,
        10,
        poids=6,
        variantes_nom=("PHARMAPRIX",),
        type_commerce="pharmacie",
        bilingue_possible=True,
        site_web="pharmaprix.ca",
    ),
    Enseigne(
        "Uniprix",
        _PHARMACIE,
        ("Uniprix", "uniprix.com"),
        ("Merci de votre visite",),
        1,
        8,
        poids=4,
        variantes_nom=("UNIPRIX",),
        type_commerce="pharmacie",
        site_web="uniprix.com",
    ),
    Enseigne(
        "Familiprix",
        _PHARMACIE,
        ("Familiprix - Ah! Ha!", "familiprix.com"),
        ("Merci de votre confiance",),
        1,
        8,
        poids=4,
        variantes_nom=("FAMILIPRIX", "FAMILIPRIX EXTRA"),
        type_commerce="pharmacie",
        site_web="familiprix.com",
    ),
    Enseigne(
        "Brunet",
        _PHARMACIE,
        ("Brunet", "brunet.ca"),
        ("Merci de votre visite",),
        1,
        8,
        poids=3,
        variantes_nom=("BRUNET", "BRUNET PLUS"),
        type_commerce="pharmacie",
        site_web="brunet.ca",
    ),
    # --- Restaurants ---------------------------------------------------------
    Enseigne(
        "Restaurant indépendant",
        _RESTAURANT,
        ("Bon appetit!", "Cuisine maison", "Depuis 1987", "Ouvert 7 jours"),
        ("Merci de votre visite!", "Au plaisir de vous revoir", "Suivez-nous sur Facebook"),
        1,
        9,
        poids=16,
        variantes_nom=(
            "RESTAURANT CHEZ LUCIEN", "LE PETIT BISTRO", "PIZZERIA NAPOLI", "RESTO-BAR LE COMPTOIR",
            "CASSE-CROUTE CHEZ TI-POP", "SUSHI YAMA", "LE GRILL DU QUARTIER", "BISTRO LA FONTAINE",
            "RESTAURANT LA BELLE ITALIENNE", "TRATTORIA DA PINO", "LE SAINT-DENIS", "CHEZ MARIO",
            "RESTAURANT PHO SAIGON", "LA MAISON DU SOUVLAKI", "BRASSERIE LES DEUX FRERES",
            "RESTAURANT L'ENTRECOTE", "CANTINE CHEZ GILLES", "LE BISTRO DU MARCHE",
        ),
        type_commerce="restaurant",
        independant=True,
    ),
    Enseigne(
        "St-Hubert",
        _RESTAURANT,
        ("Rotisserie St-Hubert", "st-hubert.com"),
        ("Merci et a bientot!", "Commandez en ligne: st-hubert.com"),
        1,
        8,
        poids=8,
        variantes_nom=("ROTISSERIE ST-HUBERT", "ST-HUBERT"),
        type_commerce="restaurant",
        site_web="st-hubert.com",
        mots_cles_produits=_MOTS_ST_HUBERT,
    ),
    Enseigne(
        "Chez Cora",
        _RESTAURANT_SANS_ALCOOL,
        ("Chez Cora - Dejeuners", "chezcora.com"),
        ("Merci et bonne journee!",),
        1,
        6,
        poids=5,
        variantes_nom=("CHEZ CORA", "CORA DEJEUNERS"),
        type_commerce="restaurant",
        site_web="chezcora.com",
        mots_cles_produits=("déjeuner", "crêpe", "gaufre", "omelette", "œufs", "pain doré", "café", "jus", "fruits", "bénédictine"),
    ),
    Enseigne(
        "Normandin",
        _RESTAURANT_SANS_ALCOOL,
        ("Restaurant Normandin", "normandin.ca"),
        ("Merci de votre visite",),
        1,
        7,
        poids=4,
        variantes_nom=("NORMANDIN",),
        type_commerce="restaurant",
        site_web="normandin.ca",
    ),
    Enseigne(
        "Mikes",
        _RESTAURANT,
        ("Mikes", "mikes.ca"),
        ("Merci!",),
        1,
        7,
        poids=4,
        variantes_nom=("MIKES", "RESTAURANT MIKES"),
        type_commerce="restaurant",
        site_web="mikes.ca",
        mots_cles_produits=("pizza", "pâtes", "spaghetti", "lasagne", "salade", "bière", "vin", "tiramisu", "café", "liqueur"),
    ),
    Enseigne(
        "Scores",
        _RESTAURANT,
        ("Scores - Rotisserie & Cotes levees", "scores.ca"),
        ("Merci de votre visite",),
        1,
        8,
        poids=3,
        variantes_nom=("SCORES",),
        type_commerce="restaurant",
        site_web="scores.ca",
        mots_cles_produits=_MOTS_ST_HUBERT,
    ),
    Enseigne(
        "Pacini",
        _RESTAURANT,
        ("Pacini", "pacini.com"),
        ("Grazie mille!",),
        1,
        8,
        poids=3,
        variantes_nom=("PACINI",),
        type_commerce="restaurant",
        site_web="pacini.com",
        mots_cles_produits=("pizza", "pâtes", "carbonara", "bolognaise", "alfredo", "risotto", "tiramisu", "vin", "bière", "café", "bruschetta", "calmars"),
    ),
    Enseigne(
        "Boston Pizza",
        _RESTAURANT,
        ("Boston Pizza", "bostonpizza.com"),
        ("Merci / Thank you",),
        1,
        8,
        poids=3,
        variantes_nom=("BOSTON PIZZA",),
        type_commerce="restaurant",
        bilingue_possible=True,
        site_web="bostonpizza.com",
        mots_cles_produits=("pizza", "pâtes", "ailes", "nachos", "burger", "bière", "pinte", "pichet", "salade", "liqueur"),
    ),
    Enseigne(
        "La Cage",
        _RESTAURANT,
        ("La Cage - Brasserie sportive", "cage.ca"),
        ("Merci de votre visite!",),
        1,
        9,
        poids=4,
        variantes_nom=("LA CAGE", "LA CAGE BRASSERIE SPORTIVE"),
        type_commerce="restaurant",
        site_web="cage.ca",
        mots_cles_produits=("ailes", "burger", "nachos", "côtes levées", "poutine", "bière", "pinte", "pichet", "fish", "tartare", "liqueur"),
    ),
    # --- Cafes ---------------------------------------------------------------
    Enseigne(
        "Tim Hortons",
        _CAFE,
        ("Tim Hortons", "Toujours frais"),
        ("Merci / Thank you", "Merci de votre visite"),
        1,
        6,
        poids=16,
        variantes_nom=("TIM HORTONS",),
        type_commerce="cafe",
        bilingue_possible=True,
        site_web="timhortons.ca",
        mots_cles_produits=("timbits", "beigne", "iced capp", "café", "muffin", "bagel", "déjeuner", "soupe", "chili", "thé", "chocolat chaud", "biscuit", "wrap", "sandwich"),
    ),
    Enseigne(
        "Starbucks",
        _CAFE,
        ("Starbucks Coffee",),
        ("Thank you / Merci",),
        1,
        4,
        poids=8,
        variantes_nom=("STARBUCKS", "STARBUCKS COFFEE"),
        type_commerce="cafe",
        bilingue_possible=True,
        site_web="starbucks.ca",
        mots_cles_produits=("latte", "frapp", "espresso", "americano", "macchiato", "cold brew", "croissant", "scone", "chai", "matcha", "flat white", "café", "moka", "cappuccino"),
    ),
    Enseigne(
        "Second Cup",
        _CAFE,
        ("Second Cup Cafe",),
        ("Merci!",),
        1,
        4,
        poids=3,
        variantes_nom=("SECOND CUP",),
        type_commerce="cafe",
        site_web="secondcup.com",
        mots_cles_produits=("latte", "espresso", "americano", "cappuccino", "moka", "chai", "muffin", "biscuit", "café", "thé", "croissant"),
    ),
    Enseigne(
        "Café Dépôt",
        _CAFE,
        ("Cafe Depot",),
        ("Merci et bonne journee",),
        1,
        4,
        poids=3,
        variantes_nom=("CAFE DEPOT",),
        type_commerce="cafe",
        mots_cles_produits=("café", "latte", "espresso", "cappuccino", "muffin", "bagel", "sandwich", "panini", "soupe", "biscuit", "thé"),
    ),
    Enseigne(
        "Van Houtte",
        _CAFE,
        ("Cafe Van Houtte", "vanhoutte.com"),
        ("Merci de votre visite",),
        1,
        4,
        poids=2,
        variantes_nom=("CAFE VAN HOUTTE", "VAN HOUTTE"),
        type_commerce="cafe",
        site_web="vanhoutte.com",
        mots_cles_produits=("café", "latte", "espresso", "cappuccino", "croissant", "muffin", "bagel", "sandwich", "soupe", "thé"),
    ),
    Enseigne(
        "Café indépendant",
        _CAFE,
        ("Torrefaction maison", "Cafe de quartier", "Bienvenue!"),
        ("Merci! A la prochaine", "Suivez-nous sur Instagram"),
        1,
        4,
        poids=6,
        variantes_nom=(
            "CAFE LE PETIT MOULIN", "CAFE OLIMPICO", "BRULERIE SAINT-ROCH", "CAFE PISTA",
            "CAFE DE LA GARE", "CAFE MYRIADE", "LE CAFE DU COIN", "BRULERIE DU QUARTIER",
        ),
        type_commerce="cafe",
        independant=True,
        mots_cles_produits=("café", "latte", "espresso", "cappuccino", "cortado", "allongé", "flat white", "croissant", "muffin", "biscuit", "scone", "chai", "matcha", "thé", "chocolat chaud"),
    ),
    # --- Restauration rapide -------------------------------------------------
    Enseigne(
        "McDonald's",
        _RAPIDE,
        ("McDonald's", "I'm lovin' it"),
        ("Merci / Thank you", "Commandez avec l'appli McDo"),
        1,
        7,
        poids=14,
        variantes_nom=("MCDONALD'S", "MCDONALD'S RESTAURANT"),
        type_commerce="restauration_rapide",
        bilingue_possible=True,
        site_web="mcdonalds.ca",
        mots_cles_produits=("big mac", "mcpoulet", "mcmuffin", "quart de livre", "filet-o-fish", "nuggets", "frites", "mcflurry", "trio", "cheeseburger", "hamburger", "liqueur", "café", "sundae"),
    ),
    Enseigne(
        "A&W",
        _RAPIDE,
        ("A&W", "A&W Canada"),
        ("Merci / Thank you",),
        1,
        6,
        poids=6,
        variantes_nom=("A&W", "A&W RESTAURANT"),
        type_commerce="restauration_rapide",
        bilingue_possible=True,
        site_web="aw.ca",
        mots_cles_produits=("teen burger", "papa burger", "mama burger", "buddy burger", "root beer", "rondelles", "frites", "poulet", "trio", "déjeuner"),
    ),
    Enseigne(
        "Subway",
        _RAPIDE,
        ("Subway", "Savourez la fraicheur"),
        ("Merci / Thank you",),
        1,
        5,
        poids=8,
        variantes_nom=("SUBWAY",),
        type_commerce="restauration_rapide",
        bilingue_possible=True,
        site_web="subway.com",
        mots_cles_produits=("sous-marin", "biscuit", "soupe", "liqueur", "salade", "wrap"),
    ),
    Enseigne(
        "Harvey's",
        _RAPIDE,
        ("Harvey's",),
        ("Merci / Thank you",),
        1,
        6,
        poids=4,
        variantes_nom=("HARVEY'S",),
        type_commerce="restauration_rapide",
        bilingue_possible=True,
        mots_cles_produits=("burger", "frites", "poutine", "rondelles", "trio", "hot-dog", "poulet", "liqueur"),
    ),
    Enseigne(
        "Burger King",
        _RAPIDE,
        ("Burger King",),
        ("Merci / Thank you",),
        1,
        6,
        poids=4,
        variantes_nom=("BURGER KING",),
        type_commerce="restauration_rapide",
        bilingue_possible=True,
        mots_cles_produits=("whopper", "frites", "rondelles", "trio", "poulet", "cheeseburger", "hamburger", "liqueur", "nuggets"),
    ),
    Enseigne(
        "PFK",
        _RAPIDE,
        ("PFK - Poulet Frit Kentucky",),
        ("Merci de votre visite",),
        1,
        6,
        poids=5,
        variantes_nom=("PFK", "POULET FRIT KENTUCKY"),
        type_commerce="restauration_rapide",
        mots_cles_produits=("poulet", "seau", "frites", "salade de chou", "sandwich", "trio", "poutine", "liqueur", "ailes"),
    ),
    Enseigne(
        "Thaï Express",
        _RAPIDE,
        ("Thai Express",),
        ("Merci / Thank you",),
        1,
        5,
        poids=4,
        variantes_nom=("THAI EXPRESS",),
        type_commerce="restauration_rapide",
        mots_cles_produits=("pad", "bol", "général", "rouleaux", "soupe", "riz", "thaï", "poulet", "liqueur"),
    ),
    Enseigne(
        "Sushi Shop",
        _RAPIDE,
        ("Sushi Shop",),
        ("Merci / Arigato",),
        1,
        5,
        poids=4,
        variantes_nom=("SUSHI SHOP",),
        type_commerce="restauration_rapide",
        mots_cles_produits=("sushi", "poké", "maki", "edamame", "miso", "bol", "gyoza", "liqueur", "thé"),
    ),
    Enseigne(
        "St-Hubert Express",
        _RAPIDE,
        ("St-Hubert Express",),
        ("Merci et a bientot!",),
        1,
        6,
        poids=4,
        variantes_nom=("ST-HUBERT EXPRESS",),
        type_commerce="restauration_rapide",
        site_web="st-hubert.com",
        mots_cles_produits=_MOTS_ST_HUBERT,
    ),
    Enseigne(
        "Valentine",
        _RAPIDE,
        ("Valentine",),
        ("Merci de votre visite",),
        1,
        6,
        poids=4,
        variantes_nom=("VALENTINE",),
        type_commerce="restauration_rapide",
        mots_cles_produits=_MOTS_CASSE_CROUTE,
    ),
    Enseigne(
        "La Belle Province",
        _RAPIDE,
        ("La Belle Province",),
        ("Merci!",),
        1,
        6,
        poids=4,
        variantes_nom=("LA BELLE PROVINCE", "RESTAURANT LA BELLE PROVINCE"),
        type_commerce="restauration_rapide",
        mots_cles_produits=_MOTS_CASSE_CROUTE,
    ),
    Enseigne(
        "Lafleur",
        _RAPIDE,
        ("Lafleur - Depuis 1951",),
        ("Merci!",),
        1,
        6,
        poids=3,
        variantes_nom=("LAFLEUR", "RESTAURANT LAFLEUR"),
        type_commerce="restauration_rapide",
        mots_cles_produits=_MOTS_CASSE_CROUTE,
    ),
    # --- Bars et microbrasseries ---------------------------------------------
    Enseigne(
        "Bar indépendant",
        _BAR,
        ("Bienvenue!", "Ouvert jusqu'a 3h", "Happy hour 16h-19h"),
        ("Merci et bonne soiree!", "Consommez avec moderation", "Taxi? Demandez au bar"),
        1,
        10,
        poids=10,
        variantes_nom=(
            "TAVERNE MODERNE", "PUB SAINT-PAUL", "BAR CHEZ ROGER", "LE SAINT-BOCK", "BAR LE MAGELLAN",
            "PUB L'ILE NOIRE", "TAVERNE SAINT-SACREMENT", "BAR LA TULIPE NOIRE", "BISTRO-BAR LE CENTRAL",
            "PUB BREWSKI", "BAR LE CHEVAL BLANC", "LE BAR DU COIN",
        ),
        type_commerce="bar",
        independant=True,
    ),
    Enseigne(
        "Microbrasserie",
        _BAR,
        ("Bieres brassees sur place", "Brasserie artisanale"),
        ("Merci! Sante!", "Consommez avec moderation"),
        1,
        8,
        poids=6,
        variantes_nom=(
            "MICROBRASSERIE LE CASTOR DORE", "BRASSERIE ARTISANALE DU NORD", "MICROBRASSERIE LE TROU DU DIABLE",
            "BRASSERIE DIEU DU CIEL", "MICROBRASSERIE LA BARBERIE", "LE NAUFRAGEUR", "BRASSERIE LE BILBOQUET",
        ),
        type_commerce="bar",
        independant=True,
        mots_cles_produits=("bière", "pinte", "pichet", "verre", "ipa", "blonde", "rousse", "blanche", "stout", "cidre", "nachos", "ailes", "bretzel"),
    ),
    # --- Quincailleries ------------------------------------------------------
    Enseigne(
        "Rona",
        _QUINCAILLERIE,
        ("RONA", "rona.ca"),
        ("Politique de retour: 90 jours avec recu", "Merci de magasiner chez RONA"),
        1,
        12,
        poids=10,
        variantes_nom=("RONA", "RONA L'ENTREPOT", "RONA+"),
        type_commerce="quincaillerie",
        site_web="rona.ca",
    ),
    Enseigne(
        "Canadian Tire",
        _QUINCAILLERIE,
        ("Canadian Tire", "canadiantire.ca"),
        ("Merci / Thank you", "Argent Canadian Tire - Triangle"),
        1,
        12,
        poids=9,
        variantes_nom=("CANADIAN TIRE",),
        type_commerce="quincaillerie",
        bilingue_possible=True,
        site_web="canadiantire.ca",
    ),
    Enseigne(
        "Home Depot",
        _QUINCAILLERIE,
        ("The Home Depot", "homedepot.ca"),
        ("Merci / Thank you", "Retours: 90 jours avec recu"),
        1,
        12,
        poids=7,
        variantes_nom=("HOME DEPOT", "THE HOME DEPOT"),
        type_commerce="quincaillerie",
        bilingue_possible=True,
        site_web="homedepot.ca",
    ),
    Enseigne(
        "BMR",
        _QUINCAILLERIE,
        ("BMR", "bmr.ca"),
        ("Merci de votre visite",),
        1,
        10,
        poids=5,
        variantes_nom=("BMR", "BMR MATERIAUX"),
        type_commerce="quincaillerie",
        site_web="bmr.ca",
    ),
    Enseigne(
        "Patrick Morin",
        _QUINCAILLERIE,
        ("Patrick Morin", "patrickmorin.com"),
        ("Merci de votre visite",),
        1,
        10,
        poids=4,
        variantes_nom=("PATRICK MORIN",),
        type_commerce="quincaillerie",
        site_web="patrickmorin.com",
    ),
    Enseigne(
        "Home Hardware",
        _QUINCAILLERIE,
        ("Home Hardware", "Quincaillerie de quartier"),
        ("Merci!",),
        1,
        8,
        poids=4,
        variantes_nom=("HOME HARDWARE", "QUINCAILLERIE HOME HARDWARE"),
        type_commerce="quincaillerie",
        independant=True,
    ),
    # --- Detail --------------------------------------------------------------
    Enseigne(
        "Dollarama",
        _DOLLAR,
        ("Dollarama",),
        ("Aucun remboursement - echange seulement", "Merci"),
        1,
        12,
        poids=10,
        variantes_nom=("DOLLARAMA",),
        type_commerce="detail",
        site_web="dollarama.com",
    ),
    Enseigne(
        "Dollar Plus",
        _DOLLAR,
        ("Tout a 1$ et plus",),
        ("Aucun remboursement", "Merci"),
        1,
        10,
        poids=3,
        variantes_nom=("DOLLAR PLUS", "MAGASIN GENERAL", "BAZAR DU DOLLAR"),
        type_commerce="detail",
        independant=True,
    ),
    # --- SAQ -----------------------------------------------------------------
    Enseigne(
        "SAQ",
        _SAQ,
        ("Societe des alcools du Quebec", "saq.com"),
        ("Moderation a bien meilleur gout", "Merci de votre visite", "Points Inspire"),
        1,
        8,
        poids=10,
        variantes_nom=("SAQ", "SAQ SELECTION", "SAQ EXPRESS", "SAQ DEPOT", "SAQ CLASSIQUE"),
        type_commerce="saq",
        site_web="saq.com",
    ),
    # --- Stations-service ----------------------------------------------------
    Enseigne(
        "Esso",
        _STATION,
        ("Esso", "Points Esso Extra"),
        ("Merci / Thank you",),
        1,
        4,
        poids=8,
        variantes_nom=("ESSO", "ESSO MARCHE EXPRESS"),
        type_commerce="station_service",
        bilingue_possible=True,
    ),
    Enseigne(
        "Shell",
        _STATION,
        ("Shell", "Air Miles"),
        ("Merci / Thank you",),
        1,
        4,
        poids=8,
        variantes_nom=("SHELL", "SHELL SELECT"),
        type_commerce="station_service",
        bilingue_possible=True,
    ),
    Enseigne(
        "Petro-Canada",
        _STATION,
        ("Petro-Canada", "Petro-Points"),
        ("Merci / Thank you",),
        1,
        4,
        poids=8,
        variantes_nom=("PETRO-CANADA",),
        type_commerce="station_service",
        bilingue_possible=True,
        site_web="petro-canada.ca",
    ),
    Enseigne(
        "Ultramar",
        _STATION,
        ("Ultramar",),
        ("Merci de votre visite",),
        1,
        4,
        poids=6,
        variantes_nom=("ULTRAMAR",),
        type_commerce="station_service",
    ),
    Enseigne(
        "Couche-Tard station",
        _STATION,
        ("Couche-Tard", "Circle K"),
        ("Merci! Bonne route",),
        1,
        4,
        poids=6,
        variantes_nom=("COUCHE-TARD", "CIRCLE K"),
        type_commerce="station_service",
    ),
    Enseigne(
        "Harnois",
        _STATION,
        ("Harnois Energies",),
        ("Merci de votre visite",),
        1,
        4,
        poids=3,
        variantes_nom=("HARNOIS", "HARNOIS ENERGIES"),
        type_commerce="station_service",
    ),
    Enseigne(
        "Crevier",
        _STATION,
        ("Crevier",),
        ("Merci!",),
        1,
        4,
        poids=3,
        variantes_nom=("CREVIER",),
        type_commerce="station_service",
    ),
)

ENSEIGNES_PAR_TYPE: Final[dict[str, tuple[Enseigne, ...]]] = {
    t: tuple(e for e in ENSEIGNES if e.type_commerce == t) for t in TYPES_COMMERCE
}
assert all(ENSEIGNES_PAR_TYPE[t] for t in TYPES_COMMERCE), "chaque type doit avoir au moins une enseigne"
assert set(POIDS_TYPES) == set(TYPES_COMMERCE)
assert all(e.type_commerce in TYPES_COMMERCE for e in ENSEIGNES)



# ---------------------------------------------------------------------------
# Rues, villes et telephones
# ---------------------------------------------------------------------------

RUES: Final[tuple[str, ...]] = (
    "rue Sainte-Catherine O",
    "rue Sainte-Catherine E",
    "boul. Saint-Laurent",
    "rue Saint-Denis",
    "boul. René-Lévesque O",
    "rue Sherbrooke O",
    "rue Sherbrooke E",
    "av. du Mont-Royal E",
    "av. du Parc",
    "rue Ontario E",
    "boul. Pie-IX",
    "rue Jean-Talon E",
    "rue Jean-Talon O",
    "boul. Décarie",
    "ch. de la Côte-des-Neiges",
    "rue Wellington",
    "boul. Saint-Joseph E",
    "rue Beaubien E",
    "rue Masson",
    "boul. Rosemont",
    "boul. Henri-Bourassa E",
    "boul. Gouin O",
    "boul. des Laurentides",
    "boul. Curé-Labelle",
    "boul. Saint-Martin O",
    "boul. Taschereau",
    "ch. de Chambly",
    "boul. Cousineau",
    "boul. Roland-Therrien",
    "boul. Laurier",
    "Grande Allée E",
    "boul. Wilfrid-Hamel",
    "boul. Charest E",
    "rue Saint-Jean",
    "ch. Sainte-Foy",
    "boul. des Galeries",
    "rue King O",
    "boul. de Portland",
    "boul. Bourque",
    "boul. des Forges",
    "boul. Saint-Joseph",
    "boul. Maloney O",
    "boul. Gréber",
    "boul. Talbot",
    "rue Racine E",
    "boul. Guillaume-Couture",
    "route du Président-Kennedy",
    "boul. Saint-Joseph",
    "boul. de la Rive-Sud",
    "rue Principale",
    "rue Notre-Dame",
    "boul. Industriel",
    "rue Saint-Georges",
    "boul. Labelle",
    "boul. de la Concorde E",
    "av. Papineau",
    "rue Hochelaga",
    "boul. Lacordaire",
    "boul. Langelier",
    "rue Fleury E",
)


@dataclass(frozen=True)
# Ville quebecoise, avec ses prefixes de code postal et ses indicatifs.
class Ville:

    nom: str
    prefixes_postaux: tuple[str, ...]
    indicatifs: tuple[str, ...]


VILLES: Final[tuple[Ville, ...]] = (
    Ville("Montréal", ("H1A", "H1V", "H2X", "H2L", "H3A", "H3B", "H3H", "H4C", "H2S", "H1Y", "H3T", "H4N", "H1M"), ("514", "438")),
    Ville("Laval", ("H7A", "H7L", "H7N", "H7S", "H7T", "H7V"), ("450", "579")),
    Ville("Longueuil", ("J4H", "J4K", "J4L", "J4G", "J4N"), ("450", "579")),
    Ville("Brossard", ("J4W", "J4X", "J4Y", "J4Z"), ("450", "579")),
    Ville("Québec", ("G1A", "G1K", "G1R", "G1S", "G1V", "G1X", "G2B", "G2K"), ("418", "581")),
    Ville("Lévis", ("G6V", "G6W", "G6Z", "G7A"), ("418", "581")),
    Ville("Gatineau", ("J8P", "J8T", "J8X", "J8Y", "J9A", "J9H"), ("819", "873")),
    Ville("Sherbrooke", ("J1E", "J1H", "J1J", "J1K", "J1L"), ("819", "873")),
    Ville("Trois-Rivières", ("G8T", "G8W", "G8Y", "G9A", "G9B"), ("819", "873")),
    Ville("Saguenay", ("G7H", "G7J", "G7S", "G7X"), ("418", "581")),
    Ville("Terrebonne", ("J6V", "J6W", "J6X", "J6Y"), ("450", "579")),
    Ville("Drummondville", ("J2B", "J2C", "J2E"), ("819", "873")),
    Ville("Saint-Jérôme", ("J5L", "J7Y", "J7Z"), ("450", "579")),
    Ville("Repentigny", ("J5Y", "J5Z", "J6A"), ("450", "579")),
    Ville("Granby", ("J2G", "J2H", "J2J"), ("450", "579")),
    Ville("Blainville", ("J7B", "J7C"), ("450", "579")),
    Ville("Boucherville", ("J4B",), ("450", "579")),
    Ville("Rimouski", ("G5L", "G5M", "G5N"), ("418", "581")),
    Ville("Saint-Hyacinthe", ("J2S", "J2T"), ("450", "579")),
    Ville("Chicoutimi", ("G7G", "G7H"), ("418", "581")),
    Ville("Sainte-Foy", ("G1V", "G1W", "G1X"), ("418", "581")),
    Ville("Mascouche", ("J7K", "J7L"), ("450", "579")),
    Ville("Saint-Eustache", ("J7P", "J7R"), ("450", "579")),
    Ville("Victoriaville", ("G6P", "G6R", "G6S"), ("819", "873")),
    Ville("Rouyn-Noranda", ("J9X", "J9Y"), ("819", "873")),
)

#: Lettres et chiffres autorises dans un code postal canadien (apres le prefixe).
LETTRES_CODE_POSTAL: Final[str] = "ABCEGHJKLMNPRSTVWXYZ"


# ---------------------------------------------------------------------------
# Paiement
# ---------------------------------------------------------------------------

#: Mode de paiement et poids relatif.
MODES_PAIEMENT: Final[tuple[tuple[str, int], ...]] = (
    ("INTERAC", 40),
    ("VISA", 22),
    ("MASTERCARD", 16),
    ("COMPTANT", 14),
    ("AMEX", 4),
    ("DEBIT", 4),
)

#: Libelles imprimes possibles pour chaque mode (variantes de caisse).
LIBELLES_PAIEMENT: Final[dict[str, tuple[str, ...]]] = {
    "INTERAC": ("INTERAC", "DEBIT INTERAC", "INTERAC FLASH", "CARTE DEBIT"),
    "VISA": ("VISA", "CARTE VISA", "VISA CREDIT"),
    "MASTERCARD": ("MASTERCARD", "MC", "MASTER CARD"),
    "COMPTANT": ("COMPTANT", "ARGENT COMPTANT", "CASH", "ESPECES"),
    "AMEX": ("AMEX", "AMERICAN EXPRESS"),
    "DEBIT": ("DEBIT", "CARTE DEBIT"),
}

#: Libelles de rabais rencontres sur les recus.
LIBELLES_RABAIS: Final[tuple[str, ...]] = (
    "RABAIS",
    "SPECIAL",
    "ECONOMIE",
    "COUPON",
    "PRIX REDUIT",
    "RABAIS MEMBRE",
    "AUBAINE",
    "-RABAIS",
)

#: Prenoms de caissiers et caissieres.
PRENOMS_CAISSIERS: Final[tuple[str, ...]] = (
    "MARIE", "JULIE", "SOPHIE", "NATHALIE", "ISABELLE", "CAROLINE", "MELANIE",
    "STEPHANIE", "VALERIE", "ANNIE", "KARINE", "MARTIN", "PIERRE", "JEAN",
    "FRANCOIS", "PATRICK", "ERIC", "SEBASTIEN", "MATHIEU", "GABRIEL", "SAMUEL",
    "OLIVIER", "ALEXANDRE", "MAXIME", "EMILIE", "CAMILLE", "LEA", "ROSALIE",
    "MOHAMED", "FATIMA", "NADIA", "KEVIN", "JONATHAN", "AHMED", "CHLOE",
)

#: Polices a chasse fixe candidates (chemins macOS / Linux). Seules celles
#: presentes sur la machine sont utilisees ; le repli est la police PIL.
POLICES_CANDIDATES: Final[tuple[str, ...]] = (
    "/System/Library/Fonts/Supplemental/Courier New.ttf",
    "/System/Library/Fonts/Supplemental/Courier New Bold.ttf",
    "/System/Library/Fonts/Supplemental/Andale Mono.ttf",
    "/System/Library/Fonts/Supplemental/PTMono.ttc",
    "/System/Library/Fonts/Monaco.ttf",
    "/System/Library/Fonts/Menlo.ttc",
    "/System/Library/Fonts/SFNSMono.ttf",
    "/System/Library/Fonts/Courier.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf",
    "/usr/share/fonts/truetype/freefont/FreeMono.ttf",
    "/usr/share/fonts/truetype/ubuntu/UbuntuMono-R.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansMono-Regular.ttf",
)


# ---------------------------------------------------------------------------
# Clients, documents, mentions et libelles
# ---------------------------------------------------------------------------

#: Noms de famille frequents au Quebec (raisons sociales de clients B2B).
NOMS_FAMILLE_QUEBEC: Final[tuple[str, ...]] = (
    "Tremblay", "Gagnon", "Roy", "Côté", "Bouchard", "Gauthier", "Morin", "Lavoie", "Fortin",
    "Gagné", "Ouellet", "Pelletier", "Bélanger", "Lévesque", "Bergeron", "Leblanc", "Paquette",
    "Girard", "Simard", "Boucher", "Caron", "Beaulieu", "Cloutier", "Dubé", "Poirier", "Fournier",
    "Lapointe", "Leclerc", "Lefebvre", "Poulin", "Thibault", "St-Pierre", "Nadeau", "Martin",
    "Landry", "Dion", "Hébert", "Roberge", "Bédard", "Boisvert",
)

#: Secteurs d'activite pour composer un nom d'entreprise.
SECTEURS_ENTREPRISE: Final[tuple[str, ...]] = (
    "Construction", "Entreprises", "Groupe", "Services", "Transport", "Excavation", "Électrique",
    "Plomberie", "Toitures", "Consultants", "Immobilier", "Traiteur", "Gestion", "Rénovations",
    "Paysagement", "Déneigement", "Menuiserie", "Communications", "Design", "Logistique",
)

FORMES_JURIDIQUES: Final[tuple[str, ...]] = ("inc.", "inc.", "ltée", "s.e.n.c.", "enr.", "")

#: Patrons de nom d'entreprise (``{secteur}``, ``{nom}``, ``{forme}``, ``{numero}``).
PATRONS_NOM_ENTREPRISE: Final[tuple[str, ...]] = (
    "{secteur} {nom} {forme}",
    "{secteur} {nom} {forme}",
    "Les {secteur} {nom} {forme}",
    "{nom} & Fils {forme}",
    "{nom} et Frères {forme}",
    "{secteur} {nom} & Associés {forme}",
    "{numero} Québec inc.",
)

#: Mode de service en restauration (imprime tel quel).
MODES_SERVICE: Final[tuple[str, ...]] = ("SUR PLACE", "POUR EMPORTER", "LIVRAISON", "SERVICE AU VOLANT")

TYPES_DOCUMENT: Final[tuple[str, ...]] = ("FACTURE", "ADDITION", "RECU")

#: Mentions reglementaires ou commerciales imprimees en pied de recu.
MENTIONS_PIED: Final[tuple[str, ...]] = (
    "Politique d'échange: 30 jours avec reçu",
    "Aucun remboursement sans reçu",
    "Échange ou crédit seulement",
    "Ce document est une facture / This document is an invoice",
    "Facture disponible en français sur demande",
    "Prix en dollars canadiens",
    "Taxes incluses dans le total",
    "Conservez ce reçu pour la garantie",
    "Service à la clientèle: 1 800 555-0199",
    "Vos commentaires: sondage en ligne",
    "Nous embauchons! Postulez en succursale",
)

#: Mentions propres aux commerces d'alcool.
MENTIONS_ALCOOL: Final[tuple[str, ...]] = (
    "Taxe spécifique sur les boissons alcooliques incluse",
    "Consommez avec modération",
    "Il est interdit de vendre de l'alcool aux mineurs",
)

#: Libelles bilingues (FR/EN) substitues lorsque ``style.bilingue`` est vrai.
LIBELLES_BILINGUES: Final[dict[str, str]] = {
    "Sous-total": "Sous-total / Subtotal",
    "TPS": "TPS/GST",
    "TVQ": "TVQ/QST",
    "TOTAL": "TOTAL",
    "Pourboire": "Pourboire / Tip",
    "Monnaie": "Monnaie / Change",
    "Arrondi": "Arrondi / Rounding",
    "Articles": "Articles / Items",
    "Merci": "Merci / Thank you",
    "Frais de service": "Frais de service / Service charge",
    "Livraison": "Livraison / Delivery",
    "Table": "Table",
    "Serveur": "Serveur / Server",
    "Commande": "Commande / Order",
    "Caisse": "Caisse / Register",
    "Client": "Client / Customer",
    "Facturé à": "Facturé à / Bill to",
    "Date": "Date",
    "Heure": "Heure / Time",
}

LIBELLES_POURBOIRE: Final[tuple[str, ...]] = ("Pourboire", "Pourboire", "Pourb.", "Gratuité", "TIP", "Pourboire ajouté")
LIBELLES_FRAIS_SERVICE: Final[tuple[str, ...]] = ("Frais de service", "Service", "Frais de service (groupe)", "Frais d'administration")
LIBELLES_LIVRAISON: Final[tuple[str, ...]] = ("Livraison", "Frais de livraison", "Livraison à domicile")
LIBELLES_TOTAL_FINAL: Final[tuple[str, ...]] = ("TOTAL", "TOTAL FINAL", "GRAND TOTAL", "MONTANT FINAL", "TOTAL À PAYER")
LIBELLES_SUGGESTION_POURBOIRE: Final[tuple[str, ...]] = (
    "Suggestions de pourboire", "Pourboire suggéré", "Guide de pourboire", "Suggestion de pourboire (avant taxes)",
)

#: Domaines de courriel plausibles (``{enseigne}`` = domaine de l'enseigne).
DOMAINES_COURRIEL: Final[tuple[str, ...]] = ("gmail.com", "videotron.ca", "hotmail.com", "outlook.com", "bell.net")

#: Libelles du bloc SEV (transmission a Revenu Quebec).
LIBELLES_SEV: Final[tuple[str, ...]] = (
    "Transmis à Revenu Québec",
    "Facture transmise à Revenu Québec",
    "Consultez cette facture en ligne",
    "Vérifiez votre facture: mev-web.revenuquebec.ca",
    "MEV-WEB - Facture originale",
    "Cette facture a été enregistrée au SEV",
)
LIBELLES_NUMERO_SEV: Final[tuple[str, ...]] = ("No trans. SEV", "Transaction SEV", "SEV", "No SEV", "Trans")

#: Prefixes du numero de facture selon le type de document.
PREFIXES_NUMERO_FACTURE: Final[tuple[str, ...]] = (
    "Trans", "Trans.", "No transaction", "Facture", "Recu", "No", "No facture", "Facture no", "#", "Trans #",
)

#: Libelles de la ligne « nombre d'articles ».
LIBELLES_ARTICLES: Final[tuple[str, ...]] = ("Articles", "Nombre d'articles", "Nb articles", "Qté totale", "Items")

#: Prenoms de serveurs et serveuses (restauration).
PRENOMS_SERVEURS: Final[tuple[str, ...]] = (
    "MARIE", "JULIE", "SOPHIE", "MAX", "ALEX", "VINCENT", "CATHERINE", "JESS", "LAURENCE", "SIMON",
    "AUDREY", "MARC-ANDRE", "JADE", "ANTOINE", "MEGAN", "GAB", "SARAH", "NICO", "ELO", "PHIL",
    "SAM", "ROXANNE", "JULIEN", "MYRIAM", "WILLIAM", "EMMA", "LOUIS", "FLORENCE", "THOMAS", "ZOE",
)
