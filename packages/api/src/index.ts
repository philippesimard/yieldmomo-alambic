import { arreterAtelier, demarrerAtelier } from './atelier/atelier'
import { env } from './config/env'
import { construireServeur } from './serveur'
import { arreterSidecarCollecte, demarrerSidecarCollecte } from './sidecars/collecte'
import { arreterSidecarOcr, demarrerSidecarOcr } from './sidecars/ocr'

// Au-dela de ce delai, on cesse d'attendre les requetes en cours et on sort en echec : un arret
// qui pend finit tue par SIGKILL, sans trace de ce qui bloquait.
const DELAI_ARRET_MS = 10_000

const app = await construireServeur()

// Les sidecars d'abord : leurs modeles mettent plusieurs secondes a charger, autant payer ce
// temps pendant que l'atelier se met en place. /ready reste en 503 tant qu'ils ne sont pas
// prets.
demarrerSidecarOcr()
demarrerSidecarCollecte()

// L'atelier AVANT l'ecoute : accepter du trafic avant que les ouvriers soient la, c'est
// repondre 503 aux premieres requetes de chaque deploiement.
demarrerAtelier()

app.listen({ host: env.HOST, port: env.PORT }).catch((erreur) => {
  app.log.error(erreur)
  process.exit(1)
})

// Docker envoie SIGTERM au deploiement : on laisse les distillations en cours se terminer au
// lieu de les couper net.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'Arret demande, fermeture du serveur')
    // unref : cette minuterie ne doit pas maintenir le process en vie si tout se ferme vite.
    setTimeout(() => {
      app.log.error('Arret trop long, sortie forcee')
      process.exit(1)
    }, DELAI_ARRET_MS).unref()

    // L'atelier ferme APRES le serveur : les requetes en cours attendent encore leur ouvrier.
    // Les sidecars ferment en dernier : des ouvriers peuvent avoir des appels en vol.
    app
      .close()
      .then(() => arreterAtelier())
      .then(() => Promise.all([arreterSidecarOcr(), arreterSidecarCollecte()]))
      .then(
        () => process.exit(0),
        (erreur) => {
          app.log.error(erreur)
          process.exit(1)
        },
      )
  })
}
