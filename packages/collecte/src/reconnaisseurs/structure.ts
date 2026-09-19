import type { BlocTexte } from '@alambic/noyau'
import { montantDe } from '../montant'
import { confianceDe, normaliser, texteDe } from './commun'

// Ce que la forme du recu dit du commerce, independamment de son enseigne : une addition de
// restaurant, un ticket d'epicerie.
//
// Une addition de restaurant quebecoise sort d'un module d'enregistrement des ventes (MEV) que
// Revenu Quebec impose a la restauration, et qui imprime des mentions legales : « FACTURE
// ORIGINALE », « FACTURE REVISEE », « Remplace 1 facture(s) ». Seules, elles ne suffisent pas —
// d'autres secteurs facturent sous le meme regime (le taxi) et une politique de retour peut
// finir sur « …la facture originale ». Ce qui distingue le service a table, c'est son en-tete :
// « TABLE # 13 », « TBL 29-4 », « ADDITION # 563536-1 ». On exige donc les deux, ou l'addition
// et la table ensemble quand le bas du ticket manque.
//
// Les lignes se comparent sous forme compacte — minuscules, sans accents, lettres et chiffres
// seulement — parce que l'ocr colle et decolle les mots (« FACTUREORIGINALE », « TABLE49 »).
const MENTIONS_LEGALES = [/^factureoriginale$/, /^facturerevisee$/, /^remplace\d+factures?$/]
const ADDITION = /^addition\d/

// Le numero de table seul sur sa ligne, ou suivi de ce qu'un en-tete de service imprime a cote
// (« Table 30 Serveur Simon », « TABLE 34 PERS 3 ») — jamais d'autre mot : « TABLE 6 PLACES »
// est un article de meuble dont le prix s'imprime sur la ligne suivante.
const SUITES_DE_TABLE = ['serveur', 'server', 'couvert', 'client', 'pers', 'invite', 'guest']
const TABLE = new RegExp(`^(?:table|tbl)\\d+(?:$|${SUITES_DE_TABLE.join('|')})`)

// Deux preuves sur les trois (mention, table, addition) : toute paire contient alors un en-tete
// de service a table, ce qui ecarte le taxi et la politique de retour.
const PREUVES_MINIMUM = 2

// Un ticket d'epicerie se reconnait a ses rayons et a ses pesees. Un rayon est une ligne
// entiere tiree d'une liste fermee, precedee ou non de son numero (« 27-FRUITS ET LEGUMES ») ;
// une pesee est un poids au gramme pres suivi de son prix au kilo (« 0.760 kg @ $11.00 / kg »).
// Il faut un rayon et une autre preuve — un second rayon ou une pesee : une pesee seule se fait
// aussi chez le fromager, et un rayon seul peut etre un libelle d'article.
const RAYONS_ALIMENTAIRES: ReadonlySet<string> = new Set([
  'epicerie',
  'viande',
  'viandes',
  'fruitslegumes',
  'fruitsetlegumes',
  'produitslaitiers',
  'surgeles',
  'produitssurgeles',
  'boulangerie',
  'boucherie',
  'poissonnerie',
])
const NUMERO_DE_RAYON = /^\d+/
const PESEE = /\d+[.,]\d{3}\s*kg\s*[@xa]\s*\$?\d+[.,]\d{2}\s*\/\s*kg/
const PREUVES_EPICERIE_MINIMUM = 2

const NI_LETTRE_NI_CHIFFRE = /[^a-z0-9]/g

type Ligne = { normalisee: string; compacte: string; confiance: number; montant: boolean }

// La confiance de lecture des lignes qui font d'un recu une addition de restaurant, ou null si
// ce n'en est pas une.
export function confianceAddition(lignes: readonly BlocTexte[][]): number | null {
  const lues = lignes.map(lire)
  // L'en-tete ne porte jamais de montant : ecarter les lignes qui en ont ecarte l'article
  // « TABLE 6 PLACES 499,00 » d'un marchand de meubles.
  const entetes = lues.filter((ligne) => !ligne.montant)
  const preuves = [
    lues.find((ligne) => MENTIONS_LEGALES.some((motif) => motif.test(ligne.compacte))),
    entetes.find((ligne) => TABLE.test(ligne.compacte)),
    entetes.find((ligne) => ADDITION.test(ligne.compacte)),
  ].filter((ligne) => ligne !== undefined)
  if (preuves.length < PREUVES_MINIMUM) return null
  return Math.min(...preuves.map((ligne) => ligne.confiance))
}

// La confiance de lecture des rayons et des pesees qui font d'un recu un ticket d'epicerie, ou
// null si ce n'en est pas un.
export function confianceRayons(lignes: readonly BlocTexte[][]): number | null {
  const lues = lignes.map(lire)
  const rayons = new Map<string, Ligne>()
  for (const ligne of lues) {
    const rayon = ligne.compacte.replace(NUMERO_DE_RAYON, '')
    if (RAYONS_ALIMENTAIRES.has(rayon) && !rayons.has(rayon)) rayons.set(rayon, ligne)
  }
  const pesee = lues.find((ligne) => PESEE.test(ligne.normalisee))
  const preuves = pesee === undefined ? [...rayons.values()] : [...rayons.values(), pesee]
  if (rayons.size === 0 || preuves.length < PREUVES_EPICERIE_MINIMUM) return null
  return Math.min(...preuves.map((ligne) => ligne.confiance))
}

function lire(ligne: readonly BlocTexte[]): Ligne {
  const texte = texteDe(ligne)
  const normalisee = normaliser(texte)
  return {
    normalisee,
    compacte: normalisee.replace(NI_LETTRE_NI_CHIFFRE, ''),
    confiance: confianceDe(ligne),
    montant: montantDe(texte) !== null,
  }
}
