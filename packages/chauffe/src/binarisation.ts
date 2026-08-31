import { apercusDe } from './apercus'
import type { Etat, Sortie } from './etat'
import { seuillerAdaptatif } from './seuil'

// Fenetre du voisinage, en fraction de la largeur. Assez large pour contenir plusieurs
// caracteres et leur papier, assez etroite pour qu'une ombre soit vue comme locale.
const PART_FENETRE = 0.05

// Bornes de ce que contient une photo de ticket lisible. En dessous, le seuillage a tout efface
// ou la photo etait vide ; au-dessus, il a noirci une ombre entiere.
const PART_ENCRE_BASSE = 0.02
const PART_ENCRE_HAUTE = 0.25

export async function binariser(etat: Etat): Promise<Sortie<Etat>> {
  const { binaire, partEncre } = seuillerAdaptatif(etat, PART_FENETRE)

  return {
    valeur: binaire,
    note: noteEncre(partEncre),
    motif: motifEncre(partEncre),
    apercus: apercusDe(binaire, {
      partEncre: Math.round(partEncre * 1000) / 1000,
      partFenetre: PART_FENETRE,
    }),
  }
}

function noteEncre(part: number): number {
  if (part < PART_ENCRE_BASSE) {
    return part / PART_ENCRE_BASSE
  }
  if (part > PART_ENCRE_HAUTE) {
    return Math.max(0, 1 - (part - PART_ENCRE_HAUTE) / (1 - PART_ENCRE_HAUTE))
  }
  return 1
}

function motifEncre(part: number): string | undefined {
  const pourcent = Math.round(part * 100)
  if (part < PART_ENCRE_BASSE) {
    return `Seulement ${pourcent} % de pixels d'encre après seuillage : l'image est quasi vide, l'OCR ne trouvera presque rien à lire.`
  }
  if (part > PART_ENCRE_HAUTE) {
    return `${pourcent} % de pixels d'encre après seuillage : une ombre ou un fond sombre a été pris pour du texte.`
  }
  return undefined
}
