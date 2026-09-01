import type { BlocTexte, Facture } from '@alambic/noyau'
import { confianceDe, texteDe } from './commun'

// Les toutes premieres lignes seulement : c'est la que s'imprime l'enseigne. Plus bas, on
// tomberait sur l'adresse, les articles, le pied de ticket.
const LIGNES_EXAMINEES = 5

// L'heuristique reconnait « une ligne qui ressemble a un nom », pas un nom certifie : la
// confiance en garde la trace.
const FACTEUR_HEURISTIQUE = 0.7

const LETTRES_MINIMUM = 3

// Sept chiffres et plus : un telephone, un numero de transaction — rien qui nomme un commerce.
const CHIFFRES_MAXIMUM = 6

const LETTRE = /\p{L}/gu
const CHIFFRE = /\d/g

export function reconnaitreMarchand(lignes: readonly BlocTexte[][]): Facture['marchand'] {
  for (const ligne of lignes.slice(0, LIGNES_EXAMINEES)) {
    const texte = texteDe(ligne)
    if (!nommable(texte)) continue
    return { valeur: texte, confiance: confianceDe(ligne) * FACTEUR_HEURISTIQUE }
  }
  return null
}

// Une ligne nommable est surtout faite de lettres : une date, un montant, un telephone ou une
// adresse numerotee sont domines par leurs chiffres.
function nommable(texte: string): boolean {
  const lettres = texte.match(LETTRE)?.length ?? 0
  const chiffres = texte.match(CHIFFRE)?.length ?? 0
  return lettres >= LETTRES_MINIMUM && chiffres <= CHIFFRES_MAXIMUM && lettres > chiffres
}
