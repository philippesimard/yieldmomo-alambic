# Générateur de reçus québécois synthétiques annotés

Génère des reçus et factures québécois **synthétiques, annotés et
déterministes** — épicerie, dépanneur, pharmacie, restaurant, café,
restauration rapide, bar, quincaillerie, magasin à un dollar, SAQ et
station-service — destinés au fine-tuning d'un modèle de reconnaissance de
factures (Donut, VLM). La vérité terrain suit le format `gt_parse` de CORD
(étendu de clés optionnelles) pour permettre le transfert depuis un Donut
pré-entraîné sur CORD-v2.

- Python 3.11+, dépendances limitées à **Pillow**, **numpy** et **segno**
  (codes QR), aucun appel réseau.
- Une graine donnée reproduit exactement le même jeu de données, y compris
  avec `--jobs N` (graine dérivée par index).
- Tout montant est un `Decimal` ; les règles fiscales sont isolées et testées.
- Catalogue de **2 200+ produits** répartis en 26 catégories, 63 enseignes.

## Installation

Aucune : `npm install` à la racine du dépôt prépare `outils/.venv`, qui sert aussi à
l'entraînement. Voir [../README.md](../README.md).

## Utilisation

```bash
npm run generer-recus -- --n 4000 --jobs 4
```

Sans argument, la sortie va dans `outils/jeu` — ce que lit `npm run entrainer-modele`. Écrire
dans un jeu déjà peuplé demande `--ecraser` : une génération plus courte y laisserait les images
en trop et tronquerait `metadata.jsonl`.

```bash
npm run generer-recus -- --n 2000 --out /tmp/essai --seed 42 --split 0.8,0.1,0.1 \
                         --largeur-cible 1100 --qualite-jpeg 45,92 --planche --jobs 4
```

| Option | Rôle |
| --- | --- |
| `--n` | nombre total de reçus |
| `--out` | dossier de sortie |
| `--seed` | graine ; même graine ⇒ mêmes fichiers, octet pour octet |
| `--split` | proportions `train,valid,test` (blocs contigus d'index) |
| `--types` | types de commerce à générer, séparés par des virgules (défaut : tous, pondérés) |
| `--largeur-cible` | largeur des images finales ; la hauteur suit (les longs reçus restent lisibles) |
| `--qualite-jpeg` | plage `min,max` de qualité JPEG tirée par image |
| `--sans-augmentation` | rendu propre (papier seul), JPEG qualité 95 |
| `--planche` | écrit `<sortie>/apercu.jpg`, planche-contact des 16 premières images |
| `--jobs` | processus parallèles (`multiprocessing`, graine par index) |
| `--ecraser` | autorise l'écriture dans un dossier de sortie déjà peuplé |

Aperçus rapides :

```bash
npm run generer-recus -- --n 12 --out outils/apercu --planche
npm run generer-recus -- --n 12 --out /tmp/apercu-resto --planche --types restaurant,bar,cafe,restauration_rapide
```

## Types de commerce

Le tirage se fait à deux niveaux : le **type** (poids ci-dessous,
`catalogue.POIDS_TYPES`), puis l'enseigne au sein du type. Le type gouverne
le panier, la mise en page, le contexte de service, le bloc SEV, les frais,
le pourboire et les horaires.

| Type | Poids | Enseignes (exemples) | Particularités imprimées |
| --- | --- | --- | --- |
| `epicerie` | 27 | Metro, IGA, Provigo, Super C, Maxi, Costco, Walmart… | poids au kg, rabais, codes de taxe, codes produit, en-têtes de rayon |
| `restaurant` | 18 | indépendants, St-Hubert, Cora, Mikes, Scores, Pacini, La Cage… | FACTURE/ADDITION, table, serveur, couverts, quantité en préfixe, pourboire ajouté ou suggéré, frais de service (groupes), QR SEV, permis RACJ, copie client |
| `cafe` | 8 | Tim Hortons, Starbucks, Second Cup, Van Houtte, indépendants | numéro de commande, sur place / pour emporter / service au volant, QR SEV, libellés bilingues |
| `restauration_rapide` | 8 | McDonald's, A&W, Subway, PFK, Valentine, La Belle Province… | commande, mode de service, trios, livraison, QR SEV |
| `depanneur` | 7 | Couche-Tard, Boni-Soir, dépanneurs indépendants | petit panier, petit fournisseur possible |
| `pharmacie` | 7 | Jean Coutu, Pharmaprix, Uniprix, Familiprix, Brunet | lignes `Rx` détaxées, honoraires, produits de santé taxables |
| `bar` | 5 | tavernes, pubs, microbrasseries | onglet, serveur, MEV, permis RACJ, taxe spécifique incluse, suggestions de pourboire |
| `quincaillerie` | 6 | Rona, Canadian Tire, Home Depot, BMR, Patrick Morin | SKU sous le nom, codes `FP`, employé, client B2B, politiques de retour |
| `detail` | 3 | Dollarama, magasins à un dollar | SKU, échange seulement |
| `saq` | 4 | SAQ (Sélection, Express, Dépôt) | codes produit à 8 chiffres, vins et spiritueux |
| `station_service` | 7 | Esso, Shell, Petro-Canada, Ultramar, Circle K, Harnois | pompe, litres × prix/L à trois décimales |

Variantes transversales : NEQ, nom légal (« Exploité par 9234-5678 Québec
inc. »), courriel, site web, **petit fournisseur** (~3 % des indépendants :
aucune taxe, mention obligatoire), **client identifié** (~8 % en
restauration et quincaillerie : « Facturé à », adresse, numéros TPS/TVQ du
client), employé, mentions réglementaires, libellés bilingues FR/EN (~35 %
des enseignes qui s'y prêtent).

## Sortie

```
<sortie>/{train,valid,test}/images/000000.jpg
<sortie>/{train,valid,test}/metadata.jsonl
<sortie>/{train,valid,test}/boxes/000000.json
<sortie>/apercu.jpg
```

`metadata.jsonl` suit la convention `imagefolder` de Hugging Face :

```json
{"file_name": "images/000000.jpg", "ground_truth": "{\"gt_parse\": {...}}"}
```

Vérité terrain (`gt_parse`), exemple d'addition de restaurant :

```json
{"gt_parse": {
  "info": {"marchand": "RESTAURANT CHEZ LUCIEN", "adresse": "1234 rue Saint-Denis, Montréal, QC H2X 3K4",
           "telephone": "(514) 555-0142", "date": "2024-03-11", "heure": "18:32",
           "type_commerce": "restaurant", "numero_facture": "4521873", "type_document": "FACTURE",
           "tps_no": "123456789 RT0001", "tvq_no": "1234567890 TQ0001", "neq": "1167543210",
           "table": "12", "serveur": "MARIE", "couverts": "2",
           "numero_sev": "2024031118325512"},
  "menu": [{"nm": "Soupe du jour", "cnt": "1", "unitprice": "6.50", "price": "6.50", "cat": "entrees", "tax": "TX"},
           {"nm": "Poulet roti quart cuisse", "cnt": "2", "unitprice": "18.95", "price": "37.90", "cat": "plats", "tax": "TX"}],
  "sub_total": {"subtotal_price": "44.40", "tps": "2.22", "tvq": "4.43"},
  "total": {"total_price": "51.05", "menutype_cnt": "2", "paiement": "VISA",
            "pourboire": "9.00", "total_final": "60.05"}
}}
```

Clés **historiques, inchangées** : `info.{marchand, adresse, telephone, date,
heure}`, `menu[].{nm, cnt, unitprice, price, cat, tax, unit?, discountprice?}`,
`sub_total.{subtotal_price, tps, tvq}`, `total.{total_price, menutype_cnt,
paiement}`.

Clés **ajoutées** (présentes seulement si l'information est imprimée, et alors
annotée d'une boîte de mot portant l'étiquette homonyme) :

| Clé | Étiquette de boîte | Contenu |
| --- | --- | --- |
| `info.type_commerce` | — (non imprimé) | un des 11 types |
| `info.numero_facture` | `numero_facture` | numéro de transaction / facture |
| `info.type_document` | `type_document` | `FACTURE`, `ADDITION` ou `RECU` |
| `info.tps_no`, `info.tvq_no` | `tps_no`, `tvq_no` | numéros d'inscription du commerçant |
| `info.neq`, `info.nom_legal`, `info.courriel`, `info.site_web`, `info.permis_alcool` | homonymes | identification du commerce |
| `info.petit_fournisseur` = `"oui"` | `petit_fournisseur` | aucune taxe perçue ; `tps_no`/`tvq_no` absents |
| `info.numero_sev`, `info.mev`, `info.code_autorisation` | homonymes | système d'enregistrement des ventes |
| `info.table`, `info.serveur`, `info.couverts`, `info.commande`, `info.service`, `info.onglet` | homonymes | contexte de service |
| `info.employe` | `employe` | numéro d'employé |
| `info.client` = `{nom, adresse?, tps_no?, tvq_no?}` | `client_nom`, `client_adresse`, `client_tps_no`, `client_tvq_no` | client identifié (B2B) |
| `menu[].sku` | `sku` | code produit imprimé (CUP ou code SAQ) |
| `menu[].unit` = `"L"` | `unit` | carburant : `cnt` en litres à 3 décimales, `unitprice` à 3 décimales |
| `sub_total.frais_service`, `sub_total.frais_livraison` | `frais_service`, `frais_livraison` (+ `_label`) | frais taxables hors sous-total |
| `total.pourboire`, `total.total_final` | `pourboire`, `total_final` (+ `_label`) | présents ensemble ; le pourboire n'est pas taxé |
| `total.arrondi` | `arrondi` | arrondi comptant au 5 cents (si non nul) |

Invariants garantis (tests) :

- `sum(menu[].price) == subtotal_price` ;
- `total_price == subtotal_price + frais_service + frais_livraison + tps + tvq` ;
- `tps` et `tvq` se recalculent sur les lignes `TX` + frais (`0.00` pour un petit fournisseur) ;
- `total_final == total_price + pourboire` ;
- `paiement` est canonique (`INTERAC`, `VISA`, `MASTERCARD`, `COMPTANT`, `AMEX`, `DEBIT`).

Comme avant, **`nm` contient exactement la chaîne imprimée** (majuscules,
accents perdus, abréviations de caisse, troncature comprises) ; `info.date`
est toujours en ISO et les libellés imprimés varient (`12/03/2024`,
`DEBIT INTERAC`, `TPS/GST`...) : c'est au modèle de normaliser.

`boxes/000000.json` donne la boîte de chaque mot imprimé, transportée par la
même homographie que l'image :

```json
{"file_name": "images/000000.jpg", "largeur": 1100, "hauteur": 2217,
 "augmente": true, "qualite_jpeg": 60,
 "mots": [{"texte": "36.87", "etiquette": "price", "indice_ligne": 0,
           "quad": [x0, y0, x1, y1, x2, y2, x3, y3], "bbox": [xmin, ymin, xmax, ymax]}]}
```

Étiquettes : `marchand`, `adresse`, `telephone`, `tps_no`, `tvq_no`, `date`,
`heure`, `nm`, `cnt`, `unit`, `unitprice`, `price`, `tax`, `sku`,
`discount_label`, `discountprice`, `subtotal_label`, `subtotal_price`,
`tps_label`, `tps`, `tvq_label`, `tvq`, `frais_service(_label)`,
`frais_livraison(_label)`, `total_label`, `total_price`, `pourboire(_label)`,
`total_final(_label)`, `arrondi`, `menutype_cnt`, `paiement`,
`numero_facture`, `type_document`, `neq`, `nom_legal`, `courriel`,
`site_web`, `permis_alcool`, `petit_fournisseur`, `numero_sev`, `mev`,
`code_autorisation`, `table`, `serveur`, `couverts`, `commande`, `service`,
`onglet`, `employe`, `client_nom`, `client_adresse`, `client_tps_no`,
`client_tvq_no`, `qr` (texte = URL encodée, boîte carrée), `code_barres`
(texte = numéro de facture), `autre`. `indice_ligne` est l'index de
l'article dans `menu` (ou `null`).

## Règles fiscales (`generateur/fiscalite.py`)

- TPS 5 % et TVQ 9,975 % appliquées **en parallèle** sur le sous-total
  taxable ; la TVQ n'est jamais composée sur la TPS (règle depuis 2013).
- Aliments de base détaxés ; taxables : boissons gazeuses, friandises,
  grignotines, plats préparés ou servis, alcool, produits non alimentaires,
  quincaillerie, carburant, produits de santé en vente libre. Médicaments
  sur ordonnance détaxés. Chaque produit du catalogue porte son drapeau
  `taxable` (exceptions incluses : eau à l'unité taxable, caisse d'eau
  détaxée, jus pur détaxé, pâtisserie à l'unité taxable, beignes par 6 et
  plus détaxés...).
- Frais de service et de livraison : dans la base taxable et le total,
  hors sous-total des articles. Pourboire jamais taxé.
- Petit fournisseur : aucune taxe perçue, mention obligatoire.
- Boissons alcooliques : taxe spécifique incluse dans le prix, jamais en
  ligne distincte (mention occasionnelle).
- Arrondi commercial au cent (`ROUND_HALF_UP`).
- Paiement comptant : total (pourboire compris) arrondi au 5 cents, puis
  calcul de la monnaie.

## Architecture

```
generateur/
  produits/
    base.py        # catégories (26), Produit, fabriques _p / _variantes
    epicerie.py    # 12 rayons d'épicerie, dépanneur, pharmacie
    restauration.py# entrées, plats, desserts, boissons, alcool servi, comptoir, viennoiseries
    detail.py      # quincaillerie, vins, spiritueux, carburant
    pharmacie.py   # ordonnances (Rx), produits de santé
  catalogue.py     # types de commerce, 63 enseignes, rues, villes, paiements, libellés, mentions
  fiscalite.py     # TPS/TVQ, frais, exonération, pourboires, arrondis
  modeles.py       # LigneArticle, Commerce, Client, ContexteService, InfosSev, Recu, gt_parse
  contenu.py       # génération de la vérité terrain par type, à partir d'un random.Random
  rendu.py         # compositeurs par type (PIL), code QR segno, capture des boîtes
  augmentation.py  # homographie, plis, éclairage, fond, flou, bruit, redimensionnement
  export.py        # JPEG + metadata.jsonl + boxes + planche-contact
engendrer.py       # ligne de commande, multiprocessing, --types
verifier_boites.py # redessine les quadrilatères sur une image
tests/
```

### Rendu

Police à chasse fixe parmi celles trouvées sur la machine (Courier New,
Andale Mono, Menlo, DejaVu Sans Mono, Liberation Mono...), avec variation par
reçu : police, taille, largeur de papier, marge, densité d'encre et bandes
thermiques, teinte du papier, majuscules, perte des accents, abréviations de
caisse, troncature des noms longs, codes de taxe (`TX/DT`, `T/N`, `FP`...),
lignes au poids (`0.842 kg x 4.39/kg`) ou au litre (`38.412 L @ 1.459/L`),
lignes multiples (`3 @ 2.99`), quantité en préfixe (`2 Poulet rôti`), lignes
de rabais, en-têtes de rayon, codes produit au-dessus ou sous le nom,
libellés bilingues, code QR réel (segno, correction « M », URL de validation
MEV-WEB), code-barres décoratif.

Un `Compositeur` par famille : base (épicerie, dépanneur, pharmacie),
restaurant/bar, comptoir (café, restauration rapide), détail
(quincaillerie, dollar, SAQ) et station-service. Chaque bloc est sans effet
si le champ correspondant du reçu est absent : la **présence** d'une
information se décide dans `contenu.py`, le rendu n'en fait que la
typographie.

> La liste des polices dépend de la machine : la reproductibilité est
> garantie sur une machine donnée (ou entre machines aux polices identiques).
> Les reçus produits par une graine donnée diffèrent de ceux de la
> version 0.1 (nouveaux tirages).

### Augmentation

Ombrage de plis (aucune déformation par maillage), homographie unique
(perspective + rotation) appliquée à l'image **et** aux boîtes (QR compris),
fond texturé (bois, comptoir, carrelage, uni), ombre portée, éclairage inégal
et reflet, balance des couleurs, flou de mise au point, bruit de capteur,
JPEG de qualité variable. Le redimensionnement se fait d'après la **largeur**
cible.

## Tests

```bash
npm run tester-recus
```

- `tests/test_fiscalite.py` : TVQ jamais composée, panier détaxé ⇒ taxes
  nulles, frais dans la base taxable, exonération, suggestions et arrondi
  de pourboire, arrondi comptant au 5 cents, refus des `float`.
- `tests/test_catalogue.py` : ≥ 2 200 produits aux noms uniques, chaque
  catégorie garnie, chaque enseigne dotée d'assez de produits, épiceries
  sans catégories de restauration.
- `tests/test_segno.py` : QR importable, matrice stable et carrée.
- `tests/test_coherence.py` : sur 300 reçus rendus, tous les invariants
  comptables, chaque `nm` retrouvé mot à mot dans les boîtes, chaque clé
  optionnelle de `info` retrouvée dans une boîte homonyme, QR présent ssi
  URL, SKU et quantités capturés une seule fois, les 11 types présents,
  filtre `types`, déterminisme, transport des boîtes par l'homographie.

## Vérification visuelle des boîtes

```bash
npm run verifier-boites -- outils/jeu/train/images/000000.jpg
npm run verifier-boites -- outils/jeu/train --tous 8 --bbox
```

Produit une image avec les quadrilatères colorés par étiquette
(`*_boites.png`, ou le dossier `verification/` du split).
