import { chauffer, SOUS_ETAPES_CHAUFFE } from '@alambic/chauffe'
import { collecter, SOUS_ETAPES_COLLECTE } from '@alambic/collecte'
import {
  condenser,
  creerMoteurPaddle,
  moteurFactice,
  SOUS_ETAPES_CONDENSATION,
} from '@alambic/condensation'
import { type Distillation, ETAPE, type PlanPipeline, type Tracage } from '@alambic/noyau'
import { env, MOTEUR_OCR } from './config/env'

// Le moteur ocr, choisi par la configuration et non par le code : le thread principal (qui
// lance ou non le sidecar) et les ouvriers (qui construisent le client) doivent partager le
// meme choix, et la config est le seul endroit qui parle aux deux.
const MOTEURS = {
  [MOTEUR_OCR.factice]: moteurFactice,
  [MOTEUR_OCR.paddleocr]: creerMoteurPaddle({
    url: `http://127.0.0.1:${env.PORT_SIDECAR_OCR}`,
    delaiMs: env.DELAI_OCR_MS,
  }),
} as const

const MOTEUR = MOTEURS[env.MOTEUR_OCR]

// Arrondi au dixieme de milliseconde : la Collecte s'execute souvent en moins d'une
// milliseconde, et l'arrondi a l'entier la ferait disparaitre des mesures.
const arrondir = (ms: number): number => Math.round(ms * 10) / 10

// Ce fichier etant le seul du depot qui connaisse les trois etapes, c'est lui qui decrit le
// pipeline a qui voudrait le lire. Assemble depuis ce que les packages exportent : ajouter une
// etape se paie ici, et nulle part ailleurs.
export const PLAN_PIPELINE: PlanPipeline = {
  fanions: ['Chauffe instrumentée', `Moteur OCR : ${MOTEUR.nom}`],
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
      entree: 'Condensat',
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
  const condensat = await condenser(image, MOTEUR, tracage?.(ETAPE.condensation))

  const debutCollecte = performance.now()
  const facture = collecter(condensat, tracage?.(ETAPE.collecte))
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
