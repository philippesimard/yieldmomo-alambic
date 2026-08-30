import { z } from 'zod'

export const SanteSchema = z.object({
  statut: z.literal('ok'),
  horodatage: z.iso.datetime(),
  // Ouvriers vivants dans l'atelier. Compteur en memoire, donc lisible meme par la sonde de
  // liveness : la lire ne touche a rien d'externe et ne peut pas echouer.
  ouvriers: z.number().int().nonnegative(),
})

export type Sante = z.infer<typeof SanteSchema>
