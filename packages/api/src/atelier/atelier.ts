import { Worker } from 'node:worker_threads'
import { CODE_ERREUR, type Distillation, ErreurAlambic } from '@alambic/noyau'
import { env } from '../config/env'
import { journal } from '../journal'
import type { DemandeOuvrier, ReponseOuvrier } from './messages'

// Le bootstrap .mjs, et non ouvrier.ts directement : voir l'explication dans ce fichier. tsx
// est pour cette raison une dependance de production, pas un outil de developpement.
const CHEMIN_OUVRIER = new URL('./ouvrier.mjs', import.meta.url)

// Un ouvrier qui meurt sans avoir rien servi est presque toujours un ouvrier qui ne demarrera
// jamais : module casse, dependance absente, memoire epuisee. Le remplacer sans compter ferait
// tourner une boucle de creation a plein regime, qui brule un coeur en cachant la panne.
// Au-dela de ce seuil dans la fenetre, on cesse de remplacer : l'atelier se vide, /ready passe
// en 503, et l'orchestrateur redemarre le conteneur — ce qui est le bon sort d'un service qui
// ne peut plus rien servir.
const MORTS_TOLEREES = 10
const FENETRE_MORTS_MS = 60_000

// Combien de taches par ouvrier on accepte de garder en attente. Deux : assez pour absorber
// une rafale sans que la file devienne un moyen de faire patienter indefiniment. Au-dela on
// refuse tout de suite, ce qui est plus utile a l'appelant qu'une reponse qui n'arrive jamais.
const PROFONDEUR_FILE_PAR_OUVRIER = 2

type Promesse = {
  resoudre: (distillation: Distillation) => void
  rejeter: (erreur: unknown) => void
}

type Ouvrier = {
  worker: Worker
  tache: (Promesse & { minuterie: NodeJS.Timeout }) | null
}

let ouvriers: Ouvrier[] = []
let attente: (Promesse & { image: ArrayBuffer })[] = []
let arretDemande = false
let morts: number[] = []

export function demarrerAtelier(): void {
  arretDemande = false
  morts = []
  ouvriers = Array.from({ length: env.OUVRIERS }, creerOuvrier)
  journal.info({ ouvriers: ouvriers.length }, 'Atelier demarre')
}

// Le compte sert a la sonde de disponibilite : un Alambic sans ouvrier ne peut rien distiller,
// meme si son process repond encore.
export function ouvriersVivants(): number {
  return ouvriers.length
}

export async function arreterAtelier(): Promise<void> {
  arretDemande = true

  // Les taches encore en file n'auront jamais d'ouvrier : les refuser maintenant plutot que de
  // laisser leur requete pendre jusqu'a la sortie forcee.
  for (const tache of attente) {
    tache.rejeter(new ErreurAlambic(CODE_ERREUR.surcharge, 503, "L'atelier s'arrete."))
  }
  attente = []

  await Promise.all(ouvriers.map((ouvrier) => ouvrier.worker.terminate()))
  ouvriers = []
}

export function distillerDansAtelier(image: Buffer): Promise<Distillation> {
  if (arretDemande || ouvriers.length === 0) {
    return Promise.reject(
      new ErreurAlambic(CODE_ERREUR.surcharge, 503, 'Aucun ouvrier disponible.'),
    )
  }

  // Refuser vite plutot qu'accepter un travail qu'on ne peut pas faire : c'est la contre-
  // pression. Une file sans borne transformerait une surcharge passagere en effondrement,
  // chaque requete attendant derriere toutes les precedentes.
  if (attente.length >= ouvriers.length * PROFONDEUR_FILE_PAR_OUVRIER) {
    return Promise.reject(
      new ErreurAlambic(CODE_ERREUR.surcharge, 429, 'Trop de distillations en cours.'),
    )
  }

  return new Promise<Distillation>((resoudre, rejeter) => {
    attente.push({ image: detacher(image), resoudre, rejeter })
    servirAttente()
  })
}

// Le buffer rendu par fastify est presque toujours seul proprietaire de son ArrayBuffer :
// au-dela de 8 Ko, Node cesse de tailler dans son pool interne. On le transfere alors sans le
// copier. Le cas contraire existe pourtant, et transferer un ArrayBuffer partage emporterait
// la memoire des buffers voisins : on copie dans ce cas, ce qui ne coute que sur une image
// minuscule, qu'aucun recu reel ne produit.
function detacher(image: Buffer): ArrayBuffer {
  const debut = image.byteOffset
  const fin = debut + image.byteLength
  // Assertion sure : un Buffer de fastify n'est jamais adosse a un SharedArrayBuffer, et
  // slice() d'un ArrayBuffer rend un ArrayBuffer.
  if (debut === 0 && image.byteLength === image.buffer.byteLength) {
    return image.buffer as ArrayBuffer
  }
  return image.buffer.slice(debut, fin) as ArrayBuffer
}

function servirAttente(): void {
  while (attente.length > 0) {
    const ouvrier = ouvriers.find((candidat) => candidat.tache === null)
    if (ouvrier === undefined) return

    const tache = attente.shift()
    if (tache === undefined) return

    affecter(ouvrier, tache)
  }
}

function affecter(ouvrier: Ouvrier, tache: Promesse & { image: ArrayBuffer }): void {
  const minuterie = setTimeout(() => {
    ouvrier.tache = null
    tache.rejeter(
      new ErreurAlambic(CODE_ERREUR.delaiDepasse, 504, 'La distillation a pris trop de temps.'),
    )
    // Un ouvrier qui depasse le delai est peut-etre bloque dans une boucle : on ne peut pas
    // lui demander d'abandonner, seulement le tuer. Le gestionnaire 'exit' le remplacera.
    journal.warn({ delaiMs: env.DELAI_DISTILLATION_MS }, 'Ouvrier expire, remplacement')
    void ouvrier.worker.terminate()
  }, env.DELAI_DISTILLATION_MS)

  ouvrier.tache = { resoudre: tache.resoudre, rejeter: tache.rejeter, minuterie }
  // transferList : sans elle, postMessage recopierait plusieurs megaoctets a chaque requete.
  ouvrier.worker.postMessage({ image: tache.image } satisfies DemandeOuvrier, [tache.image])
}

function creerOuvrier(): Ouvrier {
  const ouvrier: Ouvrier = { worker: new Worker(CHEMIN_OUVRIER), tache: null }

  ouvrier.worker.on('message', (reponse: ReponseOuvrier) => {
    const tache = ouvrier.tache
    if (tache === null) return
    clearTimeout(tache.minuterie)
    ouvrier.tache = null

    if (reponse.ok) tache.resoudre(reponse.distillation)
    else tache.rejeter(new ErreurAlambic(reponse.code, reponse.statut, reponse.message))

    servirAttente()
  })

  // Une erreur non rattrapee dans le thread : le worker est perdu, 'exit' suit immediatement.
  ouvrier.worker.on('error', (erreur) => {
    journal.error({ err: erreur }, 'Ouvrier en erreur')
  })

  ouvrier.worker.on('exit', () => retirer(ouvrier))

  return ouvrier
}

// Un ouvrier qui meurt emporte la tache qu'il portait, et doit etre remplace : sans ce
// remplacement l'atelier se viderait en silence sous la charge, jusqu'a ne plus rien servir.
function retirer(ouvrier: Ouvrier): void {
  const tache = ouvrier.tache
  if (tache !== null) {
    clearTimeout(tache.minuterie)
    ouvrier.tache = null
    tache.rejeter(new ErreurAlambic(CODE_ERREUR.erreurInterne, 500, "L'ouvrier s'est arrete."))
  }

  ouvriers = ouvriers.filter((candidat) => candidat !== ouvrier)
  if (arretDemande) return

  const maintenant = Date.now()
  morts = [...morts, maintenant].filter((instant) => maintenant - instant < FENETRE_MORTS_MS)
  if (morts.length > MORTS_TOLEREES) {
    journal.error(
      { morts: morts.length, ouvriers: ouvriers.length },
      'Trop d ouvriers morts, remplacement abandonne',
    )
    return
  }

  ouvriers.push(creerOuvrier())
  journal.warn({ ouvriers: ouvriers.length }, 'Ouvrier remplace')
  servirAttente()
}
