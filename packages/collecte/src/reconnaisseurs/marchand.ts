import type { BlocTexte, Facture } from '@alambic/noyau'
import { confianceDe, normaliser, texteDe } from './commun'
import { porteUneDate } from './date'

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
// initiales — jamais en remontant deux fois d'une minuscule a une majuscule dans une meme
// suite de lettres. La suite et non le mot : « Ste-Foy » en fait deux, sans aucune montee, et
// McDonald n'en compte qu'une.
const MONTEES_MAXIMUM = 1

const SUITE_DE_LETTRES = /\p{L}+/gu

// « Servi par: Amir », « Caissier : Tristan » : le libelle d'un champ du ticket, dont la valeur
// croise parfois une enseigne (un prenom, « Libre Service »).
const ETIQUETTE = /^[\p{L}\s.']{1,24}:/u

// Les lignes d'adresse portent des toponymes qui sont aussi des enseignes (« boul. St-Hubert »).
// Elles se reconnaissent a un code postal, a la province isolee, ou a un numero civique suivi
// d'un type de voie — au plus un mot plus loin, pour « 1522, 2E RANG ». Le texte est normalise.
const CODE_POSTAL = /\b[a-z]\d[a-z]\s?\d[a-z]\d\b/
const PROVINCE = /(?:^|[\s,])qc(?:[\s,.]|$)/
const TYPES_DE_VOIE = [
  'rue',
  'av',
  'ave',
  'avenue',
  'boul',
  'bd',
  'blvd',
  'boulevard',
  'ch',
  'chem',
  'chemin',
  'rang',
  'route',
  'rte',
  'montee',
  'cote',
  'place',
  'pl',
  'promenade',
] as const
const NUMERO_CIVIQUE = new RegExp(
  `^\\d+[a-z]?[\\s,]+(?:\\S+\\s+)?(?:${TYPES_DE_VOIE.join('|')})\\b`,
)

export function reconnaitreMarchand(lignes: readonly BlocTexte[][]): Facture['marchand'] {
  for (const ligne of lignes.slice(0, LIGNES_EXAMINEES)) {
    const texte = texteDe(ligne)
    if (!nommable(texte) || designeAutreChose(texte)) continue
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

// Des lignes faites de lettres qui ne nomment pourtant jamais le commerce : le libelle d'un
// champ, une date, une adresse. Les ecarter sur leur forme neutralise d'un coup les prenoms, les
// mois et les toponymes qui croisent une enseigne, sans retirer l'enseigne de la table.
function designeAutreChose(texte: string): boolean {
  return ETIQUETTE.test(texte) || porteUneDate(texte) || estAdresse(normaliser(texte))
}

function estAdresse(normalise: string): boolean {
  return CODE_POSTAL.test(normalise) || PROVINCE.test(normalise) || NUMERO_CIVIQUE.test(normalise)
}

function casseErratique(texte: string): boolean {
  return (texte.match(SUITE_DE_LETTRES) ?? []).some((suite) => montees(suite) > MONTEES_MAXIMUM)
}

function montees(suite: string): number {
  let compte = 0
  let precedenteMinuscule = false
  for (const caractere of suite) {
    const majuscule = caractere !== caractere.toLowerCase()
    if (majuscule && precedenteMinuscule) compte++
    precedenteMinuscule = caractere !== caractere.toUpperCase()
  }
  return compte
}
