import { createHash, timingSafeEqual } from 'node:crypto'
import { CODE_ERREUR } from '@alambic/noyau'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { env } from './config/env'

export const ENTETE_CLE = 'x-cle-alambic'

// preHandler des routes qui coutent du travail. Alambic n'a ni compte ni session : la seule
// question est « est-ce bien l'api de YieldMomo qui appelle ».
export async function exigerCle(requete: FastifyRequest, reponse: FastifyReply) {
  const attendue = env.ALAMBIC_CLE
  // Sans cle configuree, le service est ouvert. Impossible en production, ou le demarrage est
  // refuse (voir config/env.ts) ; assume en developpement, pour qu'un clone frais reponde a un
  // curl sans ceremonie.
  if (attendue === undefined) return

  const fournie = requete.headers[ENTETE_CLE]
  if (typeof fournie !== 'string' || !memeSecret(fournie, attendue)) {
    requete.log.warn({ url: requete.url }, 'Cle refusee')
    return reponse.code(401).send({ code: CODE_ERREUR.cleInvalide, message: 'Cle invalide.' })
  }
}

// On compare les empreintes et non les secrets : timingSafeEqual exige deux buffers de meme
// longueur et leve sinon, ce qui trahirait deja la longueur de la vraie cle. Une comparaison
// par === serait pire encore : elle s'arrete au premier octet different, et ce temps de reponse
// laisse deviner le secret octet par octet.
function memeSecret(fournie: string, attendue: string): boolean {
  return timingSafeEqual(empreinte(fournie), empreinte(attendue))
}

function empreinte(valeur: string): Buffer {
  return createHash('sha256').update(valeur).digest()
}
