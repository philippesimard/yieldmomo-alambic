import { type ChildProcess, spawn } from 'node:child_process'
import { journal } from '../journal'

// Meme philosophie que MORTS_TOLEREES dans l'atelier : un sidecar qui meurt en boucle est un
// sidecar qui ne demarrera jamais (python absent, modele introuvable, memoire epuisee). Le
// relancer sans compter cacherait la panne ; au-dela du seuil on abandonne, /ready reste en
// 503, et l'orchestrateur redemarre le conteneur.
const DEMARRAGES_TOLERES = 5
const FENETRE_DEMARRAGES_MS = 300_000

// Relance avec recul exponentiel : une mort isolee se repare vite, une panne durable ne merite
// pas d'etre martelee.
const RELANCE_INITIALE_MS = 1_000
const RELANCE_MAX_MS = 30_000

// Un sidecar ne prend son port qu'une fois le modele charge : la premiere reponse a la sonde
// vaut « pret ». Le chargement prend plusieurs secondes, d'ou une sonde patiente.
const INTERVALLE_SONDE_MS = 250
const DELAI_SONDE_MS = 1_000

// A l'arret : SIGTERM d'abord, puis la massue si le processus s'accroche.
const DELAI_SIGKILL_MS = 3_000

export type OptionsSuperviseur = {
  // Libelle des journaux ('sidecar-ocr', 'sidecar-collecte').
  nom: string
  // Faux quand le moteur configure est factice : rien a lancer, toujours pret.
  actif: boolean
  commande: string
  arguments: string[]
  urlSante: string
}

export type Superviseur = {
  demarrer(): void
  pret(): boolean
  arreter(): Promise<void>
}

// Fabrique et non module a etat global : deux sidecars vivent cote a cote, chacun avec son
// processus, sa sonde et son compteur de morts.
export function creerSuperviseur(options: OptionsSuperviseur): Superviseur {
  const journalSidecar = journal.child({ composant: options.nom })

  let processus: ChildProcess | null = null
  let pret = false
  let arretDemande = false
  let demarrages: number[] = []
  let attenteRelanceMs = RELANCE_INITIALE_MS
  let sonde: NodeJS.Timeout | null = null
  let relance: NodeJS.Timeout | null = null

  function demarrer(): void {
    if (!options.actif) return
    arretDemande = false
    demarrages = []
    lancer()
  }

  // Un moteur factice n'a pas de sidecar : il est toujours pret. La sonde de disponibilite lit
  // ce drapeau en memoire, elle ne declenche jamais d'appel vers le sidecar.
  function estPret(): boolean {
    return !options.actif || pret
  }

  async function arreter(): Promise<void> {
    arretDemande = true
    if (sonde !== null) clearTimeout(sonde)
    sonde = null
    if (relance !== null) clearTimeout(relance)
    relance = null

    const enfant = processus
    processus = null
    pret = false
    if (enfant === null) return

    await new Promise<void>((resoudre) => {
      const massue = setTimeout(() => enfant.kill('SIGKILL'), DELAI_SIGKILL_MS)
      enfant.once('exit', () => {
        clearTimeout(massue)
        resoudre()
      })
      enfant.kill('SIGTERM')
    })
  }

  function lancer(): void {
    pret = false
    const enfant = spawn(options.commande, options.arguments, { stdio: ['ignore', 'pipe', 'pipe'] })
    processus = enfant

    // Un sidecar ne journalise pas lui-meme : ses sorties passent par pino comme tout le
    // reste.
    enfant.stdout?.on('data', (morceau: Buffer) => relayer(morceau))
    enfant.stderr?.on('data', (morceau: Buffer) => relayer(morceau))

    // Sur un echec de spawn (python absent), 'error' peut arriver sans 'exit' : le garde evite
    // de compter la meme mort deux fois quand les deux evenements arrivent.
    let sortieTraitee = false
    const terminer = (code: number | null): void => {
      if (sortieTraitee) return
      sortieTraitee = true
      surSortie(code)
    }

    enfant.on('error', (erreur) => {
      journalSidecar.error({ err: erreur }, 'Sidecar impossible a lancer')
      terminer(null)
    })
    enfant.on('exit', (code) => terminer(code))

    sonder()
  }

  function relayer(morceau: Buffer): void {
    const texte = morceau.toString().trim()
    if (texte.length > 0) journalSidecar.info(texte)
  }

  function sonder(): void {
    if (sonde !== null) clearTimeout(sonde)
    sonde = setTimeout(async () => {
      sonde = null
      if (arretDemande || processus === null) return
      try {
        const reponse = await fetch(options.urlSante, {
          signal: AbortSignal.timeout(DELAI_SONDE_MS),
        })
        if (reponse.ok) {
          pret = true
          attenteRelanceMs = RELANCE_INITIALE_MS
          journalSidecar.info('Sidecar pret')
          return
        }
      } catch {
        // Pas encore pret : le port n'est pris qu'une fois le modele charge.
      }
      sonder()
    }, INTERVALLE_SONDE_MS)
  }

  function surSortie(code: number | null): void {
    pret = false
    processus = null
    if (sonde !== null) clearTimeout(sonde)
    sonde = null
    if (arretDemande) return

    const maintenant = Date.now()
    demarrages = [...demarrages, maintenant].filter(
      (instant) => maintenant - instant < FENETRE_DEMARRAGES_MS,
    )
    if (demarrages.length > DEMARRAGES_TOLERES) {
      journalSidecar.error(
        { demarrages: demarrages.length },
        'Sidecar mort trop souvent, relance abandonnee',
      )
      return
    }

    journalSidecar.warn({ code, relanceMs: attenteRelanceMs }, 'Sidecar arrete, relance')
    relance = setTimeout(() => {
      relance = null
      lancer()
    }, attenteRelanceMs)
    attenteRelanceMs = Math.min(attenteRelanceMs * 2, RELANCE_MAX_MS)
  }

  return { demarrer, pret: estPret, arreter }
}
