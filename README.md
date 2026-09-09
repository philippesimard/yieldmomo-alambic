# Alambic

Service de lecture de factures et de reçus. Il reçoit une photo, en tire des données
structurées, et rend un JSON exploitable.

Alambic est un **service privé**, appelé de serveur à serveur par l'API de YieldMomo. L'image lui
parvient par cette API ; aucun navigateur ne le joint jamais directement.

## La distillation, en trois étapes

Le nom vient du procédé : on chauffe, on condense, on collecte. Chaque étape est **entièrement
indépendante**, spécialisée dans une seule partie du traitement, et ne connaît ni celle qui la
précède ni celle qui la suit.

```
   photo         image nette        texte + géométrie        facture
     │                │                     │                   │
     ▼                ▼                     ▼                   ▼
┌─────────┐     ┌─────────────┐      ┌────────────┐      ┌──────────┐
│ Chauffe │ ──▶ │ Condensation│ ──▶  │  Collecte  │ ──▶  │   JSON   │
└─────────┘     └─────────────┘      └────────────┘      └──────────┘
  préparer         lire tout            comprendre
   l'image          le texte            ce qui est lu
```

| Étape | Package | Rôle |
|---|---|---|
| **Chauffe** | [`packages/chauffe`](packages/chauffe) | Isoler le document : recadrer, aplanir, redresser — sans binariser |
| **Condensation** | [`packages/condensation`](packages/condensation) | Extraire tout le texte, avec sa position |
| **Collecte** | [`packages/collecte`](packages/collecte) | Interpréter ce texte en facture |

Deux packages les servent :

| Package | Rôle |
|---|---|
| [`packages/noyau`](packages/noyau) | Les contrats partagés — le seul que les étapes ont le droit de connaître |
| [`packages/api`](packages/api) | Le serveur Fastify et l'atelier de workers |
| [`packages/hublot`](packages/hublot) | Voir travailler le pipeline — **développement uniquement** |

**Aucune étape n'importe une autre étape.** Elles se parlent uniquement à travers les formes
définies dans le noyau, et c'est l'API qui les enchaîne. Cette séparation n'est pas une
convention : les frontières de packages la rendent impossible à franchir par accident.

## Démarrer

```bash
npm install
```

```bash
cp .env.local.exemple .env
```

```bash
npm run dev
```

Le service écoute sur le port 3100 (3000 est déjà pris par l'API de YieldMomo en local).

## Essayer

```bash
curl -s -X POST localhost:3100/distiller -H "x-cle-alambic: $ALAMBIC_CLE" -F "image=@recu.jpg"
```

En développement sans `ALAMBIC_CLE` renseignée, l'en-tête est inutile : le service répond à tout
le monde. En production, son absence **refuse le démarrage**.

Réponse :

```json
{
  "marchand": { "valeur": "DEPANNEUR DU COIN", "confiance": 0.68 },
  "date": { "valeur": "2026-08-28", "confiance": 0.88 },
  "devise": { "valeur": "CAD", "confiance": 0.39 },
  "sousTotal": { "valeur": 22.99, "confiance": 0.93 },
  "taxes": [
    { "nom": "TPS", "taux": 0.05, "montant": 1.15, "confiance": 0.91 },
    { "nom": "TVQ", "taux": 0.09975, "montant": 2.29, "confiance": 0.9 }
  ],
  "total": { "valeur": 26.43, "confiance": 0.95 },
  "carte": { "valeur": "visa", "confiance": 0.87 },
  "articles": [
    { "libelle": "Cafe filtre moyen", "quantite": null, "prixUnitaire": null, "montant": 3.25, "confiance": 0.9 }
  ],
  "categorie": { "valeur": "alimentation", "confiance": 0.56 },
  "sousCategorie": { "valeur": "cafe", "confiance": 0.56 }
}
```

Tous les champs sont nullables : une photo froissée peut ne livrer qu'un total, et rendre une
facture partielle vaut mieux que refuser la requête. Chaque champ porte sa **confiance**, pour
que l'appelant sache quoi faire confirmer à l'utilisateur. `carte` est le réseau de la carte de
paiement, normalisé (`visa`, `mastercard`, `amex`, `interac`, `autre`) — `null` si comptant ou
illisible.

`categorie` et `sousCategorie` disent la nature de la dépense, déduite de l'enseigne. Les clés
sont celles du catalogue de YieldMomo : `categorie` est un groupe (`alimentation`, `transport`…),
`sousCategorie` une de ses catégories (`epicerie`, `essence`…). Une sous-catégorie implique
toujours sa catégorie ; l'inverse est faux, et c'est voulu.

**Un `null` ici est un refus de trancher, pas un échec de lecture.** Une catégorie fausse coûte
plus cher au consommateur qu'une catégorie absente : quand l'enseigne désigne plusieurs
catégories d'un même groupe, on rend le groupe seul (« TIM HORTONS » est de l'alimentation, sans
qu'on sache dire restaurant ou café) ; quand elle en désigne de groupes différents, on ne rend
rien. Les enseignes hors catalogue — la majorité — tombent aussi sur `null`.

> **État actuel :** la Condensation lit avec **PaddleOCR** (PP-OCRv5) et la Collecte structure
> avec **LiLT** (token classification, checkpoint CORD zero-shot, licence MIT) — chacun dans
> son sidecar Python, activés par `MOTEUR_OCR=paddleocr` et `MOTEUR_COLLECTE=lilt` (voir
> [`packages/condensation`](packages/condensation) et [`packages/collecte`](packages/collecte)
> pour installer les venvs ; sans eux, les moteurs **factices** restent le défaut en
> développement). Le fine-tuning sur un corpus annoté maison est la prochaine étape ; le banc de
> collecte exporte déjà les prédictions dans un format ré-annotable.

## Voir travailler le pipeline

En développement, `npm run dev` monte aussi le **hublot** : une page qui montre chaque étape, ses
sous-étapes, ce que chacune a produit et ce qu'elle a coûté.

```bash
open http://localhost:3100/hublot
```

C'est l'outil avec lequel les étapes se conçoivent — on y juge un seuillage, des cadres OCR ou une
reconnaissance sur de vraies photos. Il n'existe jamais en production : voir
[`packages/hublot`](packages/hublot).

## Santé et maintenance

Deux sondes, qui regardent le même état et ne diffèrent que par la question posée :

| Route | Question |
|---|---|
| `GET /health` | Liveness — « faut-il redémarrer ce conteneur ? » |
| `GET /ready` | Readiness — « faut-il lui envoyer du trafic ? » |

```bash
curl -s localhost:3100/health
```

```json
{
  "statut": "ok",
  "version": "0.1.0",
  "horodatage": "2026-09-09T15:39:37.568Z",
  "environnement": "production",
  "demarreLe": "2026-09-09T14:02:11.004Z",
  "ouvriers": 7,
  "ouvriersAttendus": 7,
  "condensation": { "pret": true },
  "collecte": { "pret": true }
}
```

`condensation` et `collecte` sont les **étapes**, pas les moteurs qui travaillent derrière. Que
la Condensation lise avec PaddleOCR ou autre chose ne regarde pas l'appelant : le publier
obligerait à renégocier ce contrat le jour où on en change.

`statut` vaut `ok` quand le service est au complet, `maintenance` quand il est fermé, et
`degrade` dès qu'il ne l'est plus tout à fait — un moteur qui n'a pas fini de charger, ou un
ouvrier mort que l'atelier n'a pas encore remplacé. **Le code HTTP dit s'il faut agir, `statut`
dit pourquoi.**

Les deux sondes rendent **toujours** cette même forme, y compris en 503 — et non le
`{ code, message }` des erreurs de distillation. Un 503 de sonde est un *état*, pas un échec de
requête. Elles répondent en `cache-control: no-store`, et ne déclenchent aucun appel sortant :
sonder ne peut ni coûter ni échouer.

### `MODE_MAINTENANCE`

Un arrêt **volontaire**, pas une panne — et les deux ne se traitent pas pareil :

| | `MODE_MAINTENANCE=true` | Tout va bien | Atelier vide ou moteur absent |
|---|---|---|---|
| `GET /health` | **200** `"maintenance"` | 200 `"ok"` / `"degrade"` | **503** `"degrade"` |
| `GET /ready` | **503** `"maintenance"` | 200 `"ok"` / `"degrade"` | **503** `"degrade"` |
| `POST /distiller` | **503** `maintenance` | normal | 429 / 503 |

`/ready` passe en 503 pour que le load balancer **retire** l'instance ; `/health` reste en 200
pour que personne ne la **redémarre**. C'est pour cette raison que le `HEALTHCHECK` du Dockerfile
vise `/health` : viser la readiness ferait redémarrer le conteneur en boucle pendant toute la
maintenance, alors que le process va très bien.

Côté consommateur, un `POST /distiller` pendant une maintenance rend un 503 ordinaire, de la même
forme que les autres :

```json
{ "code": "maintenance", "message": "Le service est en maintenance, reessayez plus tard." }
```

## Erreurs

Toutes les réponses d'erreur ont la même forme : `{ "code": "...", "message": "..." }`. Le `code`
est stable et destiné à être testé par un programme ; le message est français et ne sert qu'aux
logs. C'est au consommateur de traduire pour l'utilisateur.

| Code | Statut | Sens |
|---|---|---|
| `cle_invalide` | 401 | En-tête `x-cle-alambic` absente ou fausse |
| `requete_invalide` | 400 | Le corps n'est pas un multipart contenant une image |
| `format_non_supporte` | 400 | Le fichier n'est pas une image |
| `image_illisible` | 400 | Fichier tronqué ou format inconnu |
| `image_trop_lourde` | 413 | Au-delà de `TAILLE_MAX_IMAGE` |
| `image_trop_floue` | 422 | Photo trop floue pour être lue — reprendre la photo |
| `aucun_texte` | 422 | Rien de lisible sur l'image — reprendre la photo |
| `delai_depasse` | 504 | La distillation a dépassé `DELAI_DISTILLATION_MS`, ou un moteur son plafond (`DELAI_OCR_MS`, `DELAI_COLLECTE_MS`) |
| `surcharge` | 429 / 503 | Trop de requêtes, ou plus aucun ouvrier disponible |
| `moteur_indisponible` | 503 | Un moteur du pipeline ne répond pas — réessayer plus tard |
| `maintenance` | 503 | Arrêt volontaire, `MODE_MAINTENANCE` est actif — voir plus haut |
| `erreur_interne` | 500 | Panne — le détail reste dans les logs |

## Commandes

```bash
npm run dev
```

```bash
npm run typecheck
```

Calibrer la Chauffe sur un dossier de photos (voir [`packages/chauffe`](packages/chauffe)) :

```bash
npm run banc -- corpus
```

Mesurer la Condensation sur le même corpus (voir
[`packages/condensation`](packages/condensation)) :

```bash
npm run banc:condensation -- corpus
```

Mesurer la Collecte sur le pipeline complet, et exporter les prédictions ré-annotables (voir
[`packages/collecte`](packages/collecte)) :

```bash
npm run banc:collecte -- corpus
```

Noter ces prédictions contre la vérité terrain du corpus (`corpus/verite.json`, relevée à l'œil
sur chaque photo) — le banc dit ce que le pipeline a trouvé, la mesure dit s'il avait raison :

```bash
npm run mesure -- corpus
```

```bash
npm run check:fix
```

## Conventions

Reprises du dépôt YieldMomo, voir [CLAUDE.md](CLAUDE.md) : Node 22, npm workspaces, TypeScript
strict, Biome, code et commentaires **en français sans accents dans les identifiants**, et des
commentaires qui n'expliquent que le *pourquoi*.
