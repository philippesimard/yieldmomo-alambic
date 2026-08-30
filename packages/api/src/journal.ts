import { pino } from 'pino'
import { ENVIRONNEMENT, env } from './config/env'

// Instance pino unique, partagee entre fastify (loggerInstance) et le code qui vit hors du
// cycle de vie du serveur (l'atelier) : un seul pipeline de logs.
export const journal = pino({
  level: env.LOG_LEVEL,
  // La cle partagee vaut l'acces au service : elle n'apparait jamais en clair dans les logs,
  // meme quand fastify serialise une requete en erreur.
  redact: ['req.headers["x-cle-alambic"]', 'req.headers.authorization'],
  transport: env.NODE_ENV === ENVIRONNEMENT.development ? { target: 'pino-pretty' } : undefined,
})
