import { apercusDe } from './apercus'
import { depuis, type Etat, enEtat, type Sortie } from './etat'

// Trois pixels, et pas davantage. Sur une image binaire le median efface les points isoles que
// le seuillage a laisses ; une fenetre plus large emporterait aussi les jambages fins d'un recu
// thermique, c'est-a-dire exactement ce qu'on cherche a lire.
const COTE = 3

export async function debruiter(etat: Etat): Promise<Sortie<Etat>> {
  const propre = await enEtat(depuis(etat).median(COTE))
  return { valeur: propre, apercus: apercusDe(propre, { cote: COTE }) }
}
