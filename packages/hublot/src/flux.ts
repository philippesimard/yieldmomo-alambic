import type { FastifyReply } from 'fastify'

// Un flux d'evenements envoyes par le serveur, sur la reponse d'un POST ordinaire.
//
// hijack() : sans lui, fastify voudrait serialiser la reponse a la fin du gestionnaire, et un
// flux n'a pas de forme finale a serialiser. On prend la main sur le socket, et fastify cesse
// de s'en occuper.
//
// Pas de heartbeat : le flux dure le temps d'une distillation, bornee par le delai de
// l'atelier. Aucun intermediaire n'a le temps de couper une connexion aussi courte.
export function ouvrirFlux(reponse: FastifyReply) {
  reponse.hijack()
  reponse.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    // Un proxy qui tamponne rendrait tout le flux d'un bloc a la fin, ce qui annulerait le
    // seul interet de l'envoyer au fil de l'eau.
    'x-accel-buffering': 'no',
  })

  return {
    envoyer: (objet: unknown): void => {
      reponse.raw.write(`data: ${JSON.stringify(objet)}\n\n`)
    },
    fermer: (): void => {
      reponse.raw.end()
    },
  }
}
