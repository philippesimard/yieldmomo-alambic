import { z } from 'zod'

export const SanteSchema = z.object({
  statut: z.literal('ok'),
  horodatage: z.iso.datetime(),
  // Ouvriers vivants dans l'atelier. Compteur en memoire, donc lisible meme par la sonde de
  // liveness : la lire ne touche a rien d'externe et ne peut pas echouer.
  ouvriers: z.number().int().nonnegative(),
  // Etat des moteurs, purement diagnostique : le consommateur ne teste que `statut`. Comme
  // `ouvriers`, des drapeaux en memoire — la sonde ne declenche aucun appel vers les moteurs.
  moteurOcr: z.object({ nom: z.string(), pret: z.boolean() }),
  moteurCollecte: z.object({ nom: z.string(), pret: z.boolean() }),
})

export type Sante = z.infer<typeof SanteSchema>
