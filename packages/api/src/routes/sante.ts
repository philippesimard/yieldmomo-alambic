import { CODE_ERREUR, ReponseErreurSchema, type Sante, SanteSchema } from '@alambic/noyau'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { ouvriersVivants } from '../atelier/atelier'

function sante(): Sante {
  return {
    statut: 'ok',
    horodatage: new Date().toISOString(),
    ouvriers: ouvriersVivants(),
  }
}

// Deux sondes distinctes, comme le veut la convention ops :
//  - /health (liveness)  : le process repond. Ne touche a rien d'externe, sinon un
//                          orchestrateur redemarrerait le service pour une panne voisine.
//  - /ready  (readiness) : le service peut reellement travailler, donc l'atelier a des bras.
// La ou une api adossee a une base sonde sa base, Alambic sonde ses ouvriers : sans eux il ne
// peut rien distiller, meme si son process repond encore.
export const routeSante: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    { schema: { response: { 200: SanteSchema } } },
    async (): Promise<Sante> => sante(),
  )

  app.get(
    '/ready',
    { schema: { response: { 200: SanteSchema, 503: ReponseErreurSchema } } },
    async (_requete, reponse) => {
      // Un etat de sante n'a jamais de sens dans un cache.
      reponse.header('cache-control', 'no-store')
      if (ouvriersVivants() === 0) {
        return reponse
          .code(503)
          .send({ code: CODE_ERREUR.surcharge, message: "Aucun ouvrier dans l'atelier." })
      }
      return reponse.send(sante())
    },
  )
}
