# @alambic/api — le serveur

Reçoit les images, enchaîne les trois étapes, rend la facture. C'est le **seul** package qui
connaît les trois étapes ; aucune d'elles ne sait ce qui la précède ni ce qui la suit.

## Routes

| Route | Rôle |
|---|---|
| `POST /distiller` | Une image en `multipart/form-data` → une `Facture` en JSON |
| `GET /health` | Liveness : « faut-il redémarrer ce conteneur ? » |
| `GET /ready` | Readiness : « faut-il lui envoyer du trafic ? » |

`POST /distiller` exige l'en-tête `x-cle-alambic`, comparée en temps constant sur des empreintes
SHA-256 — comparer directement les secrets trahirait leur longueur, et un `===` s'arrête au
premier octet différent, ce qui laisse deviner la clé octet par octet.

## Les deux sondes

Elles regardent le **même** état — un ouvrier vivant au moins, et les deux moteurs prêts — et ne
diffèrent que par la question posée. Tout le mode maintenance tient dans cet écart.

| | `MODE_MAINTENANCE=true` | Tout va bien | Atelier vide ou moteur absent |
|---|---|---|---|
| `GET /health` | **200** `"maintenance"` | 200 `"ok"` / `"degrade"` | **503** `"degrade"` |
| `GET /ready` | **503** `"maintenance"` | 200 `"ok"` / `"degrade"` | **503** `"degrade"` |
| `POST /distiller` | **503** `maintenance` | normal | 429 / 503 |

Les deux sondes rendent **toujours** un `Sante` complet, y compris en 503 — et non le
`{ code, message }` des erreurs de distillation. Un 503 de sonde est un *état*, pas un échec de
requête : le code HTTP porte l'action ops, le corps porte le diagnostic, et l'appelant lit la
même forme quoi qu'il arrive.

Une sonde ne déclenche **aucun** appel sortant : elle ne lit que des compteurs et des drapeaux en
mémoire. Sonder ne peut donc ni coûter ni échouer. Elles répondent en `cache-control: no-store` —
un état de santé n'a jamais de sens dans un cache.

### Le mode maintenance

`MODE_MAINTENANCE=true` est un arrêt **volontaire**, pas une panne, et les deux se traitent
différemment :

- `/ready` passe en 503 pour que le load balancer **retire** l'instance ;
- `/health` reste en 200 pour que personne ne la **redémarre**.

C'est pour cette raison que le `HEALTHCHECK` du Dockerfile vise `/health` et non `/ready` : viser
la readiness ferait redémarrer le conteneur en boucle pendant toute la maintenance, alors que le
process va très bien.

`POST /distiller` refuse en 503 `maintenance`, **avant** de vérifier `x-cle-alambic` : contrôler
un secret pour un service fermé est du travail pour rien, et l'état de maintenance est de toute
façon public sur les sondes.

### Le statut

`ok` quand le service est au complet, `maintenance` quand il est fermé, `degrade` dès qu'il ne
l'est plus tout à fait — un moteur qui n'a pas fini de charger, ou un ouvrier mort que l'atelier
n'a pas encore remplacé. Le code HTTP dit s'il faut agir, ce champ dit pourquoi.

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
**cesse de remplacer** et se vide. Les deux sondes passent alors en 503 et l'orchestrateur
redémarre le conteneur — mieux vaut un service qui s'annonce mort qu'une boucle de création qui
brûle un cœur en cachant la panne.

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
