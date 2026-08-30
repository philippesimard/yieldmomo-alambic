import { parentPort } from 'node:worker_threads'
import { CODE_ERREUR, ErreurAlambic } from '@alambic/noyau'
import { distiller } from '../distiller'
import type { DemandeOuvrier, ReponseOuvrier } from './messages'

// Ce fichier n'est jamais importe par le serveur : il est le point d'entree d'un thread. Si
// parentPort est nul, c'est qu'il a ete lance comme un programme ordinaire, par erreur.
if (parentPort === null) {
  throw new Error('ouvrier.ts doit etre lance comme worker_thread, pas comme programme.')
}

const port = parentPort

port.on('message', async ({ image }: DemandeOuvrier) => {
  try {
    // L'ArrayBuffer a ete transfere, pas copie : on le rehabille en Buffer sans le recopier
    // non plus.
    const distillation = await distiller(Buffer.from(image))
    port.postMessage({ ok: true, distillation } satisfies ReponseOuvrier)
  } catch (erreur) {
    port.postMessage(aPlat(erreur) satisfies ReponseOuvrier)
  }
})

function aPlat(erreur: unknown): ReponseOuvrier {
  if (erreur instanceof ErreurAlambic) {
    return { ok: false, code: erreur.code, statut: erreur.statut, message: erreur.message }
  }
  // Le message reel plutot qu'un texte generique : le serveur le journalise, et c'est lui qui
  // decide de ne pas le montrer au consommateur (voir le gestionnaire d'erreurs).
  return {
    ok: false,
    code: CODE_ERREUR.erreurInterne,
    statut: 500,
    message: erreur instanceof Error ? erreur.message : String(erreur),
  }
}
