# @alambic/api — le serveur

Reçoit les images, enchaîne les trois étapes, rend la facture. C'est le **seul** package qui
connaît les trois étapes ; aucune d'elles ne sait ce qui la précède ni ce qui la suit.

## Routes

| Route | Rôle |
|---|---|
| `POST /distiller` | Une image en `multipart/form-data` → une `Facture` en JSON |
| `GET /health` | Liveness : le process répond |
| `GET /ready` | Readiness : l'atelier a au moins un ouvrier vivant et les moteurs sont prêts |

`POST /distiller` exige l'en-tête `x-cle-alambic`, comparée en temps constant sur des empreintes
SHA-256 — comparer directement les secrets trahirait leur longueur, et un `===` s'arrête au
premier octet différent, ce qui laisse deviner la clé octet par octet.

## L'atelier

Les distillations tournent dans un pool de `worker_threads` (`src/atelier/`), un ouvrier par
distillation. Le **pipeline entier** part dans le worker, pas une étape :

- l'event loop du serveur ne fait plus que de l'I/O et reste réactif quelle que soit
  l'implémentation future des étapes — y compris un OCR WASM qui bloquerait le thread principal ;
- le nombre d'ouvriers plafonne naturellement la concurrence : au-delà, on **refuse** (429) au
  lieu d'accepter un travail qu'on ne peut pas faire ;
- aucune étape n'a besoin de savoir qu'elle tourne dans un worker.

L'image est **transférée** (`transferList`) et non copiée : `postMessage` recopierait plusieurs
mégaoctets à chaque requête.

Un ouvrier qui dépasse `DELAI_DISTILLATION_MS` est tué et remplacé. Mais un ouvrier qui meurt
sans avoir rien servi ne démarrera probablement jamais : au-delà de 10 morts par minute, l'atelier
**cesse de remplacer** et se vide. `/ready` passe alors en 503 et l'orchestrateur redémarre le
conteneur — mieux vaut un service qui s'annonce mort qu'une boucle de création qui brûle un cœur
en cachant la panne.

## Les sidecars

Deux processus Python accompagnent le serveur : l'OCR de la Condensation (port 3101) et
l'étiquetage de la Collecte (port 3103). Un seul superviseur les gère (`src/sidecars/
superviseur.ts`) — fabrique instanciée deux fois, pas deux copies du même code : spawn, sonde de
santé, relance à recul exponentiel, disjoncteur au-delà de 5 morts en 5 minutes, SIGTERM puis
SIGKILL à l'arrêt. Un moteur configuré en `factice` n'a pas de sidecar et se dit toujours prêt.

Chaque sidecar charge **une** instance de son modèle, partagée par tous les ouvriers et
sérialisée par un verrou : N ouvriers qui chargeraient chacun leur copie multiplieraient la
mémoire sans gagner de débit, les runtimes parallélisant déjà chaque appel sur les cœurs.

### `ouvrier.mjs`

Un worker n'hérite pas du chargeur de modules de son parent : il ne saurait pas lire le
TypeScript de `ouvrier.ts`. Ce bootstrap `.mjs`, que Node charge nativement, installe `tsx` dans
le thread puis passe la main. L'option `execArgv` du Worker ferait la même chose en une ligne,
mais elle fonctionne sous `node --import tsx` et **pas** sous `tsx watch` — les deux lanceurs
doivent se comporter pareil. C'est pour cette raison que `tsx` est une dépendance de production.

## Ce qui n'est pas là, délibérément

- **Pas de CORS.** Aucun navigateur n'appelle Alambic : l'image lui parvient par l'API de
  YieldMomo. Ne pas installer `@fastify/cors` est une propriété de sécurité — sans en-tête
  d'origine, aucune page web ne peut lire ce service.
- **Pas de contrôle anti-CSRF.** Il protège un cookie de session, et il n'y en a aucun ici.
- **Pas de base de données, rien sur disque.** Le service est sans état : l'image entre, le JSON
  sort, rien n'est conservé. C'est ce qui permet de le répliquer horizontalement sans coordination.
- **Pas de traductions.** Le consommateur est un programme : on rend un `code` stable qu'il teste,
  et un message français qui ne sert qu'aux logs.

## Configuration

Toutes les variables sont validées au démarrage par `src/config/env.ts`, qui **refuse de
démarrer** si la configuration est invalide. On n'accède jamais à `process.env` ailleurs. Voir
`.env.local.exemple` à la racine.
