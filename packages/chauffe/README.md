# @alambic/chauffe — étape 1

**Prépare l'image pour qu'un OCR puisse la lire.** Entrée : les octets bruts reçus. Sortie :
une `ImageChauffee` — une image binarisée, redressée, recadrée, et un score de qualité.

```ts
const image = await chauffer(original)
```

Cette étape ne lit aucun texte et ne comprend aucune facture. Elle ne fait qu'une chose : rendre
l'image aussi lisible que possible pour l'étape suivante. C'est ici que se gagne — ou se perd —
la qualité de tout ce qui suit.

Tout est fait avec [sharp](https://sharp.pixelplumbing.com/), plus les algorithmes classiques
que sharp ne fournit pas, écrits ici. Aucun modèle, aucun appel réseau.

## Ce qu'on cherche : un objet clair et peu saturé dans un décor quelconque

C'est la seule régularité sur laquelle on peut compter, et toute l'étape est construite dessus :
on cherche une **région**, pas des arêtes. Un bord de papier peut être bougé, masqué par un
doigt, ou sortir du cadre ; une région claire reste une région claire.

D'où l'ordre, dont un point n'est pas négociable : **`document` passe avant `nettete`.** Tout ce
qui suit travaille alors sur le document seul. Mesurer la netteté d'un reçu sur un décor de
restaurant flou par nature n'a aucun sens — c'est l'erreur qui laissait passer les photos
bougées.

## Les neuf sous-étapes

| # | Sous-étape | Ce qu'elle fait |
|---|---|---|
| 1 | `preparation` | Orientation EXIF, aplatissement sur blanc, réduction. Rend l'image de travail en gris **et** une miniature en couleur |
| 2 | `document` | Segmente le papier, en tire quatre coins, puis aplatit par homographie ou recadre |
| 3 | `nettete` | Mesure le flou **dans le document**. Seule sous-étape qui peut refuser |
| 4 | `redressement` | Inclinaison résiduelle du texte, par projection de profil, puis rotation |
| 5 | `contraste` | CLAHE — égalise l'éclairage **local**, ce qui sauve un reçu à moitié dans l'ombre |
| 6 | `binarisation` | Seuillage adaptatif : chaque pixel comparé à la moyenne de son voisinage |
| 7 | `debruitage` | Médian 3×3 — efface les points isolés sans manger les jambages |
| 8 | `finition` | Retire la marge blanche restante et pose une bordure régulière |
| 9 | `encodage_png` | Sans perte — un artefact JPEG sur un caractère se paie en montant faux |

Chaque sous-étape est écrite **une seule fois**, dans son propre fichier, et rend une `Sortie`.
Le pilote (`chauffe.ts`) les enchaîne, les chronomètre et les publie dans la trace. Les aperçus
sont produits par une closure que la production n'appelle jamais : **observer ne coûte rien
quand personne ne regarde**.

## Deux mesures qui ne sont pas les mesures évidentes

**La netteté ne se mesure pas par la variance du Laplacien.** C'est la méthode habituelle, et
elle mesure le bruit de capteur plus que la netteté : sur un texte rendu illisible par un flou,
elle donne 6 sur une image propre et **580** avec un bruit d'écart-type 6 — vingt-neuf fois le
seuil de refus, et un meilleur score qu'une image nette. On refloute plutôt l'image et on regarde
ce qu'elle perd : ce qui est déjà flou n'a plus rien à perdre. Un pré-lissage coupe la bande de
fréquences où vit le bruit sans toucher un trait de caractère.

**Le document ne se cherche pas par ses arêtes.** Sobel et Hough supposent quatre droites
franches ; sur une vraie photo, les lignes de texte du reçu votent plus fort que ses bords. La
segmentation par région, puis Douglas-Peucker sur l'enveloppe convexe, donne les quatre coins
sans rien supposer de la netteté des bords.

## Une sous-étape qui échoue ne bloque pas

Sauf `nettete`, aucune sous-étape ne peut faire échouer la distillation. Si elle n'y arrive pas —
pas de région qui se détache sur un reçu scanné sur fond blanc, coins hors du cadre, pas de marge
à retirer — elle **laisse passer l'image**, se déclare `degrade`, et dit pourquoi. Le motif
s'affiche dans le [hublot](../hublot).

En particulier, **un document qui touche les bords du cadre n'est pas refusé**. Mesuré sur le
corpus, la moitié des photos le font : c'est le cadrage serré normal de quelqu'un qui
photographie un reçu. On renonce alors à la perspective — les vrais coins ne sont pas dans
l'image — et on se contente de recadrer.

## Score de qualité

`ImageChauffee.qualite`, entre 0 et 1 : le **minimum** des sous-scores de `document`, `nettete`
et `binarisation` — c'est le maillon faible qui détermine la lisibilité, pas la moyenne. Il est
journalisé avec les autres mesures et ne part pas dans la réponse au consommateur.

Il descend notamment quand la région trouvée est peu convexe, signe que le document se confond
avec un fond clair et que le cadrage en a emporté une part.

## Erreurs

| Erreur | Quand |
|---|---|
| `ErreurAlambic(image_illisible, 400)` | Fichier tronqué, ou format que sharp ne connaît pas |
| `ErreurAlambic(image_trop_floue, 422)` | Le score de netteté est sous `SCORE_REFUSE` |

## Régler les seuils : sur le corpus, jamais à l'intuition

```bash
npm run banc -- corpus
```

Le banc passe tout un dossier de photos et rend un tableau — verdict, durée par sous-étape,
qualité, dimensions — plus les images de chaque sous-étape dans `corpus/sorties/`. C'est la vue
d'ensemble qui permet de bouger un seuil sans en casser cinq autres. Le hublot montre une photo
en détail ; le banc montre le corpus entier.

Les constantes vivent en tête de chaque fichier, nommées. **Elles ont été calées sur de vraies
photos**, et c'est la leçon la plus chère de ce package : sur des images de synthèse, le seuil de
netteté semblait devoir être à 0,17 ; sur de vraies photos, il y refuse un reçu froissé
parfaitement net. Les images synthétiques n'ont ni bruit de capteur, ni contre-jour, ni main dans
le cadre — c'est-à-dire rien de ce qui fait échouer une mesure.

## Un piège de sharp qui vaut d'être connu

Sur une entrée en pixels bruts à un canal, **sharp rend trois canaux** en sortie brute. `enEtat`
force `toColourspace('b-w')` et vérifie le résultat ; sans cela, chaque sous-étape rendrait un
tampon trois fois trop long que la suivante relirait décalé, sans qu'aucune erreur ne soit levée.
