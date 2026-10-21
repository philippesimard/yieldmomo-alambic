import type { Facture } from './facture'

// Ce que la Collecte pense de ses propres montants : sur un recu, le sous-total, les taxes et le
// total se verifient l'un par l'autre (sous-total + taxes = total).
export const COHERENCE = {
  // Le bilan se ferme : les montants rendus se confirment entre eux.
  coherente: 'coherente',
  // Le bilan se verifie et ne se ferme pas : un montant rendu est faux, ou une ligne qui entre
  // dans le total (frais, pourboire) n'a pas ete lue.
  incoherente: 'incoherente',
  // Il manque le total ou le sous-total : rien a verifier.
  indeterminee: 'indeterminee',
} as const

export type Coherence = (typeof COHERENCE)[keyof typeof COHERENCE]

// La sortie de la Collecte. La facture part telle quelle au consommateur ; la coherence reste
// dans les mesures, comme la qualite de lecture de la Condensation.
export type Recolte = {
  facture: Facture
  coherence: Coherence
}
