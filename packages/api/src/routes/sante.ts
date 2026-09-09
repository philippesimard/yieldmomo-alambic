import { type Sante, SanteSchema, STATUT_SANTE, type StatutSante } from '@alambic/noyau'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { ouvriersVivants } from '../atelier/atelier'
import { env } from '../config/env'
import { sidecarCollectePret } from '../sidecars/collecte'
import { sidecarOcrPret } from '../sidecars/ocr'
import { VERSION } from '../version'

// Calcule une fois : process.uptime() derive de quelques millisecondes a chaque lecture, et une
// date de demarrage qui bouge d'une sonde a l'autre ne veut plus rien dire. Deduit de l'uptime
// plutot que releve ici, pour dater le demarrage du process et non le chargement du module.
const DEMARRE_LE = new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString()

// Ce qu'il faut pour distiller, et rien d'autre : des bras dans l'atelier et des moteurs
// charges. Des drapeaux en memoire, jamais un appel sortant — sonder ne doit rien couter ni
// pouvoir echouer.
function peutDistiller(): boolean {
  return ouvriersVivants() > 0 && sidecarOcrPret() && sidecarCollectePret()
}

function statut(): StatutSante {
  if (env.MODE_MAINTENANCE) return STATUT_SANTE.maintenance
  // Degrade des que le service n'est plus au complet : un moteur qui n'a pas fini de charger,
  // ou un ouvrier mort que l'atelier n'a pas encore remplace. Le code http dit s'il faut agir,
  // ce champ dit pourquoi.
  if (ouvriersVivants() < env.OUVRIERS) return STATUT_SANTE.degrade
  if (!sidecarOcrPret() || !sidecarCollectePret()) return STATUT_SANTE.degrade
  return STATUT_SANTE.ok
}

function sante(): Sante {
  return {
    statut: statut(),
    version: VERSION,
    horodatage: new Date().toISOString(),
    environnement: env.NODE_ENV,
    demarreLe: DEMARRE_LE,
    ouvriers: ouvriersVivants(),
    ouvriersAttendus: env.OUVRIERS,
    condensation: { pret: sidecarOcrPret() },
    collecte: { pret: sidecarCollectePret() },
  }
}

// Deux sondes distinctes, comme le veut la convention ops. Elles regardent le meme etat et ne
// different que par la question posee :
//  - /health (liveness)  : « faut-il redemarrer ce conteneur ? »
//  - /ready  (readiness) : « faut-il lui envoyer du trafic ? »
//
// Toute la maintenance tient dans cet ecart : /ready passe en 503 pour que le load balancer
// retire l'instance, /health reste en 200 pour que personne ne la redemarre. Un arret
// volontaire n'est pas une panne, et un conteneur qui redemarre en boucle pendant une
// maintenance serait le pire des deux mondes.
//
// Les deux rendent toujours un Sante complet, y compris en 503 — et non le { code, message }
// des erreurs de distillation. Un 503 de sonde est un etat, pas un echec de requete : le code
// http porte l'action ops, le corps porte le diagnostic, et l'appelant lit la meme forme quoi
// qu'il arrive.
export const routeSante: FastifyPluginAsyncZod = async (app) => {
  // Un etat de sante n'a jamais de sens dans un cache. Un hook plutot que deux en-tetes
  // posees a la main : le plugin est encapsule, il ne touche que ses propres routes.
  app.addHook('onRequest', async (_requete, reponse) => {
    reponse.header('cache-control', 'no-store')
  })

  const REPONSES = { 200: SanteSchema, 503: SanteSchema }

  // Un seau a part, et large. Sans lui les sondes partagent le plafond global avec le trafic
  // client : derriere un proxy, tout s'ecrase sur une seule clef d'ip, et il suffit d'une rafale
  // ordinaire pour qu'un 429 sur /health fasse redemarrer le conteneur et qu'un 429 sur /ready
  // le sorte du load balancer. Large mais pas absent : ces routes repondent sans authentification.
  const LIMITE_SONDES = { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }

  app.get(
    '/health',
    { ...LIMITE_SONDES, schema: { response: REPONSES } },
    async (_requete, reponse) => {
      // En maintenance le process va tres bien : repondre 200 empeche l'orchestrateur de
      // redemarrer un conteneur qu'un humain a volontairement mis de cote.
      if (env.MODE_MAINTENANCE) return reponse.send(sante())
      // Un atelier vide ou un moteur mort pour de bon est exactement la panne qu'un redemarrage
      // repare, et c'est cette sonde que surveille le HEALTHCHECK du Dockerfile.
      return peutDistiller() ? reponse.send(sante()) : reponse.code(503).send(sante())
    },
  )

  app.get(
    '/ready',
    { ...LIMITE_SONDES, schema: { response: REPONSES } },
    async (_requete, reponse) => {
      if (env.MODE_MAINTENANCE) return reponse.code(503).send(sante())
      return peutDistiller() ? reponse.send(sante()) : reponse.code(503).send(sante())
    },
  )
}
