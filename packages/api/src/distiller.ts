import { chauffer } from '@alambic/chauffe'
import { collecter } from '@alambic/collecte'
import { condenser, moteurFactice } from '@alambic/condensation'
import type { Distillation } from '@alambic/noyau'

// Le moteur ocr, choisi en un seul endroit. Factice pour l'instant : le vrai se decidera sur
// mesures quand on attaquera la Condensation, et ne changera que cette ligne.
const MOTEUR = moteurFactice

// Arrondi au dixieme de milliseconde : la Collecte s'execute souvent en moins d'une
// milliseconde, et l'arrondi a l'entier la ferait disparaitre des mesures.
const arrondir = (ms: number): number => Math.round(ms * 10) / 10

// Les trois etapes, enchainees et chronometrees. Le seul endroit du depot qui les connait
// toutes les trois : aucune etape ne sait ce qui la precede ni ce qui la suit.
export async function distiller(original: Buffer): Promise<Distillation> {
  const debutChauffe = performance.now()
  const image = await chauffer(original)

  const debutCondensation = performance.now()
  const condensat = await condenser(image, MOTEUR)

  const debutCollecte = performance.now()
  const facture = collecter(condensat)
  const fin = performance.now()

  return {
    facture,
    mesures: {
      octets: original.byteLength,
      chauffeMs: arrondir(debutCondensation - debutChauffe),
      condensationMs: arrondir(debutCollecte - debutCondensation),
      collecteMs: arrondir(fin - debutCollecte),
      totalMs: arrondir(fin - debutChauffe),
    },
  }
}
