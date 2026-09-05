import type { Article, Facture, Taxe } from '@alambic/noyau'
import { ETIQUETTE, type Etiquette, type MotEtiquete } from './etiquettes'
import {
  MARQUEURS_ECARTES,
  MARQUEURS_MONTANT,
  MARQUEURS_SOUS_TOTAL,
  MARQUEURS_TOTAL,
} from './marqueurs'
import { montantDe } from './montant'

// Un montant paye (carte ou comptant) vaut total quand aucun total n'est imprime, mais c'est
// une deduction et non une lecture : la confiance en garde la trace.
const FACTEUR_REPLI_TOTAL = 0.8

// Un montant trouve par marqueur de ligne plutot que par le modele est une lecture par regle :
// la confiance en garde la trace, comme pour les reconnaisseurs.
const FACTEUR_MARQUEUR = 0.7

// Libelles d'impots tels qu'ils s'impriment. Le nom est rendu tel que lu (contrat TaxeSchema,
// sans normalisation) : le lexique ne sert qu'a reperer la ligne.
// Les points de « T.P.S » sont ceux de l'acronyme, pas une autre taxe : les caisses des
// epiceries l'impriment ainsi, et le nom rendu garde la graphie lue.
const LEXIQUE_TAXE = /\b(T\.?P\.?S|T\.?V\.?Q|TVH|GST|PST|QST|HST|TVA|TAXES?|TAX)\b/i

// Une taxe reconnue au lexique seul, sans etiquette du modele, est une lecture par regle : la
// confiance en garde la trace, comme pour les reconnaisseurs.
const FACTEUR_TAXE_LEXIQUE = 0.7

// Une ligne au lexique qui parle aussi de total (« TOTAL TAXES INCLUSES ») annonce un total,
// pas une taxe.
const MENTION_TOTAL = /total/i

// Lignes qui parlent du reglement, pas d'un article : jamais un article, quoi qu'en dise le
// modele — en zero-shot il etiquette volontiers « TPS 1,45 » ou « MONTANT 17,00 » comme un
// article de menu.
//
// Un rabais en fait partie : les epiceries l'impriment sur sa propre ligne et en POSITIF
// (« RABAIS SUR LE PRIX COURANT : 2,82 $ »), sous l'article qu'il diminue. Le rendre comme un
// article ferait compter deux fois, et dans le mauvais sens.
//
// « carte de » et non « carte » : c'est la ligne de reglement (« VENTE : CARTE DE CREDIT »)
// qu'on ecarte, pas une carte-cadeau, qui est un article qu'on achete.
const LIGNE_REGLEMENT =
  /total|montant|solde|balance|paiement|payment|monnaie|change|approuv|credit|debit|visa|master|amex|interac|rabais|remise|discount|economie|epargne|vente|carte de/i

const POURCENTAGE = /(\d+(?:[.,]\d+)?)\s*%/

const QUANTITE = /\d+(?:[.,]\d+)?/

// Une suite de mots que le modele a lus comme un meme champ.
export type Entite = {
  etiquette: Etiquette
  texte: string
  mots: MotEtiquete[]
  // Score moyen du modele sur les mots de l'entite.
  score: number
  // Score du modele pondere par le maillon faible de l'ocr : une etiquette sure posee sur un
  // texte mal lu reste douteuse.
  confiance: number
}

export type Reconstruction = {
  sousTotal: Facture['sousTotal']
  taxes: Taxe[]
  total: Facture['total']
  articles: Article[]
}

// Un montant localise : la ligne permet d'ecarter un candidat deja consomme par un autre
// champ (le total et le sous-total d'un recu ne partagent jamais leur ligne).
type MontantTrouve = {
  valeur: number
  confiance: number
  ligne: readonly MotEtiquete[] | null
}

// Regroupe les mots etiquetes en entites, dans l'ordre de lecture. B- ouvre, I- continue ; un
// I- orphelin ou d'une autre etiquette ouvre aussi, parce qu'en zero-shot le modele oublie
// parfois le B- d'une entite pourtant bien vue.
export function extraireEntites(mots: readonly MotEtiquete[]): Entite[] {
  const entites: Entite[] = []
  let courante: MotEtiquete[] = []

  const cloturer = (): void => {
    const premier = courante[0]
    if (premier !== undefined) {
      const score = courante.reduce((somme, mot) => somme + mot.score, 0) / courante.length
      const ocr = courante.reduce((minimum, mot) => Math.min(minimum, mot.confiance), 1)
      entites.push({
        etiquette: premier.etiquette,
        texte: courante.map((mot) => mot.texte).join(' '),
        mots: courante,
        score,
        confiance: score * ocr,
      })
    }
    courante = []
  }

  for (const mot of mots) {
    if (mot.etiquette === ETIQUETTE.exterieur) {
      cloturer()
      continue
    }
    const precedent = courante.at(-1)
    if (mot.debut || precedent === undefined || precedent.etiquette !== mot.etiquette) {
      cloturer()
    }
    courante.push(mot)
  }
  cloturer()
  return entites
}

export function reconstruire(
  entites: readonly Entite[],
  lignes: readonly MotEtiquete[][],
): Reconstruction {
  const total = reconstruireTotal(entites, lignes)
  // Le sous-total ne peut pas vivre sur la ligne du total : quand le modele etiquette les deux
  // sur le meme montant, c'est le total qui a raison et le sous-total qui se cherche ailleurs.
  const sousTotal =
    trouverMontant(entites, lignes, ETIQUETTE.sousTotal, total?.ligne ?? null) ??
    chercherMarqueur(lignes, MARQUEURS_SOUS_TOTAL, [], total?.ligne ?? null)
  return {
    sousTotal: rendu(sousTotal),
    taxes: reconstruireTaxes(entites, lignes),
    total: rendu(total),
    articles: reconstruireArticles(lignes),
  }
}

// La derniere entite en ordre de lecture porteuse d'un montant : un recu imprime souvent un
// rappel en tete, et c'est le pied de ticket qui fait foi. Le montant se lit dans l'entite,
// ou a defaut sur sa ligne : en zero-shot le modele etiquette souvent le mot « TOTAL » en
// laissant le chiffre d'a cote sous une autre etiquette.
function trouverMontant(
  entites: readonly Entite[],
  lignes: readonly MotEtiquete[][],
  etiquette: Etiquette,
  ligneExclue: readonly MotEtiquete[] | null,
): MontantTrouve | null {
  for (let indice = entites.length - 1; indice >= 0; indice--) {
    const entite = entites[indice]
    if (entite === undefined || entite.etiquette !== etiquette) continue

    const ligne = ligneDe(lignes, entite)
    if (ligneExclue !== null && ligne === ligneExclue) continue

    const valeur = montantDe(entite.texte) ?? (ligne === null ? null : montantDe(texteDe(ligne)))
    if (valeur === null) continue

    return { valeur, confiance: entite.confiance, ligne }
  }
  return null
}

function rendu(trouve: MontantTrouve | null): Facture['total'] {
  return trouve === null ? null : { valeur: trouve.valeur, confiance: trouve.confiance }
}

// Le total est le champ qui compte le plus : trois filets, du plus direct au plus deduit.
// L'etiquette du modele d'abord ; sinon la ligne a marqueur (« TOTAL 26,43 », puis
// « MONTANT $17.00 » des recus de terminal) ; en dernier, un montant paye par carte ou
// comptant.
function reconstruireTotal(
  entites: readonly Entite[],
  lignes: readonly MotEtiquete[][],
): MontantTrouve | null {
  // Le modele aussi se fait prendre par le bloc d'economies du pied de ticket : il etiquette
  // « VALEUR TOTAL : 0,50 $ » comme le total. Une ligne qu'un marqueur ecarte n'est pas le
  // total, quelle que soit la source qui l'affirme.
  const total = trouverMontant(entites, lignes, ETIQUETTE.total, null)
  if (total !== null && !ecartee(total.ligne)) return total

  const parMarqueur =
    chercherMarqueur(lignes, MARQUEURS_TOTAL, MARQUEURS_ECARTES, null) ??
    chercherMarqueur(lignes, MARQUEURS_MONTANT, MARQUEURS_ECARTES, null)
  if (parMarqueur !== null) return parMarqueur

  const paye =
    trouverMontant(entites, lignes, ETIQUETTE.totalCarte, null) ??
    trouverMontant(entites, lignes, ETIQUETTE.totalComptant, null)
  if (paye === null) return null
  return { ...paye, confiance: paye.confiance * FACTEUR_REPLI_TOTAL }
}

function ecartee(ligne: readonly MotEtiquete[] | null): boolean {
  if (ligne === null) return false
  const normalise = texteDe(ligne).toLowerCase()
  return MARQUEURS_ECARTES.some((marqueur) => normalise.includes(marqueur))
}

// La derniere ligne qui porte un marqueur et un montant lisible : c'est le pied de ticket qui
// fait foi. Meme reconnaissance que le moteur factice, ici en repli du modele.
function chercherMarqueur(
  lignes: readonly MotEtiquete[][],
  marqueurs: readonly string[],
  ecartes: readonly string[],
  ligneExclue: readonly MotEtiquete[] | null,
): MontantTrouve | null {
  for (let indice = lignes.length - 1; indice >= 0; indice--) {
    const ligne = lignes[indice]
    if (ligne === undefined || ligne === ligneExclue) continue

    const texte = texteDe(ligne)
    const normalise = texte.toLowerCase()
    if (ecartes.some((marqueur) => normalise.includes(marqueur))) continue
    if (!marqueurs.some((marqueur) => normalise.includes(marqueur))) continue

    const valeur = montantDe(texte)
    if (valeur === null) continue

    return { valeur, confiance: confianceOcrDe(ligne) * FACTEUR_MARQUEUR, ligne }
  }
  return null
}

// Les taxes se lisent a deux sources : les entites que le modele etiquette, puis les lignes
// que le lexique repere et que le modele a manquees — en zero-shot il prend volontiers une
// ligne « TPS 1,45 » pour un article. Le nom et le taux se lisent toujours sur la ligne.
function reconstruireTaxes(entites: readonly Entite[], lignes: readonly MotEtiquete[][]): Taxe[] {
  const taxes: Taxe[] = []
  const lignesPrises = new Set<readonly MotEtiquete[]>()

  for (const entite of entites) {
    if (entite.etiquette !== ETIQUETTE.taxe) continue
    const ligne = ligneDe(lignes, entite)
    // Une ligne ne porte qu'une taxe. Le modele y etiquette pourtant plusieurs nombres quand
    // elle donne le taux et l'assiette (« T.P.S 5 % 35,37 @ 5,000 % 1,77 ») : sans ce garde-fou
    // la meme taxe sort trois fois, assiette comprise, et le consommateur qui les additionne
    // se trompe du tout au tout.
    if (ligne !== null && lignesPrises.has(ligne)) continue

    // Le montant se lit sur la LIGNE et non dans l'entite : sur un recu, la taxe est le dernier
    // nombre de sa ligne, alors que l'entite peut tomber sur l'assiette ou sur le taux.
    const montant = (ligne === null ? null : montantDe(texteDe(ligne))) ?? montantDe(entite.texte)
    if (montant === null) continue

    if (ligne !== null) lignesPrises.add(ligne)
    const texteLigne = ligne === null ? '' : texteDe(ligne)
    taxes.push({
      nom: texteLigne.match(LEXIQUE_TAXE)?.[0] ?? null,
      taux: tauxDe(texteLigne),
      montant,
      confiance: entite.confiance,
    })
  }

  for (const ligne of lignes) {
    if (lignesPrises.has(ligne)) continue
    const texte = texteDe(ligne)
    const nom = texte.match(LEXIQUE_TAXE)?.[0]
    if (nom === undefined || MENTION_TOTAL.test(texte)) continue
    const montant = montantDe(texte)
    if (montant === null) continue

    taxes.push({
      nom,
      taux: tauxDe(texte),
      montant,
      confiance: confianceOcrDe(ligne) * FACTEUR_TAXE_LEXIQUE,
    })
  }

  return taxes
}

function reconstruireArticles(lignes: readonly MotEtiquete[][]): Article[] {
  const articles: Article[] = []
  for (const ligne of lignes) {
    const article = articleDe(ligne)
    if (article !== null) articles.push(article)
  }
  return articles
}

// Une ligne porte un article quand le modele y a vu un montant d'article — sauf si elle parle
// du reglement ou d'une taxe. Le libelle vient des mots MENU.NM, ou a defaut des mots non
// etiquetes de la ligne : en zero-shot le modele voit souvent le prix mieux que le libelle.
function articleDe(ligne: readonly MotEtiquete[]): Article | null {
  const par = (etiquette: Etiquette): MotEtiquete[] =>
    ligne.filter((mot) => mot.etiquette === etiquette)

  const motsMontant = par(ETIQUETTE.articleMontant)
  if (motsMontant.length === 0) return null
  const montant = montantDe(texteDe(motsMontant))
  if (montant === null) return null

  const texteLigne = texteDe(ligne)
  if (LIGNE_REGLEMENT.test(texteLigne) || LEXIQUE_TAXE.test(texteLigne)) return null

  const motsNom = par(ETIQUETTE.articleNom)
  const libelle = texteDe(motsNom.length > 0 ? motsNom : par(ETIQUETTE.exterieur))
  if (libelle.length === 0) return null

  const motsQuantite = par(ETIQUETTE.articleQuantite)
  const motsPrixUnitaire = par(ETIQUETTE.articlePrixUnitaire)
  return {
    libelle,
    quantite: quantiteDe(texteDe(motsQuantite)),
    prixUnitaire: montantDe(texteDe(motsPrixUnitaire)),
    montant,
    confiance: confianceDe([...motsNom, ...motsQuantite, ...motsPrixUnitaire, ...motsMontant]),
  }
}

function ligneDe(lignes: readonly MotEtiquete[][], entite: Entite): readonly MotEtiquete[] | null {
  const premier = entite.mots[0]
  if (premier === undefined) return null
  return lignes.find((ligne) => ligne.includes(premier)) ?? null
}

function tauxDe(texte: string): number | null {
  const lu = texte.match(POURCENTAGE)?.[1]
  if (lu === undefined) return null
  const taux = Number(lu.replace(',', '.')) / 100
  // Le contrat borne le taux dans [0, 1] : un pourcentage aberrant est une erreur de lecture,
  // pas une taxe.
  return Number.isFinite(taux) && taux >= 0 && taux <= 1 ? taux : null
}

function quantiteDe(texte: string): number | null {
  const lu = texte.match(QUANTITE)?.[0]
  if (lu === undefined) return null
  const quantite = Number(lu.replace(',', '.'))
  // Le contrat exige une quantite strictement positive : un zero lu est une erreur de lecture.
  return Number.isFinite(quantite) && quantite > 0 ? quantite : null
}

function texteDe(mots: readonly MotEtiquete[]): string {
  return mots
    .map((mot) => mot.texte)
    .join(' ')
    .trim()
}

// Le maillon faible et non la moyenne : un article dont un seul champ est douteux reste
// douteux, et c'est souvent le montant qui compte.
function confianceDe(mots: readonly MotEtiquete[]): number {
  return mots.reduce((minimum, mot) => Math.min(minimum, mot.score * mot.confiance), 1)
}

function confianceOcrDe(mots: readonly MotEtiquete[]): number {
  return mots.reduce((minimum, mot) => Math.min(minimum, mot.confiance), 1)
}
