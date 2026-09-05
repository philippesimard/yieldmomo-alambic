import type { BlocTexte, Facture } from '@alambic/noyau'
import { confianceDe, texteDe } from './commun'

// Le haut du ticket seulement : c'est la que s'imprime l'enseigne. Plus bas, on tomberait sur
// l'adresse, les articles, le pied de ticket. La fenetre depasse la douzaine de lignes parce
// que le bloc MEV du Quebec s'imprime AVANT l'enseigne et en mange la moitie — ce qu'on y
// gagne ne coute rien, les lignes ecartees l'etant sur leur forme et non sur leur rang.
const LIGNES_EXAMINEES = 12

// L'heuristique reconnait « une ligne qui ressemble a un nom », pas un nom certifie : la
// confiance en garde la trace.
const FACTEUR_HEURISTIQUE = 0.7

const LETTRES_MINIMUM = 3

// Sept chiffres et plus : un telephone, un numero de transaction — rien qui nomme un commerce.
const CHIFFRES_MAXIMUM = 6

const LETTRE = /\p{L}/gu
const CHIFFRE = /\d/g

// Le bloc MEV que la loi impose aux recus du Quebec s'imprime en xml, souvent en tete de
// ticket : c'est de la donnee machine, jamais une enseigne.
const BALISAGE = /[<>]|="/

// Le verso du rouleau transparait sur la photo et l'ocr en tire des mots a la casse erratique
// (« SaTTEMKEsYaAMGR »). Une enseigne s'imprime en capitales, en minuscules ou en capitales
// initiales — jamais en alternant trois fois dans le meme mot.
const ALTERNANCES_MAXIMUM = 2

const MOT = /\S+/g

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
  if (lettres < LETTRES_MINIMUM || chiffres > CHIFFRES_MAXIMUM || lettres <= chiffres) return false
  return !BALISAGE.test(texte) && !casseErratique(texte)
}

function casseErratique(texte: string): boolean {
  for (const mot of texte.match(MOT) ?? []) {
    let alternances = 0
    let precedente: boolean | undefined
    for (const caractere of mot) {
      const minuscule = caractere.toLowerCase()
      const majuscule = caractere.toUpperCase()
      if (minuscule === majuscule) continue
      const enMajuscule = caractere === majuscule
      if (precedente !== undefined && precedente !== enMajuscule) alternances++
      precedente = enMajuscule
    }
    if (alternances > ALTERNANCES_MAXIMUM) return true
  }
  return false
}
