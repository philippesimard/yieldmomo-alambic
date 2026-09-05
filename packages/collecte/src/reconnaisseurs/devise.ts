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

// Un montant colle au symbole, avec ses decimales : c'est ce qui distingue le « $ » de
// « 12,50 $ » du « £ » qu'un ocr tire du « 9 » de « 9,975 % ».
const MONTANT_EN_TETE = /^\d{1,3}(?:[\s.,]\d{3})*[.,]\d{1,2}(?!\d)/
const MONTANT_EN_QUEUE = /\d[.,]\d{1,2}$/

const FACTEUR_CODE = 0.9
const FACTEUR_SYMBOLE = 0.7

// Un « $ » seul est presque toujours CAD sur le marche vise, mais rien ne l'imprime : la
// confiance reste basse.
const FACTEUR_DOLLAR_SEUL = 0.4

// Un symbole de devise annonce un montant : il en touche un, avant ou apres. L'exiger ecarte
// le « € » qu'un ocr tire d'un bord de papier et le « £ » qu'il tire d'un taux de taxe, qui
// suffisaient a faire passer un recu canadien pour un recu europeen.
function contreUnMontant(texte: string, symbole: string): boolean {
  let depart = texte.indexOf(symbole)
  while (depart !== -1) {
    const avant = texte.slice(0, depart).trimEnd()
    const apres = texte.slice(depart + symbole.length).trimStart()
    if (MONTANT_EN_TETE.test(apres) || MONTANT_EN_QUEUE.test(avant)) return true
    depart = texte.indexOf(symbole, depart + 1)
  }
  return false
}

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
      const trouve = SYMBOLES.find((candidat) => contreUnMontant(texte, candidat.symbole))
      if (trouve !== undefined) {
        parSymbole = { valeur: trouve.devise, confiance: confianceDe(ligne) * FACTEUR_SYMBOLE }
      }
    }

    if (parDollar === null && contreUnMontant(texte, DOLLAR)) {
      parDollar = { valeur: DEVISE.cad, confiance: confianceDe(ligne) * FACTEUR_DOLLAR_SEUL }
    }
  }

  return parSymbole ?? parDollar
}
