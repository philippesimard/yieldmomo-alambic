import { grouperEnLignes, type ImageChauffee } from '@alambic/noyau'
import { ETIQUETTE, type MotEtiquete } from './etiquettes'
import { MARQUEURS_ECARTES, MARQUEURS_MONTANT, MARQUEURS_TOTAL } from './marqueurs'
import { montantDe } from './montant'
import type { MoteurEtiquetage } from './moteur'
import type { Mot } from './mots'

const SCORE_FACTICE = 0.9

// Moteur de remplacement, sans modele ni sidecar : il etiquette le montant de la derniere
// ligne marquee « total », rien d'autre. Le mode factice traverse ainsi le meme chemin de
// reconstruction que le vrai moteur, au lieu d'un chemin parallele qui ne prouverait rien.
//
// A remplacer, pas a completer : le rendre plus malin en ferait un faux point de comparaison.
export const moteurFacticeEtiquetage: MoteurEtiquetage = {
  nom: 'factice',
  etiqueter: async (mots: readonly Mot[], _image: ImageChauffee): Promise<MotEtiquete[]> => {
    const porteur = motDuTotal(mots)
    return mots.map((mot) => ({
      ...mot,
      etiquette: mot === porteur ? ETIQUETTE.total : ETIQUETTE.exterieur,
      debut: mot === porteur,
      score: SCORE_FACTICE,
    }))
  },
}

function motDuTotal(mots: readonly Mot[]): Mot | null {
  // La derniere ligne qui porte un marqueur, pas la premiere : un recu imprime souvent un
  // rappel du total en tete, et c'est le pied de ticket qui fait foi.
  for (const ligne of grouperEnLignes(mots).reverse()) {
    const texte = ligne.map((mot) => mot.texte).join(' ')
    if (marqueurDe(texte) === null) continue
    const porteur = [...ligne].reverse().find((mot) => montantDe(mot.texte) !== null)
    if (porteur !== undefined) return porteur
  }
  return null
}

function marqueurDe(texte: string): string | null {
  const normalise = texte.toLowerCase()
  if (MARQUEURS_ECARTES.some((marqueur) => normalise.includes(marqueur))) return null
  return (
    MARQUEURS_TOTAL.find((marqueur) => normalise.includes(marqueur)) ??
    MARQUEURS_MONTANT.find((marqueur) => normalise.includes(marqueur)) ??
    null
  )
}
