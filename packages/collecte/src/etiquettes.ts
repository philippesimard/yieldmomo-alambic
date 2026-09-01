import type { Mot } from './mots'

// Les etiquettes CORD que la reconstruction sait lire. Le checkpoint en connait d'autres
// (VOID_MENU.*, MENU.SUB_*, remises, services) : elles tombent sur `exterieur` et sont
// volontairement ignorees pour l'instant — les interpreter sans corpus de mesure serait
// deviner.
export const ETIQUETTE = {
  exterieur: 'O',
  articleNom: 'MENU.NM',
  articleQuantite: 'MENU.CNT',
  articlePrixUnitaire: 'MENU.UNITPRICE',
  articleMontant: 'MENU.PRICE',
  sousTotal: 'SUB_TOTAL.SUBTOTAL_PRICE',
  taxe: 'SUB_TOTAL.TAX_PRICE',
  total: 'TOTAL.TOTAL_PRICE',
  totalCarte: 'TOTAL.CREDITCARDPRICE',
  totalComptant: 'TOTAL.CASHPRICE',
  monnaieRendue: 'TOTAL.CHANGEPRICE',
} as const

export type Etiquette = (typeof ETIQUETTE)[keyof typeof ETIQUETTE]

export type MotEtiquete = Mot & {
  etiquette: Etiquette
  // Vrai quand le modele ouvre une entite (prefixe B-) : deux entites voisines de meme
  // etiquette restent distinctes.
  debut: boolean
  score: number
}

const ETIQUETTES_CONNUES: ReadonlySet<string> = new Set(Object.values(ETIQUETTE))

// Sous ce score, une etiquette est du bruit de decodage (un « ~ » ou un « : » etiquete prix a
// 0,3) : on la ramene a l'exterieur plutot que de laisser la reconstruction batir dessus.
const SCORE_MINIMUM = 0.4

// Demonte les etiquettes trop peu sures, en gardant le tableau aligne mot pour mot.
export function epurer(mots: readonly MotEtiquete[]): MotEtiquete[] {
  return mots.map((mot) =>
    mot.score >= SCORE_MINIMUM || mot.etiquette === ETIQUETTE.exterieur
      ? mot
      : { ...mot, etiquette: ETIQUETTE.exterieur, debut: false },
  )
}

// 'B-MENU.NM' devient { etiquette: 'MENU.NM', debut: true }. Toute etiquette hors table tombe
// sur `exterieur` : le checkpoint en connait une soixantaine, la reconstruction n'en lit
// qu'une poignee.
export function interpreterEtiquette(brute: string): { etiquette: Etiquette; debut: boolean } {
  const debut = brute.startsWith('B-')
  const nue = debut || brute.startsWith('I-') ? brute.slice(2) : brute
  if (!ETIQUETTES_CONNUES.has(nue)) return { etiquette: ETIQUETTE.exterieur, debut: false }
  // Sur : l'appartenance a l'ensemble des valeurs de ETIQUETTE vient d'etre verifiee.
  return { etiquette: nue as Etiquette, debut }
}
