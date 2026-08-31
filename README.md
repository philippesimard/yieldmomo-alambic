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
| **Chauffe** | [`packages/chauffe`](packages/chauffe) | Rendre l'image lisible : redresser, aplanir, binariser, recadrer |
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
curl -s localhost:3100/health
```

```bash
curl -s -X POST localhost:3100/distiller -H "x-cle-alambic: $ALAMBIC_CLE" -F "image=@recu.jpg"
```

En développement sans `ALAMBIC_CLE` renseignée, l'en-tête est inutile : le service répond à tout
le monde. En production, son absence **refuse le démarrage**.

Réponse :

```json
{
  "marchand": null,
  "date": null,
  "devise": null,
  "sousTotal": null,
  "taxes": [],
  "total": { "valeur": 8.91, "confiance": 0.9 },
  "articles": []
}
```

Tous les champs sont nullables : une photo froissée peut ne livrer qu'un total, et rendre une
facture partielle vaut mieux que refuser la requête. Chaque champ porte sa **confiance**, pour
que l'appelant sache quoi faire confirmer à l'utilisateur.

> **État actuel :** le squelette tourne de bout en bout, mais la Condensation utilise un moteur
> OCR **factice** et la Collecte ne reconnaît que le total. C'est délibéré : chaque étape sera
> travaillée séparément, et le vrai moteur se choisira sur mesures.

## Voir travailler le pipeline

En développement, `npm run dev` monte aussi le **hublot** : une page qui montre chaque étape, ses
sous-étapes, ce que chacune a produit et ce qu'elle a coûté.

```bash
open http://localhost:3100/hublot
```

C'est l'outil avec lequel les étapes se conçoivent — on y juge un seuillage, des cadres OCR ou une
reconnaissance sur de vraies photos. Il n'existe jamais en production : voir
[`packages/hublot`](packages/hublot).

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
| `delai_depasse` | 504 | La distillation a dépassé `DELAI_DISTILLATION_MS` |
| `surcharge` | 429 / 503 | Trop de requêtes, ou plus aucun ouvrier disponible |
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

```bash
npm run check:fix
```

## Conventions

Reprises du dépôt YieldMomo, voir [CLAUDE.md](CLAUDE.md) : Node 22, npm workspaces, TypeScript
strict, Biome, code et commentaires **en français sans accents dans les identifiants**, et des
commentaires qui n'expliquent que le *pourquoi*.
