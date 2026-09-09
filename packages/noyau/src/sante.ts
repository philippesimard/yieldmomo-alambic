import { z } from 'zod'

// Etat global du service, seul champ que le consommateur a besoin de tester :
//  - ok          : le service distille au complet
//  - degrade     : il repond, mais l'atelier est incomplet ou un moteur n'est pas charge
//  - maintenance : arret volontaire, decide par la configuration
export const STATUT_SANTE = {
  ok: 'ok',
  degrade: 'degrade',
  maintenance: 'maintenance',
} as const

export type StatutSante = (typeof STATUT_SANTE)[keyof typeof STATUT_SANTE]

// Les environnements possibles. Ici et non dans la config de l'api : l'environnement sort dans
// la reponse des sondes, il fait donc partie du contrat que le consommateur lit, et une seule
// definition evite qu'il derive de celle qui valide NODE_ENV.
export const ENVIRONNEMENT = {
  development: 'development',
  production: 'production',
  test: 'test',
} as const

export type Environnement = (typeof ENVIRONNEMENT)[keyof typeof ENVIRONNEMENT]

export const SanteSchema = z.object({
  statut: z.enum(STATUT_SANTE),
  // Version du service. Le consommateur s'en sert pour savoir a quel contrat il parle, et pour
  // voir passer un deploiement sans avoir a le demander a qui que ce soit.
  version: z.string(),
  horodatage: z.iso.datetime(),
  environnement: z.enum(ENVIRONNEMENT),
  // Le demarrage plutot qu'une duree : une valeur fixe se compare d'une sonde a l'autre et
  // rend un redemarrage visible a l'oeil, la ou un compteur de secondes demande de le deduire.
  demarreLe: z.iso.datetime(),
  // Ouvriers vivants dans l'atelier, et le plafond configure. Compteurs en memoire, donc
  // lisibles meme par la sonde de liveness : les lire ne touche a rien d'externe et ne peut
  // pas echouer.
  ouvriers: z.number().int().nonnegative(),
  ouvriersAttendus: z.number().int().positive(),
  // Disponibilite par etape, sans le nom du moteur : quel moteur travaille derriere est un
  // detail d'implementation, et le publier obligerait a renegocier avec le consommateur le
  // jour ou on en change. Comme les compteurs, des drapeaux en memoire — sonder ne declenche
  // aucun appel vers les moteurs.
  condensation: z.object({ pret: z.boolean() }),
  collecte: z.object({ pret: z.boolean() }),
})

export type Sante = z.infer<typeof SanteSchema>
