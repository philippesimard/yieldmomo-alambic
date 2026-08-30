import type { BlocTexte, ImageChauffee } from '@alambic/noyau'
import type { MoteurOcr } from './moteur'

// Moteur de remplacement, le temps de choisir le vrai. Il ne regarde pas l'image : il rend un
// recu plausible, cale sur les dimensions recues, pour que la Collecte ait de quoi mordre et
// que le pipeline soit verifiable de bout en bout des le premier lancement.
//
// A remplacer, pas a completer : le rendre plus malin en ferait un faux point de comparaison.
const LIGNES_FACTICES = [
  { texte: 'CAFE DU COIN', colonne: 0, part: 0.06 },
  { texte: '2026-08-30', colonne: 0, part: 0.14 },
  { texte: 'Cafe filtre', colonne: 0, part: 0.28 },
  { texte: '3,25', colonne: 1, part: 0.28 },
  { texte: 'Croissant', colonne: 0, part: 0.36 },
  { texte: '4,50', colonne: 1, part: 0.36 },
  { texte: 'Sous-total', colonne: 0, part: 0.52 },
  { texte: '7,75', colonne: 1, part: 0.52 },
  { texte: 'TPS 5%', colonne: 0, part: 0.6 },
  { texte: '0,39', colonne: 1, part: 0.6 },
  { texte: 'TVQ 9,975%', colonne: 0, part: 0.68 },
  { texte: '0,77', colonne: 1, part: 0.68 },
  { texte: 'TOTAL', colonne: 0, part: 0.8 },
  { texte: '8,91', colonne: 1, part: 0.8 },
] as const

const HAUTEUR_LIGNE = 28
const CONFIANCE_FACTICE = 0.9

export const moteurFactice: MoteurOcr = {
  nom: 'factice',
  lire: async (image: ImageChauffee): Promise<BlocTexte[]> =>
    LIGNES_FACTICES.map(({ texte, colonne, part }) => ({
      texte,
      cadre: {
        // Deux colonnes : les libelles a gauche, les montants alignes a droite. C'est cette
        // geometrie que la Collecte devra exploiter, donc le factice la reproduit.
        x: colonne === 0 ? image.largeur * 0.08 : image.largeur * 0.62,
        y: image.hauteur * part,
        largeur: texte.length * 14,
        hauteur: HAUTEUR_LIGNE,
      },
      confiance: CONFIANCE_FACTICE,
    })),
}
