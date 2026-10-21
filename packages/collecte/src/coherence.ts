import { COHERENCE, type Coherence, type Taxe } from '@alambic/noyau'

// Un recu quebecois est un petit systeme d'equations : sous-total + taxes = total, TPS = 5 % et
// TVQ = 9,975 % de la meme assiette. Le solveur s'en sert pour choisir, parmi les montants LUS,
// la combinaison qui se tient. Il ne fabrique jamais un montant : quand rien ne confirme un
// candidat plutot qu'un autre, c'est la lecture par defaut, celle d'avant le solveur, qui reste.

// Chaque montant est arrondi au cent, et certaines caisses arrondissent la taxe ligne a ligne :
// deux cents d'ecart couvrent les deux sans laisser passer une erreur de lecture.
const TOLERANCE = 0.02
// Les sommes de flottants (16.81 + 0.84 + 1.68 = 19.330000000000002) ne doivent pas faire
// tomber un ecart pile sur la tolerance.
const EPSILON = 1e-6

const TAUX_TPS = 0.05
const TAUX_TVQ = 0.09975

// La TVH la plus haute du pays : aucune taxe ne depasse cette part du sous-total.
const TAUX_MAXIMAL = 0.15

// Un taux imprime (« 9,975 % ») se reconnait a cette precision pres.
const ECART_TAUX = 0.0001

// Un bilan qui se ferme vaut deux preuves : il engage le total, le sous-total et les taxes a la
// fois, la ou un taux ne confirme qu'une taxe.
const PREUVES_BILAN = 2

// Facteurs prudents, faute de calibration des confiances : un bilan qui se ferme divise le doute
// par deux, un bilan qui ne se ferme pas baisse la confiance de chaque montant qu'il engage.
const DOUTE_SI_COHERENTE = 0.5
const FACTEUR_SI_INCOHERENTE = 0.8

// Au-dela, la combinatoire n'apporte rien : un recu n'imprime jamais autant de candidats
// credibles pour un meme champ.
const CANDIDATS_MAX = 4

const NATURE_TAXE = { tps: 'tps', tvq: 'tvq' } as const

type NatureTaxe = (typeof NATURE_TAXE)[keyof typeof NATURE_TAXE]

const TAUX_DE: Record<NatureTaxe, number> = {
  [NATURE_TAXE.tps]: TAUX_TPS,
  [NATURE_TAXE.tvq]: TAUX_TVQ,
}

const NOM_TPS = /^(TPS|GST)$/
const NOM_TVQ = /^(TVQ|QST)$/

// Un montant localise par le rang de sa ligne en ordre de lecture : le total et le sous-total
// d'un recu ne partagent jamais leur ligne, et les taxes s'impriment au-dessus du total.
export type MontantLu = {
  valeur: number
  confiance: number
  ligne: number | null
}

export type TaxeLue = Taxe & { ligne: number | null }

export type Lecture = {
  // Du plus sur au moins sur : a preuves egales, le premier l'emporte.
  totaux: readonly MontantLu[]
  sousTotaux: readonly MontantLu[]
  taxes: readonly TaxeLue[]
}

export type Arbitrage = {
  total: MontantLu | null
  sousTotal: MontantLu | null
  taxes: Taxe[]
  coherence: Coherence
}

type Combinaison = {
  total: MontantLu | null
  sousTotal: MontantLu | null
  taxes: TaxeLue[]
  preuves: number
  bilan: boolean
  // Somme des rangs des candidats retenus : plus petit, plus proche de la lecture par defaut.
  rang: number
}

export function arbitrer(lecture: Lecture): Arbitrage {
  // Ni total ni sous-total : toujours possible, c'est le point de depart que bat tout candidat.
  let retenue = combiner(null, null, lecture.taxes, Number.POSITIVE_INFINITY)
  for (const [rangTotal, total] of options(lecture.totaux).entries()) {
    for (const [rangSousTotal, sousTotal] of options(lecture.sousTotaux).entries()) {
      if (total !== null && sousTotal !== null && memeLigne(total, sousTotal)) continue
      const combinaison = combiner(total, sousTotal, lecture.taxes, rangTotal + rangSousTotal)
      if (meilleurQue(combinaison, retenue)) retenue = combinaison
    }
  }
  return conclure(retenue)
}

// Les candidats d'un champ, puis l'absence : un champ peut n'avoir aucun candidat recevable.
function options(candidats: readonly MontantLu[]): (MontantLu | null)[] {
  const distincts = candidats.filter(
    (candidat, indice) =>
      candidats.findIndex((autre) => proche(autre.valeur, candidat.valeur)) === indice,
  )
  return [...distincts.slice(0, CANDIDATS_MAX), null]
}

function memeLigne(a: MontantLu, b: MontantLu): boolean {
  return a.ligne !== null && a.ligne === b.ligne
}

function combiner(
  total: MontantLu | null,
  sousTotal: MontantLu | null,
  lues: readonly TaxeLue[],
  rang: number,
): Combinaison {
  const taxes = lues.filter((taxe) => possible(taxe, total, sousTotal))
  const bilan =
    total !== null && sousTotal !== null && proche(sousTotal.valeur + somme(taxes), total.valeur)
  const preuves = (bilan ? PREUVES_BILAN : 0) + preuvesDesTaux(taxes, sousTotal)
  return { total, sousTotal, taxes, preuves, bilan, rang }
}

// Une taxe s'imprime au-dessus du total, ne vaut jamais le total, ni plus que la TVH la plus
// haute du sous-total. Ce que le modele etiquette taxe sous le total est un pourboire ou un
// paiement ; au-dessus, un montant egal au total est le montant paye (« 9,00 $ | SANS
// CONTACT »).
function possible(taxe: TaxeLue, total: MontantLu | null, sousTotal: MontantLu | null): boolean {
  if (total !== null && total.ligne !== null && taxe.ligne !== null && taxe.ligne > total.ligne) {
    return false
  }
  if (taxe.montant === 0) return true
  if (total !== null && total.valeur > 0 && taxe.montant >= total.valeur) return false
  if (sousTotal !== null && sousTotal.valeur > 0) {
    return taxe.montant <= TAUX_MAXIMAL * sousTotal.valeur + TOLERANCE
  }
  return true
}

// Les taxes se confirment entre elles (TVQ = 1,995 x TPS, toujours sur la meme assiette) et, quand
// tout est taxable, par leur taux applique au sous-total. Une taxe nulle ne prouve rien.
function preuvesDesTaux(taxes: readonly Taxe[], sousTotal: MontantLu | null): number {
  const tps = taxes.filter((taxe) => natureDe(taxe) === NATURE_TAXE.tps && taxe.montant > 0)
  const tvq = taxes.filter((taxe) => natureDe(taxe) === NATURE_TAXE.tvq && taxe.montant > 0)

  let preuves = rapportTient(tps, tvq) ? 1 : 0
  if (sousTotal !== null) {
    for (const taxe of [...tps, ...tvq]) {
      const nature = natureDe(taxe)
      if (nature !== null && proche(taxe.montant, TAUX_DE[nature] * sousTotal.valeur)) {
        preuves += 1
      }
    }
  }
  return preuves
}

// Une seule TPS et une seule TVQ : a plusieurs, on ne sait plus lesquelles vont ensemble.
function rapportTient(tps: readonly Taxe[], tvq: readonly Taxe[]): boolean {
  if (tps.length !== 1 || tvq.length !== 1) return false
  return tps.some((t) => tvq.some((q) => proche(q.montant, (t.montant * TAUX_TVQ) / TAUX_TPS)))
}

// Le libelle d'abord (« T.P.S », « GST »), puis le taux imprime sur la ligne (« @ 5,000 % ») :
// certaines caisses n'ecrivent qu'une lettre devant la taxe.
function natureDe(taxe: Taxe): NatureTaxe | null {
  const nom = taxe.nom?.replace(/\./g, '').toUpperCase() ?? ''
  if (NOM_TPS.test(nom)) return NATURE_TAXE.tps
  if (NOM_TVQ.test(nom)) return NATURE_TAXE.tvq
  if (taxe.taux === null) return null
  if (Math.abs(taxe.taux - TAUX_TPS) < ECART_TAUX) return NATURE_TAXE.tps
  if (Math.abs(taxe.taux - TAUX_TVQ) < ECART_TAUX) return NATURE_TAXE.tvq
  return null
}

// Plus de preuves d'abord ; a preuves egales, la lecture la plus proche du defaut.
function meilleurQue(a: Combinaison, b: Combinaison): boolean {
  if (a.preuves !== b.preuves) return a.preuves > b.preuves
  return a.rang < b.rang
}

function conclure(retenue: Combinaison): Arbitrage {
  const coherence = retenue.bilan
    ? COHERENCE.coherente
    : retenue.total !== null && retenue.sousTotal !== null
      ? COHERENCE.incoherente
      : COHERENCE.indeterminee
  const ajuster = <T extends { confiance: number }>(lu: T): T => ({
    ...lu,
    confiance: ajusterConfiance(lu.confiance, coherence),
  })
  return {
    total: retenue.total === null ? null : ajuster(retenue.total),
    sousTotal: retenue.sousTotal === null ? null : ajuster(retenue.sousTotal),
    // Le rang de la ligne ne sert qu'ici : la facture rend la taxe telle que le contrat la decrit.
    taxes: retenue.taxes.map(({ ligne: _ligne, ...taxe }) => ajuster(taxe)),
    coherence,
  }
}

function ajusterConfiance(confiance: number, coherence: Coherence): number {
  if (coherence === COHERENCE.coherente) return 1 - (1 - confiance) * DOUTE_SI_COHERENTE
  if (coherence === COHERENCE.incoherente) return confiance * FACTEUR_SI_INCOHERENTE
  return confiance
}

function proche(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCE + EPSILON
}

function somme(taxes: readonly Taxe[]): number {
  return taxes.reduce((cumul, taxe) => cumul + taxe.montant, 0)
}
