import { parentPort } from 'node:worker_threads'
import { CODE_ERREUR, ErreurAlambic } from '@alambic/noyau'
import { distiller } from '../distiller'
import {
  type DemandeOuvrier,
  type EchecOuvrier,
  GENRE_MESSAGE,
  type MessageOuvrier,
} from './messages'
import { creerTracage } from './traceur'

// Ce fichier n'est jamais importe par le serveur : il est le point d'entree d'un thread. Si
// parentPort est nul, c'est qu'il a ete lance comme un programme ordinaire, par erreur.
if (parentPort === null) {
  throw new Error('ouvrier.ts doit etre lance comme worker_thread, pas comme programme.')
}

const port = parentPort

port.on('message', async ({ image, trace }: DemandeOuvrier) => {
  const tracage = trace === true ? creerTracage(port) : undefined

  try {
    // L'ArrayBuffer a ete transfere, pas copie : on le rehabille en Buffer sans le recopier
    // non plus.
    const distillation = await distiller(Buffer.from(image), tracage?.tracage)
    port.postMessage({ genre: GENRE_MESSAGE.fin, distillation } satisfies MessageOuvrier)
  } catch (erreur) {
    const echec = aPlat(erreur)
    // L'etape qui a leve n'a pas ferme sa sous-etape : on la clot en erreur AVANT de poster
    // l'echec, pour que le lecteur sache OU la distillation s'est arretee.
    tracage?.echouer(echec.message)
    port.postMessage(echec satisfies MessageOuvrier)
  }
})

function aPlat(erreur: unknown): EchecOuvrier {
  if (erreur instanceof ErreurAlambic) {
    return {
      genre: GENRE_MESSAGE.echec,
      code: erreur.code,
      statut: erreur.statut,
      message: erreur.message,
    }
  }
  // Le message reel plutot qu'un texte generique : le serveur le journalise, et c'est lui qui
  // decide de ne pas le montrer au consommateur (voir le gestionnaire d'erreurs).
  return {
    genre: GENRE_MESSAGE.echec,
    code: CODE_ERREUR.erreurInterne,
    statut: 500,
    message: erreur instanceof Error ? erreur.message : String(erreur),
  }
}
