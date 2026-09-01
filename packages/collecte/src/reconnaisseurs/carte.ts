import { type BlocTexte, type Facture, TYPE_CARTE } from '@alambic/noyau'
import { confianceDe, texteDe } from './commun'

// Marques telles qu'elles s'impriment sur les recus de terminal de paiement.
const MARQUES = [
  { motif: /\bVISA\b/i, type: TYPE_CARTE.visa },
  { motif: /\bMASTER\s?CARD\b/i, type: TYPE_CARTE.mastercard },
  { motif: /\bAMEX\b|\bAMERICAN\s+EXPRESS\b/i, type: TYPE_CARTE.amex },
  { motif: /\bINTERAC\b/i, type: TYPE_CARTE.interac },
] as const

// « MC » seul est trop ambigu pour valoir mastercard sans un contexte de paiement sur la meme
// ligne : ce sont aussi les initiales d'un caissier ou d'un produit.
const MC_SEUL = /\bMC\b/
const CONTEXTE_PAIEMENT = /carte|card|credit|debit|paiement|payment/i

// « DEBIT » sans marque : au Canada, le debit passe par Interac dans la quasi-totalite des
// cas, mais c'est une deduction de marche, pas une lecture.
const DEBIT_SEUL = /\bDEBIT\b/i

const FACTEUR_MARQUE = 0.9
const FACTEUR_DEBIT = 0.6
const FACTEUR_CONTEXTE = 0.5

export function reconnaitreCarte(lignes: readonly BlocTexte[][]): Facture['carte'] {
  let parDebit: Facture['carte'] = null
  let parContexte: Facture['carte'] = null

  for (const ligne of lignes) {
    const texte = texteDe(ligne)

    const marque = MARQUES.find((candidat) => candidat.motif.test(texte))
    if (marque !== undefined) {
      return { valeur: marque.type, confiance: confianceDe(ligne) * FACTEUR_MARQUE }
    }
    if (MC_SEUL.test(texte) && CONTEXTE_PAIEMENT.test(texte)) {
      return { valeur: TYPE_CARTE.mastercard, confiance: confianceDe(ligne) * FACTEUR_MARQUE }
    }

    if (parDebit === null && DEBIT_SEUL.test(texte)) {
      parDebit = { valeur: TYPE_CARTE.interac, confiance: confianceDe(ligne) * FACTEUR_DEBIT }
    }
    if (parContexte === null && CONTEXTE_PAIEMENT.test(texte)) {
      parContexte = { valeur: TYPE_CARTE.autre, confiance: confianceDe(ligne) * FACTEUR_CONTEXTE }
    }
  }

  // Comptant ou rien de lisible : null. Un contexte carte sans marque vaut `autre`, le debit
  // sans marque vaut interac — dans cet ordre, le plus precis d'abord.
  return parDebit ?? parContexte
}
