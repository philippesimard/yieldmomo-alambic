# @alambic/chauffe — étape 1

**Prépare l'image pour qu'un OCR puisse la lire.** Entrée : les octets bruts reçus. Sortie :
une `ImageChauffee`.

```ts
const image = await chauffer(original)
```

Cette étape ne lit aucun texte et ne comprend aucune facture. Elle ne fait qu'une chose : rendre
l'image aussi lisible que possible pour l'étape suivante. C'est ici que se gagne — ou se perd —
la qualité de tout ce qui suit : un OCR excellent sur une image mal préparée fait moins bien
qu'un OCR moyen sur une image nette.

## Ce que fait le squelette aujourd'hui

1. **Orientation EXIF** appliquée puis effacée — sans ça, une photo prise de travers est lue
   couchée.
2. **Niveaux de gris** — la couleur n'apporte rien à un OCR et triple les octets à transporter.
3. **Redimension** à `LARGEUR_CIBLE` (2000 px), sans jamais agrandir — agrandir une photo floue
   n'ajoute aucun détail mais multiplie le travail de l'OCR.
4. **Encodage PNG**, sans perte — un artefact JPEG sur un caractère se paie en erreur de lecture,
   et une erreur de lecture sur un montant se paie en donnée financière fausse.

Tout est fait avec [sharp](https://sharp.pixelplumbing.com/), dont le travail se passe hors du
thread principal.

## Ce qui viendra

Détection des bords du ticket, redressement de perspective, seuillage adaptatif, débruitage.
Les constantes de réglage vivent en tête de `chauffe.ts`, nommées, pour être ajustées **sur
mesures** plutôt qu'à l'intuition.

## Erreurs

Une image tronquée ou d'un format inconnu lève `ErreurAlambic(image_illisible, 400)` : la
requête est en cause, pas le serveur.
