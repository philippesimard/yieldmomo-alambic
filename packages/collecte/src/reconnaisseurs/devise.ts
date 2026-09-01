import type { BlocTexte, Facture } from '@alambic/noyau'
import { confianceDe, texteDe } from './commun'

// Codes ISO 4217 que les recus du marche vise impriment.
const DEVISE = {
  cad: 'CAD',
  usd: 'USD',
  eur: 'EUR',
  gbp: 'GBP',
} as const

const CODE_EXPLICITE = /\b(CAD|USD|EUR|GBP)\b/

// Symboles porteurs d'une devise identifiable. Le dollar seul n'y est pas : il ne distingue
// pas CAD de USD.
const SYMBOLES = [
  { symbole: 'US$', devise: DEVISE.usd },
  { symbole: '€', devise: DEVISE.eur },
  { symbole: '£', devise: DEVISE.gbp },
] as const

const DOLLAR = '$'

const FACTEUR_CODE = 0.9
const FACTEUR_SYMBOLE = 0.7

// Un « $ » seul est presque toujours CAD sur le marche vise, mais rien ne l'imprime : la
// confiance reste basse.
const FACTEUR_DOLLAR_SEUL = 0.4

export function reconnaitreDevise(lignes: readonly BlocTexte[][]): Facture['devise'] {
  let parSymbole: Facture['devise'] = null
  let parDollar: Facture['devise'] = null

  for (const ligne of lignes) {
    const texte = texteDe(ligne)

    const code = texte.match(CODE_EXPLICITE)?.[1]
    if (code !== undefined) {
      return { valeur: code, confiance: confianceDe(ligne) * FACTEUR_CODE }
    }

    if (parSymbole === null) {
      const trouve = SYMBOLES.find((candidat) => texte.includes(candidat.symbole))
      if (trouve !== undefined) {
        parSymbole = { valeur: trouve.devise, confiance: confianceDe(ligne) * FACTEUR_SYMBOLE }
      }
    }

    if (parDollar === null && texte.includes(DOLLAR)) {
      parDollar = { valeur: DEVISE.cad, confiance: confianceDe(ligne) * FACTEUR_DOLLAR_SEUL }
    }
  }

  return parSymbole ?? parDollar
}
