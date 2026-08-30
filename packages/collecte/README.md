# @alambic/collecte — étape 3

**Interprète le texte lu en facture exploitable.** Entrée : un `Condensat`. Sortie : une
`Facture`.

```ts
const facture = collecter(condensat)
```

C'est l'étape qui donne du sens : reconnaître qu'un « 8,91 » à droite d'un « TOTAL » est le
montant payé, qu'une ligne « TPS 5% » est une taxe, qu'une suite de caractères en haut du ticket
est le nom du marchand.

## Fonction pure et synchrone

Mêmes entrées, mêmes résultats, aucune entrée-sortie. C'est ce qui la rend vérifiable isolément :
on peut lui donner un condensat écrit à la main et vérifier ce qu'elle en tire, sans image, sans
moteur OCR et sans serveur. Cette propriété est à préserver quand la reconnaissance s'étoffera.

## Ce que fait le squelette aujourd'hui

Le **total**, et rien d'autre :

1. `grouperEnLignes` reconstitue les lignes à partir de la géométrie des blocs.
2. On cherche la **dernière** ligne portant un marqueur de total — un reçu imprime souvent un
   rappel en tête, mais c'est le pied de ticket qui fait foi.
3. Les lignes contenant « sous » sont écartées, sinon un sous-total écraserait le vrai montant.
4. On garde le **dernier** nombre de la ligne : sur « TPS 5% 0,39 », le montant est 0,39, pas 5.

La confiance retenue est celle du **maillon faible** de la ligne : un total dont le libellé est
net mais le montant douteux reste un total douteux.

## Ce qui viendra

Date, marchand, taxes, articles. Le contrat les prévoit déjà, tous nullables — les champs non
reconnus sortent à `null` plutôt que de faire échouer la distillation.
