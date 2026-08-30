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

## Aujourd'hui : `moteurFactice`

Il ne regarde pas l'image et rend un reçu plausible sur deux colonnes, calé sur les dimensions
reçues. Il existe pour que le pipeline soit vérifiable de bout en bout dès le premier lancement.
**À remplacer, pas à compléter** : le rendre plus malin en ferait un faux point de comparaison.

Le vrai moteur (Tesseract local, service cloud, ou autre) se choisira sur mesures.

## La géométrie compte

Le `Condensat` porte `blocs` et pas seulement `texte`. Sur un reçu, le libellé d'un article et
son montant sont sur la même ligne mais dans deux colonnes : sans la géométrie, la Collecte ne
peut plus les rapprocher, et un reçu à deux articles devient illisible.

## Erreurs

Aucun fragment lu lève `ErreurAlambic(aucun_texte, 422)`. C'est un échec franc et non une
facture vide : le consommateur doit pouvoir distinguer « rien de lisible, refais la photo » de
« lu, mais aucun total reconnu ».
