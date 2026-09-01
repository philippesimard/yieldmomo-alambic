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

Un moteur ne fait qu'une chose : rendre les fragments qu'il voit. L'ordre de lecture, la
composition du texte et la confiance globale sont calculés par `condenser`, identiquement pour
tous les moteurs. Deux conséquences voulues : le contrat reste assez petit pour qu'un moteur
local comme un service distant s'y plie sans effort, et deux moteurs deviennent **comparables**
parce qu'ils sont traités à l'identique.

Le moteur n'est jamais choisi ici : il arrive en paramètre. Le câblage se fait dans
`packages/api/src/distiller.ts`, en une ligne.

## Deux moteurs

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

## Erreurs

Aucun fragment lu lève `ErreurAlambic(aucun_texte, 422)`. C'est un échec franc et non une
facture vide : le consommateur doit pouvoir distinguer « rien de lisible, refais la photo » de
« lu, mais aucun total reconnu ».
