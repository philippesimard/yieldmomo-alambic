import { ENVIRONNEMENT } from '@alambic/noyau'
import {
  type DestinationStream,
  destination,
  multistream,
  pino,
  type StreamEntry,
  transport,
} from 'pino'
import { env } from './config/env'
import { creerFluxGelf } from './journal-gelf'
import { VERSION } from './version'

const SERVICE = 'alambic'

// Le niveau d'un avertissement chez pino. Sert aux lignes que le flux GELF fait remonter, qui
// n'ont pas encore de logger sous la main.
const NIVEAU_AVERTISSEMENT = 40

// Les evenements que les tableaux de bord et les alertes interrogent. Le message, lui, part en
// short_message, analyse en texte integral : filtrer dessus serait fragile, un champ exact ne
// l'est pas.
export const EVENEMENT = {
  distillation: 'distillation',
  refus: 'refus',
  erreurNonGeree: 'erreurNonGeree',
  cleRefusee: 'cleRefusee',
  atelierDemarre: 'atelierDemarre',
  ouvrierExpire: 'ouvrierExpire',
  atelierEpuise: 'atelierEpuise',
  sidecarRelance: 'sidecarRelance',
  sidecarAbandonne: 'sidecarAbandonne',
  arret: 'arret',
} as const

export type Evenement = (typeof EVENEMENT)[keyof typeof EVENEMENT]

// pino-pretty est une devDependency, absente de l'image : la cible se resout par chaine, donc
// seul le developpement la charge. Un import statique casserait la production. En production,
// destination(1) reproduit exactement le flux par defaut de pino, que multistream remplace ici.
const sortieStandard: DestinationStream =
  env.NODE_ENV === ENVIRONNEMENT.development ? transport({ target: 'pino-pretty' }) : destination(1)

function signaler(message: string): void {
  sortieStandard.write(
    `${JSON.stringify({ level: NIVEAU_AVERTISSEMENT, time: Date.now(), msg: message })}\n`,
  )
}

const gelf =
  env.JOURNAL_GELF_HOTE !== undefined && env.JOURNAL_GELF_JETON !== undefined
    ? creerFluxGelf({
        hote: env.JOURNAL_GELF_HOTE,
        port: env.JOURNAL_GELF_PORT,
        jeton: env.JOURNAL_GELF_JETON,
        service: SERVICE,
        environnement: env.NODE_ENV,
        version: VERSION,
        signaler,
      })
    : undefined

// Le niveau se repete sur chaque entree : sans lui, multistream retombe sur `info` et
// LOG_LEVEL=debug cesserait silencieusement de fonctionner.
const cibles: StreamEntry<typeof env.LOG_LEVEL>[] = [
  { level: env.LOG_LEVEL, stream: sortieStandard },
]

if (gelf !== undefined) cibles.push({ level: env.LOG_LEVEL, stream: gelf.flux })

// Instance pino unique, partagee entre fastify (loggerInstance) et le code qui vit hors du
// cycle de vie du serveur (l'atelier) : un seul pipeline de logs.
export const journal = pino(
  {
    level: env.LOG_LEVEL,
    // La cle partagee vaut l'acces au service : elle n'apparait jamais en clair dans les logs,
    // meme quand fastify serialise une requete en erreur.
    redact: ['req.headers["x-cle-alambic"]', 'req.headers.authorization'],
  },
  multistream(cibles),
)

// Ne refuse pas le demarrage : ne pas pouvoir expedier ses logs n'empeche pas de lire des
// factures. C'est l'alerte « silence » du flux de donnees qui rattrape une cle oubliee, et elle
// couvre aussi le cas ou l'expedition tombe en cours de route.
if (gelf === undefined && env.NODE_ENV === ENVIRONNEMENT.production) {
  journal.warn('Aucun JOURNAL_GELF_HOTE : les logs ne quittent pas le conteneur.')
}

// Le SIGTERM de chaque deploiement emporterait sinon les dernieres lignes restees en file.
export async function viderJournal(): Promise<void> {
  await gelf?.vider()
}
