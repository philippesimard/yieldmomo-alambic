import type { MessagePort } from 'node:worker_threads'
import {
  type Apercu,
  type ApercuTransmis,
  type Etape,
  type EvenementTrace,
  GENRE_APERCU,
  STATUT_ETAPE,
  type Tracage,
} from '@alambic/noyau'
import { GENRE_MESSAGE, type MessageOuvrier } from './messages'

// Au centieme, la ou les Mesures de production s'arretent au dixieme : une sous-etape qui
// coute 0,04 ms doit rester comparable a sa voisine, sinon l'outil affiche des zeros la ou on
// vient justement chercher un ordre de grandeur.
const arrondir = (ms: number): number => Math.round(ms * 100) / 100

// Chronometre chaque sous-etape et poste son verdict au fil de l'eau. Le seul endroit du depot
// qui convertisse un Apercu (Buffer, naturel avec sharp) en ApercuTransmis (json, naturel pour
// un flux) : les etapes ignorent qu'un navigateur existe.
export function creerTracage(port: MessagePort) {
  // La sous-etape ouverte, retenue pour pouvoir la clore en erreur : une etape qui leve ne
  // ferme jamais la sienne, et sans ca elle resterait « en cours » a l'ecran pour toujours.
  let ouverte: { etape: Etape; sousEtape: string; debut: number } | null = null

  const poster = (evenement: EvenementTrace): void => {
    port.postMessage({ genre: GENRE_MESSAGE.trace, evenement } satisfies MessageOuvrier)
  }

  const tracage: Tracage = (etape) => ({
    demarrer: (sousEtape) => {
      const debut = performance.now()
      ouverte = { etape, sousEtape, debut }

      return (issue) => {
        ouverte = null
        poster({
          etape,
          sousEtape,
          statut: issue.statut,
          dureeMs: arrondir(performance.now() - debut),
          motif: issue.motif,
          apercus: (issue.apercus ?? []).map(transmettre),
        })
      }
    },
  })

  const echouer = (motif: string): void => {
    if (ouverte === null) return
    poster({
      etape: ouverte.etape,
      sousEtape: ouverte.sousEtape,
      statut: STATUT_ETAPE.enErreur,
      dureeMs: arrondir(performance.now() - ouverte.debut),
      motif,
      apercus: [],
    })
    ouverte = null
  }

  return { tracage, echouer }
}

function transmettre(apercu: Apercu): ApercuTransmis {
  if (apercu.genre !== GENRE_APERCU.image) return apercu
  return {
    genre: apercu.genre,
    base64: apercu.png.toString('base64'),
    largeur: apercu.largeur,
    hauteur: apercu.hauteur,
  }
}
