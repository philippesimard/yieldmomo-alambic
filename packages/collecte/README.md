# @alambic/collecte — étape 3

**Interprète le texte lu en facture exploitable.** Entrée : un `Condensat` et l'`ImageChauffee`
qui l'a produit. Sortie : une `Facture`.

```ts
const facture = await collecter(condensat, image, moteur)
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
   (mots-clés d'enseignes → `CATEGORIE` / `SOUS_CATEGORIES`). Purs et déterministes aussi.

La *reconstruction* et les *reconnaisseurs* restent des fonctions pures : mêmes entrées, mêmes
résultats, vérifiables avec un condensat écrit à la main. Seul l'étiquetage est asynchrone, et
il est **injecté** — exactement le patron `MoteurOcr` de la Condensation.

## Deux moteurs

| Moteur | Ce qu'il fait |
|---|---|
| `factice` | Étiquette le montant de la dernière ligne marquée « total », rien d'autre. Aucune dépendance ; le mode dev traverse le même chemin de reconstruction que le vrai moteur. |
| `lilt` | Sidecar Python (port 3103) : LiLT (Language-Independent Layout Transformer) sur XLM-RoBERTa en token classification, checkpoint `doc2txt/tst_lilt_cord_xlm_ft`, zero-shot. Texte + géométrie, sans les pixels. |

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
  le chiffre, le montant se lit sur sa ligne.
- **Les taxes se lisent à deux sources** : les entités étiquetées, plus les lignes au lexique
  (TPS, TVQ, GST…) que le modèle a manquées.
- **Un montant exige sa partie décimale** (`montantDe`) : c'est ce qui écarte téléphones,
  heures et numéros de carte des montants.
- **Les étiquettes sous un score plancher sont ramenées à `O`**, et les lignes de règlement
  (total, paiement, carte) ne fondent jamais un article.

Chaque lecture par règle porte une confiance réduite d'un facteur nommé : le consommateur voit
qu'elle est déduite, pas lue.

Les confiances croisent les deux sources : score softmax du modèle × confiance OCR du maillon
faible. Une étiquette sûre posée sur un texte mal lu reste douteuse.

## La catégorie

La nature de la dépense se lit sur **l'enseigne seule**. `mots-cles-categories.ts` porte 778
marchands et termes, repris du catalogue de YieldMomo — les clés sont les siennes, ce sont ses
`CategorieTransaction`. C'est une **copie**, pas un import : les deux dépôts sont indépendants,
et la table dérivera de sa source si personne ne la rafraîchit.

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

Les collisions volontaires de la source sont conservées, et c'est le reconnaisseur qui en décide :
une seule candidate donne catégorie et sous-catégorie ; plusieurs candidates d'un même groupe ne
donnent que le groupe ; plusieurs groupes ne donnent rien.

Les libellés d'articles ont été essayés comme seconde source, puis retirés : ils nomment un
produit et non la nature du commerce. Sur le corpus, ils ne classaient que deux reçus de plus, et
les deux à tort — « BIERE THE DU LABRADOR » faisait de l'épicerie de l'alcool, « PIZZA GARNIE
BACON » en faisait un restaurant.

## Mesurer

```bash
npm run banc:collecte -- corpus
```

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
