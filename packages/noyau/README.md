# @alambic/noyau

Les **contrats** du système. Aucune logique de traitement : uniquement des types, des schémas
Zod, des constantes et la classe d'erreur.

Tous les autres packages en dépendent, et c'est le seul qu'ils ont le droit de partager. Deux
étapes ne se connaissent jamais directement — elles se parlent à travers les formes définies ici.

## Ce qu'on y trouve

| Fichier | Rôle |
|---|---|
| `chauffe.ts` | `ImageChauffee` — ce que la Chauffe rend à la Condensation |
| `condensat.ts` | `Condensat`, `BlocTexte`, `Cadre` — ce que la Condensation rend à la Collecte |
| `facture.ts` | `FactureSchema` — la sortie publique du système |
| `lignes.ts` | `grouperEnLignes` — regroupe des fragments de texte en lignes lisibles |
| `distillation.ts` | `Mesures` — le coût de chaque étape |
| `erreurs.ts` | `CODE_ERREUR`, `ErreurAlambic` |
| `sante.ts` | `SanteSchema` — la forme des sondes `/health` et `/ready` |

## Deux règles qui expliquent le reste

**Zod seulement sur la frontière HTTP.** `FactureSchema`, `ReponseErreurSchema` et `SanteSchema`
sont des schémas parce qu'ils partent sur le réseau et que Fastify les sérialise. Les frontières
internes (`ImageChauffee`, `Condensat`) sont de simples types TypeScript : elles ne franchissent
aucune limite de confiance, et les valider à l'exécution coûterait sur chaque distillation sans
rien prouver.

**Tout est nullable dans une facture.** Une photo froissée peut ne livrer qu'un total. Rendre une
facture partielle vaut mieux que refuser la requête — le consommateur sait compléter ce qui
manque. Chaque champ extrait porte sa confiance, pour qu'il sache aussi quoi faire confirmer.

`grouperEnLignes` vit ici et non dans une étape parce que **deux** étapes en ont besoin sans avoir
le droit de se connaître : la Condensation pour donner au condensat son ordre de lecture, la
Collecte pour rapprocher un libellé de son montant.
