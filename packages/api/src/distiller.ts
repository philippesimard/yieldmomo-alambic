import { chauffer, SOUS_ETAPES_CHAUFFE } from '@alambic/chauffe'
import {
  collecter,
  creerMoteurLayoutlm,
  moteurFacticeEtiquetage,
  SOUS_ETAPES_COLLECTE,
} from '@alambic/collecte'
import {
  condenser,
  creerMoteurPaddle,
  moteurFactice,
  SOUS_ETAPES_CONDENSATION,
} from '@alambic/condensation'
import { type Distillation, ETAPE, type PlanPipeline, type Tracage } from '@alambic/noyau'
import { env, MOTEUR_COLLECTE, MOTEUR_OCR } from './config/env'

// Les moteurs, choisis par la configuration et non par le code : le thread principal (qui
// lance ou non les sidecars) et les ouvriers (qui construisent les clients) doivent partager
// le meme choix, et la config est le seul endroit qui parle aux deux.
const MOTEURS_OCR = {
  [MOTEUR_OCR.factice]: moteurFactice,
  [MOTEUR_OCR.paddleocr]: creerMoteurPaddle({
    url: `http://127.0.0.1:${env.PORT_SIDECAR_OCR}`,
    delaiMs: env.DELAI_OCR_MS,
  }),
} as const

const MOTEUR_LECTURE = MOTEURS_OCR[env.MOTEUR_OCR]

const MOTEURS_ETIQUETAGE = {
  [MOTEUR_COLLECTE.factice]: moteurFacticeEtiquetage,
  [MOTEUR_COLLECTE.layoutlmv3]: creerMoteurLayoutlm({
    url: `http://127.0.0.1:${env.PORT_SIDECAR_COLLECTE}`,
    delaiMs: env.DELAI_COLLECTE_MS,
  }),
} as const

const MOTEUR_ETIQUETAGE = MOTEURS_ETIQUETAGE[env.MOTEUR_COLLECTE]

// Arrondi au dixieme de milliseconde : les etapes les plus courtes (aux moteurs factices)
// disparaitraient des mesures avec un arrondi a l'entier.
const arrondir = (ms: number): number => Math.round(ms * 10) / 10

// Ce fichier etant le seul du depot qui connaisse les trois etapes, c'est lui qui decrit le
// pipeline a qui voudrait le lire. Assemble depuis ce que les packages exportent : ajouter une
// etape se paie ici, et nulle part ailleurs.
export const PLAN_PIPELINE: PlanPipeline = {
  fanions: [
    'Chauffe instrumentée',
    `Moteur OCR : ${MOTEUR_LECTURE.nom}`,
    `Moteur collecte : ${MOTEUR_ETIQUETAGE.nom}`,
  ],
  produit: { nom: 'Facture rendue', schema: 'FactureSchema' },
  etapes: [
    {
      etape: ETAPE.chauffe,
      entree: 'Buffer',
      sortie: 'ImageChauffee',
      sousEtapes: [...SOUS_ETAPES_CHAUFFE],
    },
    {
      etape: ETAPE.condensation,
      entree: 'ImageChauffee',
      sortie: 'Condensat',
      sousEtapes: [...SOUS_ETAPES_CONDENSATION],
    },
    {
      etape: ETAPE.collecte,
      entree: 'Condensat + ImageChauffee',
      sortie: 'Facture',
      sousEtapes: [...SOUS_ETAPES_COLLECTE],
    },
  ],
}

// Les trois etapes, enchainees et chronometrees. Le seul endroit du depot qui les connait
// toutes les trois : aucune etape ne sait ce qui la precede ni ce qui la suit.
//
// Sans tracage, chaque etape recoit `undefined` et n'instrumente rien : le chemin de
// production ne paie pas l'observation.
export async function distiller(original: Buffer, tracage?: Tracage): Promise<Distillation> {
  const debutChauffe = performance.now()
  const image = await chauffer(original, tracage?.(ETAPE.chauffe))

  const debutCondensation = performance.now()
  const condensat = await condenser(image, MOTEUR_LECTURE, tracage?.(ETAPE.condensation))

  const debutCollecte = performance.now()
  const facture = await collecter(condensat, image, MOTEUR_ETIQUETAGE, tracage?.(ETAPE.collecte))
  const fin = performance.now()

  return {
    facture,
    mesures: {
      octets: original.byteLength,
      qualite: image.qualite,
      chauffeMs: arrondir(debutCondensation - debutChauffe),
      condensationMs: arrondir(debutCollecte - debutCondensation),
      collecteMs: arrondir(fin - debutCollecte),
      totalMs: arrondir(fin - debutChauffe),
    },
  }
}
