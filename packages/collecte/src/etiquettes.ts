import type { Mot } from './mots'

// Les etiquettes que la reconstruction sait lire. Ce sont celles de CORD, et elles restent la
// table de reference : le checkpoint maison en pose d'autres (marchand, adresse, date, taxes
// nommees) que `CORRESPONDANCE` ramene ici, et tout ce qui n'a pas de contrepartie tombe sur
// `exterieur` — l'interpreter sans corpus de mesure serait deviner.
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

// Les champs du checkpoint maison (fine-tune sur des recus quebecois) et l'etiquette CORD qui
// leur correspond. Les autres champs qu'il sait poser — marchand, adresse, telephone, date,
// heure, paiement, libelles et numeros de taxe, unites — n'ont volontairement pas d'entree :
// la Facture les tire de ses reconnaisseurs, et deux sources pour un meme champ se
// contrediraient sans qu'on sache laquelle croire.
//
// Les deux taxes du Quebec tombent sur la meme etiquette : le contrat rend une liste de taxes
// nommees d'apres la ligne lue, il n'a pas besoin de les distinguer ici.
const CORRESPONDANCE: Readonly<Record<string, Etiquette>> = {
  nm: ETIQUETTE.articleNom,
  cnt: ETIQUETTE.articleQuantite,
  unitprice: ETIQUETTE.articlePrixUnitaire,
  price: ETIQUETTE.articleMontant,
  subtotal_price: ETIQUETTE.sousTotal,
  tps: ETIQUETTE.taxe,
  tvq: ETIQUETTE.taxe,
  total_price: ETIQUETTE.total,
}

// 'B-MENU.NM' devient { etiquette: 'MENU.NM', debut: true }. Toute etiquette hors table tombe
// sur `exterieur` : les checkpoints en connaissent des dizaines, la reconstruction n'en lit
// qu'une poignee.
//
// Deux familles de noms cohabitent, et c'est voulu : le checkpoint maison ecrit `B-total_price`,
// celui de CORD `menu.nm`, sans prefixe. Sans prefixe, aucun mot n'ouvre d'entite ; c'est alors
// la reconstruction qui separe deux entites voisines par le changement d'etiquette.
export function interpreterEtiquette(brute: string): { etiquette: Etiquette; debut: boolean } {
  const debut = brute.startsWith('B-')
  const nue = debut || brute.startsWith('I-') ? brute.slice(2) : brute

  const correspondante = CORRESPONDANCE[nue.toLowerCase()]
  if (correspondante !== undefined) return { etiquette: correspondante, debut }

  const cord = nue.toUpperCase()
  if (!ETIQUETTES_CONNUES.has(cord)) return { etiquette: ETIQUETTE.exterieur, debut: false }
  // Sur : l'appartenance a l'ensemble des valeurs de ETIQUETTE vient d'etre verifiee.
  return { etiquette: cord as Etiquette, debut }
}
