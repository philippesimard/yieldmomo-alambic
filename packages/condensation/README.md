# @alambic/condensation — étape 2

**Extrait tout le texte de l'image.** Entrée : une `ImageChauffee`. Sortie : un `Condensat`.

```ts
const condensat = await condenser(image, moteur)
```

Cette étape ne comprend rien à une facture : elle ne sait pas ce qu'est un total ni un marchand.
Elle lit, et rend ce qu'elle a lu — avec la **position** de chaque fragment et la **confiance**
du moteur.

## Le moteur est injecté

```ts
type MoteurOcr = {
  readonly nom: string
  lire(image: ImageChauffee): Promise<BlocTexte[]>
}
```

Un moteur ne fait qu'une chose : rendre les fragments qu'il voit — **y compris ceux qu'il n'a
pas su lire**, qui sortent avec un texte vide. C'est la seule façon de distinguer un moteur qui
ne voit plus rien d'un moteur qui ne lit plus rien ; `condenser` les compte et les retire, ils
n'atteignent jamais le condensat. L'ordre de lecture, la composition du texte et la confiance
globale sont calculés par `condenser`, identiquement pour tous les moteurs. Deux conséquences voulues : le contrat reste assez petit pour qu'un moteur
local comme un service distant s'y plie sans effort, et deux moteurs deviennent **comparables**
parce qu'ils sont traités à l'identique.

Le moteur n'est jamais choisi ici : il arrive en paramètre. Le câblage se fait dans
`packages/api/src/distiller.ts`, en une ligne.

## Trois moteurs

### `creerMoteurOnnx` — les mêmes poids, sans Python

Les modèles PP-OCRv5 du sidecar Paddle, convertis en ONNX sans réentraînement
([`modeles/`](modeles/README.md), 13 Mo versionnés dans le dépôt), exécutés par
`onnxruntime-node` **dans l'ouvrier qui lit** : ni sidecar, ni verrou, ni aller-retour HTTP.
Chaque ouvrier charge ses sessions à sa première lecture ; `FILS_OCR` est le budget de threads de
tous les ouvriers, partagé entre eux.

Tout ce qui entoure le réseau est réécrit en TypeScript, à l'identique de PaddleX, dans
[`src/onnx/`](src/onnx) :

| Fichier | Rôle |
|---|---|
| `pixels.ts` | Redimensionnement bilinéaire et rognure bicubique d'OpenCV, quart de tour |
| `detection.ts` | Côté long borné à 2016 px et multiple de 32, normalisation, post-traitement DB |
| `rectangle.ts` | Rectangle d'aire minimale (enveloppe convexe), coins dans l'ordre de Paddle |
| `reconnaissance.ts` | Lignes à 48 px de haut, lots de 6 triés par largeur, décodage CTC |
| `moteur.ts` | Les sessions, la seconde lecture des lignes sous 0,90, l'assemblage |

Trois détails décident de la parité, mesurés sur le corpus :

- **Le rectangle orienté.** Noter une région sur son rectangle droit fait tomber sous le seuil
  les lignes un peu penchées (un titre passe de 0,99 à 0,52) : on la note, et on la rogne, sur le
  rectangle d'aire minimale, comme Paddle.
- **Les arrondis de Python.** `round()` arrondit les demis au pair : les dimensions du réseau
  aussi.
- **La seconde lecture.** Reprise du sidecar à l'identique : c'est elle qui corrige 419,10 en
  49,10.

Sur le corpus, la lecture rejoint celle de Paddle à 95 % des mots, avec autant de boîtes ; les
écarts restants vont dans les deux sens (une TVQ lue que Paddle manquait, un premier chiffre
perdu ailleurs). Elle prend environ 1 s par photo sur 4 threads du M2, contre 9 s pour Paddle.

### `moteurFactice`

Il ne regarde pas l'image et rend un reçu plausible sur deux colonnes, calé sur les dimensions
reçues. C'est le défaut en développement : le pipeline reste vérifiable de bout en bout sans
aucune dépendance. **À remplacer, pas à compléter** : le rendre plus malin en ferait un faux
point de comparaison.

### `creerMoteurPaddle` — le vrai moteur

PaddleOCR (PP-OCRv5, modèle latin : français **et** anglais) tourne dans un **sidecar Python**
([`sidecar/serveur.py`](sidecar/serveur.py)), un processus enfant lancé et surveillé par l'API.
Le modèle est chargé une seule fois et partagé par tous les ouvriers, qui l'appellent en HTTP
sur `127.0.0.1` : `POST /lire`, un PNG entre, des blocs sortent. Le client
([`src/paddle.ts`](src/paddle.ts)) valide la réponse, normalise la confiance dans [0, 1] et
convertit toute panne en `ErreurAlambic` — `moteur_indisponible`/503 si le sidecar ne répond
pas, `delai_depasse`/504 s'il est trop lent.

Installer le sidecar (une fois, avec [uv](https://docs.astral.sh/uv/)) :

```bash
cd packages/condensation/sidecar && uv venv --python 3.11 && uv pip install -r requirements.txt
```

Puis `MOTEUR_OCR=paddleocr` dans le `.env` — l'API lance le sidecar elle-même. Le premier
lancement télécharge les modèles dans `~/.paddlex` ; en production ils sont embarqués dans
l'image Docker au moment du build, rien ne se télécharge à l'exécution.

Le choix du modèle de détection (`mobile` rapide, `server` précis mais lent sur CPU) passe par
`DETECTION_OCR` et s'arbitre sur mesures, au banc :

```bash
npm run banc:condensation -- corpus
```

## La géométrie compte

Le `Condensat` porte `blocs` et pas seulement `texte`. Sur un reçu, le libellé d'un article et
son montant sont sur la même ligne mais dans deux colonnes : sans la géométrie, la Collecte ne
peut plus les rapprocher, et un reçu à deux articles devient illisible.

## Ce que l'étape dit de sa propre lecture

`Condensat.lecture` porte trois nombres, et un seul d'entre eux tranche.

| champ | ce qu'il compte |
|---|---|
| `plancher` | La confiance sous laquelle se trouve un dixième des fragments. **Sous 0,75, la sous-étape se déclare dégradée.** |
| `muets` | Boîtes détectées dont la reconnaissance n'a rien tiré. Mesuré, pas jugé. |
| `bordure` | Fragments dont le cadre touche un bord latéral — la marque d'un document rogné. Mesuré, pas jugé. |

**Le plancher plutôt que la moyenne.** Pondérée par la longueur du texte, la moyenne donne 0,89
à 0,99 à *tout* le corpus — y compris au reçu dont le total a été lu `419,10` au lieu de `49,10`
(0,92). Elle résume ce qui a été lu ; elle ne dit rien de ce qui a dérapé. Le plancher, lui,
sépare : **0,39 / 0,47 / 0,65** pour les trois reçus dont l'OCR s'est trompé, **0,87 et plus**
pour les vingt-trois autres. Le seuil se pose dans l'écart.

`muets` et `bordure` sortent sans verdict, faute d'un pouvoir séparateur mesuré : deux reçus
sans défaut portent proportionnellement plus de muets que le reçu fautif, et un reçu cadré au
plus juste touche le bord aussi bien qu'un reçu amputé. Les régler au jugé serait exactement ce
que [`outils/mesure.ts`](../../outils/mesure.ts) met en garde — bouger un seuil en croyant
l'avoir amélioré. Ils sont là pour être calibrés sur plus de photos.

Les trois partent dans `Mesures`, donc dans les logs de chaque distillation : le hublot ne
tourne qu'en développement, et une lecture douteuse qui ne se verrait que là ne se verrait
jamais en production.

## Erreurs

Aucun fragment **lisible** lève `ErreurAlambic(aucun_texte, 422)` — des boîtes détectées mais
muettes ne sauvent pas la lecture, puisque rien n'en sort. C'est un échec franc et non une
facture vide : le consommateur doit pouvoir distinguer « rien de lisible, refais la photo » de
« lu, mais aucun total reconnu ».
