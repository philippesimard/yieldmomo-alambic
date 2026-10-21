# @alambic/collecte — étape 3

**Interprète le texte lu en facture exploitable.** Entrée : un `Condensat` et l'`ImageChauffee`
qui l'a produit. Sortie : une `Recolte`, c'est-à-dire la `Facture` et ce que la Collecte pense de
la cohérence de ses montants.

```ts
const { facture, coherence } = await collecter(condensat, image, moteur)
```

C'est l'étape qui donne du sens : reconnaître qu'un « 8,91 » à droite d'un « TOTAL » est le
montant payé, qu'une ligne « TPS 5% » est une taxe, qu'une suite de caractères en haut du ticket
est le nom du marchand.

## Comment elle travaille

Quatre sous-étapes, dans l'ordre :

1. **Découpage en mots** (`mots.ts`). PaddleOCR rend des lignes ; le modèle attend un mot par
   boîte. Chaque bloc est scindé sur les espaces, son cadre réparti au prorata des caractères.
2. **Étiquetage** (`moteur.ts`). Le moteur injecté pose sur chaque mot une étiquette CORD
   (`MENU.NM`, `TOTAL.TOTAL_PRICE`…) et un score. C'est la seule sous-étape qui sorte du
   processus — et le seul endroit où un modèle intervient.
3. **Reconstruction** (`reconstruction.ts`). Les mots étiquetés deviennent des entités (BIO),
   les entités deviennent sousTotal, taxes, total et articles. Pur et déterministe.
4. **Reconnaisseurs** (`reconnaisseurs/`). Ce que CORD ne couvre pas se lit par règles :
   marchand (premières lignes nommables), date (formats fr/en → ISO), devise (codes et
   symboles), carte (lexique VISA/MASTERCARD/AMEX/INTERAC → `TYPE_CARTE` normalisé), catégorie
   (mots-clés d'enseignes et forme du reçu → `CATEGORIE` / `SOUS_CATEGORIES`). Purs et
   déterministes aussi.

La *reconstruction* et les *reconnaisseurs* restent des fonctions pures : mêmes entrées, mêmes
résultats, vérifiables avec un condensat écrit à la main. Seul l'étiquetage est asynchrone, et
il est **injecté** — exactement le patron `MoteurOcr` de la Condensation.

## Trois moteurs

| Moteur | Ce qu'il fait |
|---|---|
| `factice` | Étiquette le montant de la dernière ligne marquée « total », rien d'autre. Aucune dépendance ; le mode dev traverse le même chemin de reconstruction que le vrai moteur. |
| `lilt` | Sidecar Python (port 3103) : LiLT (Language-Independent Layout Transformer) sur XLM-RoBERTa en token classification, checkpoint `doc2txt/tst_lilt_cord_xlm_ft`, zero-shot. Texte + géométrie, sans les pixels. |
| `onnx` | Le même modèle exporté par `npm run exporter-modele`, exécuté par `onnxruntime-node` **dans l'ouvrier** ([`src/onnx/`](src/onnx)) : ni sidecar, ni Python. `MODELE_COLLECTE` pointe le dossier exporté. |

Le moteur `onnx` découpe chaque mot avec `@huggingface/tokenizers`, le portage en JavaScript des
tokenizers de Hugging Face : sur les 8 997 mots distincts lus au banc, le découpage est identique
à celui de Python, normalisation SentencePiece comprise. Les fenêtres (512 jetons, 128 repris,
premier jeton de chaque mot) reproduisent `return_overflowing_tokens` de transformers
([`fenetres.ts`](src/onnx/fenetres.ts)). Sur les 24 391 mots du banc, 99,88 % reçoivent
l'étiquette du sidecar PyTorch, en 0,13 s par reçu au lieu de 0,7 s.

Le sidecar est volontairement bête : il reçoit `{ mots: [{texte, boite 0–1000}] }` et rend
une étiquette et un score par mot. L'image ne transite pas : LiLT ne lit que le texte et la
géométrie, et l'`ImageChauffee` ne sert à la Collecte qu'à normaliser les boîtes. Tout le
reste — découpage, normalisation, reconstruction, confiances — vit côté node. Changer de
checkpoint ne touche que `MODELE_COLLECTE` et la table `ETIQUETTE` — c'est ainsi que le modele
maison de `outils/entrainement` est entre en service.

## Installer le sidecar

```bash
cd packages/collecte/sidecar && uv venv --python 3.11 && uv pip install -r requirements.txt
```

Puis `MOTEUR_COLLECTE=lilt` dans le `.env`. Le premier lancement télécharge les poids
dans le cache Hugging Face ; en production, l'image Docker les embarque au build (`--preparer`)
et tourne hors ligne (`HF_HUB_OFFLINE=1`).

Torch s'installe en roue **CPU** (l'index pytorch est épinglé dans `requirements.txt`) : sans
lui, pip tirerait ~2,5 Go de bibliothèques CUDA inutiles.

## Étiquettes CORD → Facture

| Étiquette | Champ |
|---|---|
| `MENU.NM` / `MENU.CNT` / `MENU.UNITPRICE` / `MENU.PRICE` | `articles[]` (libellé, quantité, prix unitaire, montant) |
| `SUB_TOTAL.SUBTOTAL_PRICE` | `sousTotal` |
| `SUB_TOTAL.TAX_PRICE` | `taxes[]` (nom et taux lus sur la même ligne) |
| `TOTAL.TOTAL_PRICE` | `total` |
| `TOTAL.CREDITCARDPRICE` / `TOTAL.CASHPRICE` | dernier repli du `total`, confiance réduite |

Les autres étiquettes du checkpoint (remises, services, `VOID_MENU.*`…) tombent sur `O` et sont
ignorées pour l'instant. Le checkpoint en service les écrit en minuscules et **sans préfixe
B-/I-** : la table les compare sans tenir compte de la casse, et deux entités voisines de même
étiquette ne se séparent que par un changement d'étiquette ou une ligne de reconstruction. Un
checkpoint maison en BIO retrouvera la séparation fine sans rien changer d'autre. Marchand, date, devise et carte ne sont **pas** dans CORD : ce sont
les reconnaisseurs qui les remplissent, jusqu'au fine-tuning qui les apprendra au modèle.

Le zero-shot étant bruyant, la reconstruction ne croit pas le modèle aveuglément :

- **Le total, champ le plus important, a trois filets** : l'étiquette du modèle, sinon la
  dernière ligne à marqueur (« TOTAL 26,43 », puis « MONTANT $17.00 » des reçus de terminal),
  sinon un montant payé par carte ou comptant. Quand l'entité porte le mot « TOTAL » mais pas
  le chiffre, le montant se lit sur sa ligne. Ces filets ne choisissent plus seuls : ils
  ordonnent les candidats que le solveur départage (voir plus bas).
- **Les taxes se lisent à deux sources** : les entités étiquetées, plus les lignes au lexique
  (TPS, TVQ, GST…) que le modèle a manquées.
- **Un montant exige sa partie décimale** (`montantDe`) : c'est ce qui écarte téléphones,
  heures et numéros de carte des montants. Les milliers peuvent être séparés par une espace,
  une virgule ou un point (« 1 234,56 », « 1,234.56 », « 1.234,56 ») : le dernier séparateur
  porte toujours les cents.
- **Les étiquettes sous un score plancher sont ramenées à `O`**, et les lignes de règlement
  (total, paiement, carte) ne fondent jamais un article.

Chaque lecture par règle porte une confiance réduite d'un facteur nommé : le consommateur voit
qu'elle est déduite, pas lue.

Les confiances croisent les deux sources : score softmax du modèle × confiance OCR du maillon
faible. Une étiquette sûre posée sur un texte mal lu reste douteuse.

## Le solveur de cohérence

Un reçu québécois est un petit système d'équations : sous-total + taxes = total, TPS = 5 % et
TVQ = 9,975 % de la même assiette. `coherence.ts` s'en sert pour choisir, parmi les montants
**lus**, la combinaison qui se tient. Il ne fabrique jamais un montant.

- **Les candidats** : chaque champ propose les siens, du plus sûr au moins sûr (les filets
  ci-dessus). À preuves égales, c'est l'ordre d'avant le solveur qui gagne.
- **Les preuves** : le bilan qui se ferme à ±0,02 $ en vaut deux ; le rapport TVQ/TPS de 1,995
  et une taxe égale à son taux × le sous-total (tout est taxable) en valent une chacun.
- **L'impossible** : une taxe imprimée sous le total (un pourboire ou un paiement que le modèle
  étiquette taxe), égale ou supérieure au total (le montant payé), ou supérieure à 15 % du
  sous-total, est écartée. Le sous-total ne partage jamais la ligne du total. Sur 200 reçus
  synthétiques, la règle des 15 % retire 18 fausses taxes pour 2 vraies perdues quand le
  sous-total lu est faux.
- **Ce qu'il ne fait pas** : retirer une vraie taxe pour fermer le bilan. Certains reçus
  impriment un « sous-total » qui répète le total, taxes comprises ; les retirer fermerait le
  bilan à tort.

La `coherence` rendue vaut `coherente` (le bilan se ferme), `incoherente` (il se vérifie et ne
se ferme pas : un montant est faux, ou des frais ou un pourboire n'ont pas été lus) ou
`indeterminee` (il manque le total ou le sous-total). Un bilan qui se ferme divise par deux le
doute de chaque montant qu'il engage ; un bilan qui ne se ferme pas baisse leur confiance de
20 %. La cohérence ne sort pas dans la facture : elle part dans les mesures journalisées, où sa
part dit si la lecture se dégrade, sans aucune vérité terrain.

## La catégorie

La nature de la dépense se lit sur **l'enseigne**, et sur **la forme du reçu** quand la loi la
fixe. `mots-cles-categories.ts` porte près
de 2 000 marchands et termes. Elle est partie du catalogue de YieldMomo, et les clés de
catégorie sont les siennes : ce sont ses `CategorieTransaction`. C'est une **copie** et non un
import, car les deux dépôts sont indépendants, et elle a depuis divergé : plus d'un millier de
ses mots-clés sont propres aux reçus. On la rafraîchit en reportant les ajouts de la source,
jamais en l'écrasant.

L'enseigne est la ligne retenue par le reconnaisseur de marchand. Il écarte trois formes de
ligne faites de lettres qui ne nomment jamais le commerce : le libellé d'un champ (« Servi par:
Amir »), une date (« Sam., 15 Avril 2026 ») et une adresse (« 1234 boul. St-Hubert »). Leurs
mots croisent pourtant des enseignes, et c'est leur forme qui les écarte, pas le retrait
d'Amir, d'Avril ou de St-Hubert de la table.

Deux choses la distinguent de sa source, parce que là-bas un humain tranche l'ambiguïté en
cliquant et qu'ici personne ne tranche :

- **Les catégories de revenu sont absentes**, du contrat comme de la table. Une photo de reçu est
  une dépense, et les garder n'ouvrait que des faux positifs — « VISA » imprimé par un terminal
  serait devenu un remboursement de dette.
- **La comparaison se fait par mots entiers**, sur des fenêtres de mots, la plus longue d'abord.
  Le `includes` bidirectionnel de la source est fait pour des requêtes tapées courtes ; appliqué
  à une enseigne, il ferait de « Vinaigrerie » de l'alcool et de « La Belle Province » un
  fournisseur internet. La fenêtre la plus longue gagne, donc « costco essence » l'emporte sur
  « costco ».

`enseigne.ts` tolère quatre défauts de lecture, chacun avec son garde-fou :

| Défaut | Exemple | Garde-fou |
|---|---|---|
| Possessif anglais | « HARVEY'S » → harveys | Seul « 's » se colle ; l'élision française sépare (« L'ÉPICIER ») |
| Esperluette | « H & M », « A&W » | Cherchée sur le texte, jamais comme deux lettres : « A.W. PLOMBERIE » reste une plomberie |
| Formule d'accueil collée | « BIENVENUE CHEZIGA » → iga | Le reste doit être une clé d'au moins trois lettres |
| Nom coupé en deux | « 3 UNI QLO » → uniqlo | Clé d'un seul mot d'au moins six lettres, morceaux d'au moins trois lettres qui ne sont pas des clés : « LA FLEUR » ne devient pas Lafleur |

Les clés passent par le même découpage que le reçu, si bien qu'une clé à trait d'union
(« couche-tard ») est atteignable. Cela a réveillé des toponymes (« saint-henri »,
« saint-sauveur ») qui auraient classé une succursale par son quartier : ils ont été retirés.

Quand le nom ne dit rien, un **site web** imprimé sur le reçu (« WWW.UNIQLO.COM ») le
remplace. On ne retient qu'une adresse complète, jamais un courriel (un commerce écrit volontiers
depuis une adresse videotron.ca), ni une plateforme de paiement, de livraison ou un réseau
social.

Les collisions volontaires de la source sont conservées, et c'est le reconnaisseur qui en décide :
une seule candidate donne catégorie et sous-catégorie ; plusieurs candidates d'un même groupe ne
donnent que le groupe ; plusieurs groupes ne donnent rien.

### L'addition de restaurant

Une addition de restaurant québécoise sort d'un module d'enregistrement des ventes (MEV) que
Revenu Québec impose à la restauration. Il imprime des mentions légales (« FACTURE ORIGINALE »,
« FACTURE RÉVISÉE », « Remplace 1 facture(s) ») et un en-tête de service à table (« TABLE # 13 »,
« TBL 29-4 », « ADDITION # 563536-1 »). `structure.ts` exige **deux preuves parmi trois** — une
mention légale, une ligne de table, une ligne d'addition —, ce qui revient à toujours tenir un
en-tête de service à table :

- une mention légale seule ne suffit pas : le taxi facture sous le même régime, et une politique
  de retour peut finir sur « …la facture originale » ;
- la ligne de table ne porte que son numéro, éventuellement suivi du serveur ou des couverts :
  « TABLE 6 PLACES » est un meuble ;
- une ligne qui porte un montant n'est jamais un en-tête.

L'addition met le restaurant en lice à côté de ce que dit l'enseigne, avec les mêmes règles de
décision. Deux enseignes lui **cèdent** : un hôtel (voyages) ou un bar (alcool) qui imprime une
addition avec table a servi à manger ou à boire sur place, ce qui est la dépense d'un restaurant.
Toute autre enseigne reste en lice : un café donne le groupe seul, une salle de quilles ne donne
rien.

### Le ticket d'épicerie

Quand ni l'enseigne ni une addition ne disent rien, un ticket d'épicerie se reconnaît à ses
**rayons** (« 21-EPICERIE », « FRUITS/LEGUMES ») et à ses **pesées** (« 0.760 kg @ $11.00 /
kg »). Il faut un rayon et une seconde preuve, rayon ou pesée : une pesée seule se fait aussi
chez le fromager, et un rayon seul peut être un libellé d'article. C'est un repli et jamais un
arbitre : une pharmacie qui imprime des rayons alimentaires reste une pharmacie, puisque c'est la
catégorie du commerce qu'on rend. Il rattrape surtout les épiceries dont le logo est illisible.

Les libellés d'articles ont été essayés comme seconde source, puis retirés : ils nomment un
produit et non la nature du commerce. Sur le corpus, ils ne classaient que deux reçus de plus, et
les deux à tort — « BIERE THE DU LABRADOR » faisait de l'épicerie de l'alcool, « PIZZA GARNIE
BACON » en faisait un restaurant.

## Mesurer

```bash
npm run banc:collecte -- corpus
```

La catégorie se règle sans relancer le pipeline : `npm run rejeu:categorie -- corpus` rejoue
marchand et catégorie sur les condensats sauvegardés, en moins d'une seconde, et passe les pièges
de `outils/pieges-categorie.json`. Ce sont des reçus écrits à la main, chacun avec la réponse
qu'il doit donner. Le rejeu échoue sur un piège manqué ou sur une catégorie fausse du corpus.
Le corpus n'étant pas versionné, un clone neuf passe les pièges seuls, et ils suffisent à garder
les règles.

Le banc passe le pipeline complet, affiche champs reconnus et durées, et écrit pour chaque
photo `corpus/sorties/<nom>--collecte.json` : mots, boîtes 0–1000, étiquettes BIO prédites,
facture. C'est le brouillon du dataset de fine-tuning — corriger `etiquette` à la main, c'est
déjà annoter.

## Licence du modèle

LiLT est publié sous **MIT** (`SCUT-DLVCLab`), sa base XLM-RoBERTa aussi, et le jeu CORD sous
**CC BY 4.0** : la chaîne est utilisable commercialement. LayoutLMv3, qui tenait ce rôle avant,
est sous CC BY-NC-SA 4.0 et a été retiré pour cette raison.

Le checkpoint par défaut, `doc2txt/tst_lilt_cord_xlm_ft`, est un fine-tuning communautaire
(MIT, F1 0,957 sur CORD selon sa fiche), sans documentation et nommé « test ». Il suffit au
zero-shot ; **le fine-tuning maison sur `SCUT-DLVCLab/lilt-infoxlm-base` a depuis livré**
(F1 0,997 à l'entité sur le jeu synthétique) — voir
[outils/entrainement](../../outils/entrainement/README.md).
