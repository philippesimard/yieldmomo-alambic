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
   symboles), carte (lexique VISA/MASTERCARD/AMEX/INTERAC → `TYPE_CARTE` normalisé). Purs et
   déterministes aussi.

La *reconstruction* et les *reconnaisseurs* restent des fonctions pures : mêmes entrées, mêmes
résultats, vérifiables avec un condensat écrit à la main. Seul l'étiquetage est asynchrone, et
il est **injecté** — exactement le patron `MoteurOcr` de la Condensation.

## Deux moteurs

| Moteur | Ce qu'il fait |
|---|---|
| `factice` | Étiquette le montant de la dernière ligne marquée « total », rien d'autre. Aucune dépendance ; le mode dev traverse le même chemin de reconstruction que le vrai moteur. |
| `layoutlmv3` | Sidecar Python (port 3103) : LayoutLMv3 en token classification, checkpoint `nielsr/layoutlmv3-finetuned-cord`, zero-shot. Texte + géométrie + pixels. |

Le sidecar est volontairement bête : il reçoit `{ image, mots: [{texte, boite 0–1000}] }` et
rend une étiquette et un score par mot. Tout le reste — découpage, normalisation des boîtes,
reconstruction, confiances — vit côté node. Changer de checkpoint (le fine-tuning maison
viendra) ne touche que `MODELE_COLLECTE` et la table `ETIQUETTE`.

## Installer le sidecar

```bash
cd packages/collecte/sidecar && uv venv --python 3.11 && uv pip install -r requirements.txt
```

Puis `MOTEUR_COLLECTE=layoutlmv3` dans le `.env`. Le premier lancement télécharge les poids
dans le cache Hugging Face ; en production, l'image Docker les embarque au build (`--preparer`)
et tourne hors ligne (`HF_HUB_OFFLINE=1`).

Torch s'installe en roue **CPU** (l'index pytorch est épinglé dans `requirements.txt`) : sans
lui, pip tirerait ~2,5 Go de bibliothèques CUDA inutiles.

La lignée **transformers 4.x est requise** : la v5 remplace le tokenizer LayoutLMv3 par un
RoBERTa nu qui ignore les boîtes, ce qui rend la branche layout du modèle aveugle.

## Étiquettes CORD → Facture

| Étiquette | Champ |
|---|---|
| `MENU.NM` / `MENU.CNT` / `MENU.UNITPRICE` / `MENU.PRICE` | `articles[]` (libellé, quantité, prix unitaire, montant) |
| `SUB_TOTAL.SUBTOTAL_PRICE` | `sousTotal` |
| `SUB_TOTAL.TAX_PRICE` | `taxes[]` (nom et taux lus sur la même ligne) |
| `TOTAL.TOTAL_PRICE` | `total` |
| `TOTAL.CREDITCARDPRICE` / `TOTAL.CASHPRICE` | dernier repli du `total`, confiance réduite |

Les autres étiquettes du checkpoint (remises, services, `VOID_MENU.*`…) tombent sur `O` et sont
ignorées pour l'instant. Marchand, date, devise et carte ne sont **pas** dans CORD : ce sont
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

## Mesurer

```bash
npm run banc:collecte -- corpus
```

Le banc passe le pipeline complet, affiche champs reconnus et durées, et écrit pour chaque
photo `corpus/sorties/<nom>--collecte.json` : mots, boîtes 0–1000, étiquettes BIO prédites,
facture. C'est le brouillon du dataset de fine-tuning — corriger `etiquette` à la main, c'est
déjà annoter.

## Licence du modèle

⚠️ La base `microsoft/layoutlmv3-base` est publiée sous **CC BY-NC-SA 4.0 (non commerciale)**,
et le checkpoint CORD en hérite. Accepté pour le prototypage ; **à arbitrer avant toute mise en
production commerciale**. L'architecture rend un remplacement (LiLT sous MIT, ou un modèle
maison) quasi gratuit : seuls le sidecar et la table d'étiquettes bougeraient.
