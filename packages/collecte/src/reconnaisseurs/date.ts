import type { BlocTexte, Facture } from '@alambic/noyau'
import { confianceDe, texteDe } from './commun'

// Une date lue dans un format sans ambiguite : annee en tete, ou mois ecrit en toutes lettres.
const FACTEUR_DATE_SURE = 0.9

// Jour et mois indistinguables (« 03/04/2026 ») : on suppose jour/mois, l'usage au Quebec, et
// la confiance en garde la trace.
const FACTEUR_DATE_AMBIGUE = 0.6

const ISO = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/
const JOUR_MOIS_ANNEE = /\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|\d{2})\b/
const JOUR_MOIS_ECRIT_ANNEE = /\b(\d{1,2})(?:er)?\s+([a-z]+)\.?\s+(20\d{2})\b/
const MOIS_ECRIT_JOUR_ANNEE = /\b([a-z]+)\.?\s+(\d{1,2}),?\s+(20\d{2})\b/

// La plage des signes combinants (U+0300 a U+036F), retires apres decomposition NFD.
const DIACRITIQUES = /[̀-ͯ]/g

// Mois francais et anglais, entiers et abreges, sans accents : le texte est deja normalise
// avant la recherche.
const MOIS: Record<string, number> = {
  janvier: 1,
  jan: 1,
  january: 1,
  fevrier: 2,
  fev: 2,
  feb: 2,
  february: 2,
  mars: 3,
  mar: 3,
  march: 3,
  avril: 4,
  avr: 4,
  apr: 4,
  april: 4,
  mai: 5,
  may: 5,
  juin: 6,
  jun: 6,
  june: 6,
  juillet: 7,
  juil: 7,
  jul: 7,
  july: 7,
  aout: 8,
  aug: 8,
  august: 8,
  septembre: 9,
  sept: 9,
  sep: 9,
  september: 9,
  octobre: 10,
  oct: 10,
  october: 10,
  novembre: 11,
  nov: 11,
  november: 11,
  decembre: 12,
  dec: 12,
  december: 12,
}

type DateLue = { valeur: string; facteur: number }

export function reconnaitreDate(lignes: readonly BlocTexte[][]): Facture['date'] {
  for (const ligne of lignes) {
    const lue = dateDe(texteDe(ligne))
    if (lue === null) continue
    return { valeur: lue.valeur, confiance: confianceDe(ligne) * lue.facteur }
  }
  return null
}

function dateDe(texte: string): DateLue | null {
  const normalise = texte.normalize('NFD').replace(DIACRITIQUES, '').toLowerCase()

  const iso = normalise.match(ISO)
  if (iso !== null) {
    const valeur = valider(Number(iso[1]), Number(iso[2]), Number(iso[3]))
    if (valeur !== null) return { valeur, facteur: FACTEUR_DATE_SURE }
  }

  const ecrite = dateEcrite(normalise)
  if (ecrite !== null) return ecrite

  return dateChiffree(normalise)
}

function dateEcrite(normalise: string): DateLue | null {
  const jourDabord = normalise.match(JOUR_MOIS_ECRIT_ANNEE)
  if (jourDabord !== null) {
    const mois = MOIS[jourDabord[2] ?? '']
    if (mois !== undefined) {
      const valeur = valider(Number(jourDabord[3]), mois, Number(jourDabord[1]))
      if (valeur !== null) return { valeur, facteur: FACTEUR_DATE_SURE }
    }
  }

  const moisDabord = normalise.match(MOIS_ECRIT_JOUR_ANNEE)
  if (moisDabord !== null) {
    const mois = MOIS[moisDabord[1] ?? '']
    if (mois !== undefined) {
      const valeur = valider(Number(moisDabord[3]), mois, Number(moisDabord[2]))
      if (valeur !== null) return { valeur, facteur: FACTEUR_DATE_SURE }
    }
  }

  return null
}

function dateChiffree(normalise: string): DateLue | null {
  const chiffres = normalise.match(JOUR_MOIS_ANNEE)
  if (chiffres === null) return null

  const premier = Number(chiffres[1])
  const second = Number(chiffres[2])
  const annee = anneeComplete(Number(chiffres[3]))

  // Un champ au-dela de 12 ne peut pas etre un mois : il tranche l'ordre a lui seul.
  if (premier > 12) {
    const valeur = valider(annee, second, premier)
    return valeur === null ? null : { valeur, facteur: FACTEUR_DATE_SURE }
  }
  if (second > 12) {
    const valeur = valider(annee, premier, second)
    return valeur === null ? null : { valeur, facteur: FACTEUR_DATE_SURE }
  }
  const valeur = valider(annee, second, premier)
  return valeur === null ? null : { valeur, facteur: FACTEUR_DATE_AMBIGUE }
}

// « 26 » s'imprime pour 2026 : les recus ne datent pas du siecle dernier.
function anneeComplete(annee: number): number {
  return annee < 100 ? 2000 + annee : annee
}

// La date part telle quelle dans un champ z.iso.date() : on garantit un vrai jour du
// calendrier, pas seulement une forme plausible.
function valider(annee: number, mois: number, jour: number): string | null {
  if (!Number.isInteger(annee) || !Number.isInteger(mois) || !Number.isInteger(jour)) return null
  const date = new Date(Date.UTC(annee, mois - 1, jour))
  if (
    date.getUTCFullYear() !== annee ||
    date.getUTCMonth() !== mois - 1 ||
    date.getUTCDate() !== jour
  ) {
    return null
  }
  return `${String(annee).padStart(4, '0')}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`
}
