# Fine-tuning de la Collecte

Le sidecar d'étiquetage sert un modèle LiLT. Par défaut c'est un checkpoint public entraîné sur
CORD — des reçus anglais et indonésiens — qui travaille donc **en zéro-shot** sur un reçu
québécois : il devine les prix à peu près et ne connaît ni TPS, ni TVQ, ni INTERAC. Les
contournements de `src/reconstruction.ts` sont là pour ça.

Ce dossier entraîne le remplaçant : un LiLT qui a vu le domaine.

Rien ici ne tourne en production. Le service ne fait que charger le dossier produit
(`MODELE_COLLECTE`) ; l'entraînement est un outil de poste.

## Le jeu de données

Celui de `../recus`, dans son format natif :

```
<jeu>/
  train/boxes/*.json      mots, boîtes en pixels, étiquette par mot
  valid/boxes/*.json
  test/boxes/*.json
```

Les images ne servent pas : **LiLT ne lit que le texte et la géométrie**, jamais les pixels.

Les étiquettes du générateur (`nm`, `price`, `marchand`, `tps`, `tvq`, …) deviennent des
étiquettes BIO : `B-` ouvre une entité, `I-` la continue. Le changement de ligne ouvre une
nouvelle entité, sans quoi deux articles voisins fusionneraient leurs libellés.

## Entraîner

```bash
npm run entrainer-modele
```

Sans argument, il lit `outils/jeu` — la sortie de `npm run generer-recus` — et écrit dans
`modeles/lilt-alambic`. Il refuse d'écraser un checkpoint existant sans `--ecraser` : le défaut
est celui que le sidecar charge.

Le venv est celui des outils (`outils/.venv`), préparé par `npm install` ; `torch` et
`transformers` y sont aux versions du sidecar de la Collecte.

| Option | Défaut | Rôle |
| --- | --- | --- |
| `--jeu` | — | dossier du jeu de données (requis) |
| `--base` | `SCUT-DLVCLab/lilt-infoxlm-base` | modèle de départ |
| `--sortie` | `modeles/lilt-alambic` | où écrire le checkpoint |
| `--epoques` | 5 | |
| `--lot` / `--accumulation` | 1 / 16 | lot effectif de 16 fenêtres |
| `--taux` | 5e-5 | |
| `--limite` | 0 | n reçus par split — pour un essai rapide |
| `--degeler-embeddings` | — | entraîne aussi les 192 M paramètres d'embeddings |
| `--sans-checkpointing` | — | garde les activations (plus rapide, beaucoup plus lourd) |
| `--appareil` | `auto` | `cuda`, `mps` ou `cpu` |

### Tenir dans 8 Go

Les valeurs par défaut visent une machine à mémoire unifiée de 8 Go, où le seul vrai risque
n'est pas la lenteur mais la **pagination** : dès que le modèle dépasse la mémoire disponible,
le débit s'effondre d'un facteur dix et continue de baisser.

Trois réglages, dans l'ordre où ils comptent :

- **Gradient checkpointing**, actif par défaut. LiLT fait tourner deux flux en parallèle
  (texte et géométrie) ; à 512 tokens, les seules matrices d'attention gardées pour la
  rétropropagation pèsent plus d'un Go. On ne les garde pas, on les recalcule : **6,4 Go →
  2,1 Go**, pour environ 30 % de temps en plus. Mesuré sur M2 : sans lui le débit tombe à
  0,10 fen/s et continue de chuter, avec lui il tient à 2,5 fen/s.
- **Embeddings de mots gelés**, par défaut. Ils pèsent 192 M des 284 M paramètres, et les
  geler divise par quatre la mémoire de l'optimiseur. Le vocabulaire est fixe ; ce sont la
  géométrie et la tête de classification qui apprennent.
- **Bourrage par paliers de 64 tokens.** Sur MPS, chaque forme de tenseur inédite fait
  recompiler le graphe ; sans les paliers, un lot par longueur exacte en produirait des
  centaines, toutes payées au premier passage.

`--lot 2` ne tient pas sur 8 Go en même temps qu'autre chose ; l'accumulation donne le même
lot effectif sans la mémoire.

Compter environ **deux heures pour 5 époques** sur les 3200 reçus d'entraînement, sur un M2.

Après chaque époque, le script mesure sur `valid` et ne conserve que le meilleur passage : les
époques suivantes peuvent surapprendre, et c'est ce dossier que le sidecar chargera.

## Mesurer

```bash
npm run evaluer-modele -- --split test
```

La mesure qui compte est le **F1 à l'entité**, pas l'exactitude au mot : la Collecte ne lit pas
des mots isolés, elle recompose « BIERE MOLSON CAN 12 X 341 » en un libellé d'article. Un mot
juste au milieu d'une entité mal découpée ne sert à rien.

## Mettre en service

```bash
MODELE_COLLECTE=$PWD/outils/entrainement/modeles/lilt-alambic
```

Puis `npm run dev`, ou le banc pour juger sur de vraies photos :

```bash
npm run banc:collecte -- corpus --modele $PWD/outils/entrainement/modeles/lilt-alambic
```

Le sidecar charge ce dossier sans rien changer à son code : le checkpoint embarque son
tokenizer et sa table `id2label`.

Côté Collecte, `src/etiquettes.ts` traduit les champs du modèle vers les étiquettes que
`reconstruction.ts` sait lire (table `CORRESPONDANCE`). Les champs sans contrepartie —
marchand, adresse, téléphone, date, heure, paiement — tombent sur `exterieur` : la Facture les
tire de ses reconnaisseurs, et deux sources pour un même champ se contrediraient sans qu'on
sache laquelle croire. Les brancher est un travail à part, à faire avec une mesure sous les
yeux.

## Publier

Le checkpoint pèse plus d'un Go : il est gitignoré, et l'image ne peut donc pas le prendre dans
le dépôt. Il passe par un bucket compatible S3 (OVH Object Storage) :

```bash
npm run publier-modele -- --bucket <bucket>
```

La commande compresse `modeles/lilt-alambic`, refuse d'écraser un objet déjà publié — une image
de production l'a peut-être déjà consommé — et imprime la ligne `MODELE_S3_URI` à recopier dans
Dokploy. L'image redescend l'archive **au build** : en production rien ne se télécharge, rien ne
s'écrit sur disque, et aucune clé S3 ne descend sur le serveur.

Une image construite sans `MODELE_S3_URI` embarque le checkpoint public à la place. Comme il
charge sans erreur et rend des factures — simplement moins bien lues — le démarrage en
`NODE_ENV=production` est refusé quand `MODELE_COLLECTE` n'est pas renseignée, plutôt que de
laisser passer un service qui ment en silence.

Voir la section « Déploiement » du [README racine](../../README.md) pour les réglages Dokploy.
