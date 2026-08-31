# Hublot — voir travailler le pipeline

L'ouverture vitrée par laquelle on regarde à l'intérieur de l'alambic : une page servie **en
développement uniquement**, qui montre chaque étape du pipeline, ses sous-étapes, leur statut et
ce que chacune a produit — image, JSON, durée.

Les étapes ne font presque rien pour l'instant, et c'est justement maintenant que l'outil sert :
chacune se conçoit en observant son effet réel sur des images réelles.

```bash
npm run dev
```

Puis <http://localhost:3100/hublot>. Déposer une photo de reçu sur la barre du haut.

## La règle qui prime sur toutes les autres

**Le hublot se nourrit du pipeline ; il ne le connaît pas.**

Ajouter une quatrième étape ne demande **aucune modification ici**, ni côté serveur ni côté page.
Le hublot est un lecteur générique de traces, pas une vue codée sur les étapes du jour.

| Règle | Conséquence concrète |
|---|---|
| Aucun nom d'étape dans le hublot | `grep -rE 'chauffe\|condensation\|collecte\|facture' src public` ne rend **rien** |
| `PlanPipeline` est la seule source de vérité | La page dessine ce que le plan décrit, jamais ce qu'elle suppose |
| Le rail est dimensionné à l'exécution | `flex` et `.etape { flex: 1 1 0 }`, jamais un nombre de colonnes figé |
| Trois genres d'aperçu, tous génériques | `image`, `cadres`, `donnees` — le genre décide du rendu, jamais le nom de la sous-étape |
| La carte produit est agnostique | Elle affiche les clés de l'objet reçu ; elle ignore ce qu'il représente |

La superposition des cadres OCR est le piège que cette règle évite : une étape *déclare* qu'elle
produit des zones à superposer, le hublot les pose sur la dernière image reçue, et personne n'a
besoin de savoir qui parle.

Ajouter une étape coûte exactement : le nouveau package, une entrée dans `ETAPE`, et son maillon
dans `distiller.ts`. Rien d'autre.

## Ce que le package attend de son hôte

Un plugin paramétré : il ne connaît ni `packages/api` ni les étapes, tout lui arrive par options.

```ts
app.register(routesHublot, {
  plan: PLAN_PIPELINE,
  distiller: async (image, surEvenement) => ({ produit, mesures }),
})
```

Deux conditions côté hôte :

- `@fastify/multipart` est **déjà enregistré** — le hublot lit le fichier que ce plugin ajoute à
  la requête, il ne l'enregistre pas lui-même.
- L'enregistrement est **sous garde** : `NODE_ENV !== production`. Le hublot est une
  `devDependency` de `packages/api`, absente de l'image Docker ; la garde et l'omission se
  couvrent l'une l'autre.

## Les routes

| Route | Rôle |
|---|---|
| `GET /hublot` | la page |
| `GET /hublot/plan` | le `PlanPipeline` — la page dessine son squelette avant tout téléversement |
| `POST /hublot/distiller` | multipart en entrée, `text/event-stream` en sortie |

**POST et non `EventSource`** : il faut téléverser une image, et un `EventSource` ne fait que du
GET. Un POST qui rend un flux se lit avec `fetch` et un lecteur de flux, et évite d'inventer un
identifiant de session — le service reste sans état.

**Un seul genre d'événement**, discriminé par un champ du JSON : une seule branche de parsing de
chaque côté.

```
data: {"genre":"trace","etape":"…","sousEtape":"…","statut":"reussi","dureeMs":16.6,"apercus":[…]}
data: {"genre":"fin","produit":{…},"mesures":{…}}
data: {"genre":"echec","code":"image_illisible","statut":400,"message":"…"}
```

Se lit très bien sans navigateur :

```bash
curl -N -F "image=@recu.jpg" localhost:3100/hublot/distiller
```

Contrairement à `POST /distiller`, aucun contrôle du type de fichier : déposer un PDF pour voir
**où** et **comment** le pipeline le refuse est un usage légitime de l'outil.

## La page

Modules ES natifs, zéro bundler, zéro build.

| Fichier | Rôle |
|---|---|
| `public/index.html` | la structure, vide de données |
| `public/hublot.css` | tokens et composants, thème clair et sombre |
| `public/hublot.js` | l'état, les événements du DOM, l'assemblage |
| `public/flux.js` | POST multipart → événements |
| `public/commun.js` | statuts, pastilles, et la lecture de l'avancement |
| `public/pipeline.js` | jauge, cartes d'étapes, carte produit |
| `public/inspecteur.js` | aperçu, sortie brute, chronologie |

L'état tient en peu de chose : le plan, une `Map` des traces reçues, la sélection courante et le
`File` gardé pour le bouton **Relancer**. Une sous-étape absente de la `Map` est en attente —
rien à pré-remplir ni à tenir à jour.

Chaque statut porte **une couleur et un signe** — pastille pleine `✓` / `!` / `✕` — pour rester
lisible en niveaux de gris et pour qui ne distingue pas l'ambre du vert.
