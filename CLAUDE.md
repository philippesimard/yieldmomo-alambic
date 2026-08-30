# Alambic — lecture de factures et de reçus

Service HTTP privé qui reçoit une photo de facture et en rend des données structurées. Appelé de
serveur à serveur par l'API de YieldMomo (`ALAMBIC_URL` de son côté), jamais par un navigateur.

Voir [README.md](README.md) pour la vue d'ensemble et le démarrage.

---

## La règle centrale : trois étapes indépendantes

Le traitement se fait en trois étapes, chacune spécialisée dans une seule partie du travail :

| Étape | Package | Entrée → Sortie |
|---|---|---|
| **Chauffe** | `packages/chauffe` | `Buffer` → `ImageChauffee` |
| **Condensation** | `packages/condensation` | `ImageChauffee` → `Condensat` |
| **Collecte** | `packages/collecte` | `Condensat` → `Facture` |

**Une étape n'importe jamais une autre étape.** Elles ne communiquent qu'à travers les contrats de
`packages/noyau`, et c'est `packages/api` qui les enchaîne (`src/distiller.ts`, le seul fichier du
dépôt qui les connaît toutes les trois).

Cette règle est ce qui permettra de retravailler, remplacer ou mesurer une étape sans toucher aux
autres. Un import croisé la casse — et le découpage en packages est là pour que ce soit impossible
par accident, pas seulement déconseillé.

Corollaire : **rien qui appartienne à une étape ne monte dans le noyau**. Le noyau ne contient que
des contrats (types, schémas Zod, constantes, erreurs) et la géométrie qui les lit
(`grouperEnLignes`, dont deux étapes ont besoin sans avoir le droit de se connaître).

---

## Runtime et outillage

| Sujet | Choix |
|---|---|
| Runtime | Node.js 22 |
| Gestionnaire de paquets | npm workspaces (pas de pnpm, pas de yarn) |
| Langage | TypeScript **strict** — pas de `any`, pas de `any` implicite |
| Serveur | Fastify 5 + `fastify-type-provider-zod` + Zod 4 |
| Logs | pino (une seule instance, `src/journal.ts`) |
| Images | sharp |
| Lanceur | `tsx`, en développement **et** en production (pas de pipeline de build) |
| Lint + format | **Biome** seul — pas d'ESLint ni Prettier |

---

## Style de code

### Philosophie

Le code **le plus simple possible** et **le plus performant possible**. Un junior comprend chaque
fonction sans explication ; un pro n'y trouve rien à redire.

- **Simplicité d'abord** : pas d'abstraction spéculative, pas de généricité « au cas où ».
- **Une fonction = une seule chose.** Si on doit dire « et » pour la décrire, on la scinde.
- **Performant sans sacrifier la clarté** : la bonne structure de données dès le départ, éviter le
  travail inutile. La micro-optimisation illisible n'est *pas* de la performance.
- **Mesurer avant d'optimiser.** Les mesures par étape sont journalisées à chaque distillation.

### Langue

- Le code est **rédigé en français** : variables, fonctions, types, fichiers, commentaires.
- **Exception** : le vocabulaire propre à la programmation reste en anglais (`schema`, `worker`,
  `pool`, `buffer`, `router`, `middleware`).
- **Les accents n'apparaissent jamais dans un identifiant ni dans un commentaire** — uniquement
  dans le texte affiché et dans les fichiers Markdown.

### Règles

- Pas de commentaire sauf si le *pourquoi* n'est pas évident : une contrainte cachée, un
  contournement, un invariant subtil. Pas de docstring multi-lignes.
- Pas de `console.log` — le logger pino, toujours.
- `const` plutôt que `let` ; jamais `var`.
- **Exports nommés uniquement.**
- Pas d'assertion de type (`as Foo`) sans un commentaire qui explique pourquoi c'est sûr.
- Privilégier `z.infer<>` aux interfaces écrites à la main pour tout ce qui a un schéma Zod.
- **Aucun littéral de domaine codé en dur.** Toute valeur d'un ensemble fini passe par une
  constante nommée (`CODE_ERREUR.imageIllisible`, `FORMAT_IMAGE.png`), jamais par le littéral en
  clair. Exception : les standards de la plateforme (`typeof x === 'number'`, codes HTTP).

---

## Erreurs

- **Jamais de `throw` brut.** Une étape lève une `ErreurAlambic(code, statut, message)` ; une
  route répond `reponse.code(n).send({ code, message })`.
- Le consommateur est un **programme** : pas de dictionnaire de traductions. On rend un `code`
  stable qu'il teste, et un message français pour les logs. C'est YieldMomo qui parle à l'humain.
- Toutes les réponses d'erreur ont la même forme `{ code, message }`, y compris celles des hooks
  globaux (limitation de débit comprise) — voir `ReponseErreurSchema`.
- Un détail de panne interne (statut ≥ 500) ne sort **jamais** vers l'appelant : il part dans les
  logs, l'appelant reçoit un message générique.

---

## Performance et fiabilité

Prioritaires. L'objectif : traiter le plus grand nombre de factures possible, le mieux possible.

- **Sans état.** Aucune base, rien sur disque, rien conservé entre deux requêtes. C'est ce qui
  permet de répliquer le service horizontalement sans coordination.
- **Le pipeline tourne dans un worker**, jamais sur l'event loop : le serveur reste réactif quelle
  que soit l'implémentation future des étapes.
- **Contre-pression, pas de file qui gonfle.** Au-delà de la profondeur de file, on refuse (429).
  Une file sans borne transforme une surcharge passagère en effondrement.
- **Éviter les copies.** L'image est transférée entre threads (`transferList`), pas recopiée.
- **Dégradation gracieuse.** Un champ non reconnu sort à `null` ; il ne fait pas échouer la
  distillation. Seul un échec franc (rien de lisible) donne une erreur.
- **Exactitude des montants.** Montants bruts, jamais arrondis ici : l'arrondi au cent appartient
  à l'affichage, chez le consommateur.
- **Mesures journalisées** à chaque distillation (`octets`, `chauffeMs`, `condensationMs`,
  `collecteMs`, `totalMs`). Elles restent dans les logs et ne partent pas dans la réponse.

---

## Configuration

- Une seule porte : `packages/api/src/config/env.ts`. **On n'accède jamais à `process.env`
  ailleurs.**
- Le schéma Zod **refuse le démarrage** si la configuration est invalide, avec un message lisible.
  Un secret manquant en production est une erreur de démarrage, pas une dégradation silencieuse.
- Une valeur vide vaut « non définie » (`sansValeursVides`) : les gabarits portent donc toutes les
  clés, actives, sans commentaire à déplacer de l'un à l'autre.

---

## Conventions Git

- **Conventional Commits**, messages **en français** : `feat:`, `fix:`, `chore:`, `docs:`,
  `refactor:`, `test:`, `style:`
- Le scope est l'étape ou la zone touchée : `chauffe`, `condensation`, `collecte`, `noyau`, `api`.
  - Exemples : `feat(chauffe): ajoute le redressement de perspective`,
    `fix(api): repare la reponse de limitation de debit`
- Un commit = un changement cohérent. Sujet à l'impératif, concis.

---

## Lancer le projet

```bash
# Installer tous les workspaces (une seule commande a la racine)
npm install

# Developpement
npm run dev

# Verification de types pour tous les packages
npm run typecheck

# Lint + format
npm run check:fix
```

---

## Hors scope (ne pas implémenter sauf demande explicite)

- Toute modification du dépôt **yieldmomo** voisin, client Alambic compris.
- Base de données, file d'attente, cache partagé : le service est sans état, et le rester est un
  choix d'architecture, pas un manque.
- Traitement asynchrone (202 + polling) : le pipeline est synchrone, la contre-pression fait le
  travail.
- Interface web, CORS, sessions, comptes : Alambic n'est jamais joint par un navigateur.
