import {
  type BlocTexte,
  type Facture,
  SOUS_CATEGORIE,
  SOUS_CATEGORIES,
  type SousCategorie,
} from '@alambic/noyau'
import { confianceDe, texteDe } from './commun'
import { siteDe, sousCategoriesDe } from './enseigne'
import { confianceAddition, confianceRayons } from './structure'

// Deux sources. L'enseigne en tete de ticket dit chez qui on a paye, donc ce qu'on est venu
// acheter. La forme du recu dit parfois ce qu'on y a fait : une addition de restaurant porte des
// mentions que la loi impose a la restauration, et elle vaut preuve meme quand l'enseigne est
// inconnue ou nomme autre chose qu'un restaurant. Les rayons d'un ticket d'epicerie, eux, ne
// servent qu'en dernier recours, quand l'enseigne ne dit rien : une pharmacie ou une grande
// surface imprime aussi des rayons alimentaires, et c'est la categorie du commerce qu'on rend.
//
// Les libelles d'articles ont ete essayes puis ecartes — ils nomment un produit et non la nature
// du commerce, et sur le corpus ils n'ajoutaient que des erreurs (« BIERE THE DU LABRADOR »
// faisait de l'epicerie de l'alcool, « PIZZA GARNIE BACON » en faisait un restaurant).
//
// Le facteur dit que la categorie est deduite et non lue : le recu n'imprime nulle part
// « epicerie », c'est nous qui le concluons de l'enseigne.
const FACTEUR_ENSEIGNE = 0.8

// Une mention legale lue sur le recu, et non un nom qu'on interprete : plus sure que l'enseigne.
const FACTEUR_ADDITION = 0.9

// Moins sure que l'enseigne : des rayons alimentaires s'impriment ailleurs qu'en epicerie.
const FACTEUR_RAYONS = 0.7

// Les enseignes qui s'effacent devant une addition. Un hotel (voyages) ou un bar (alcool) qui
// imprime une addition avec numero de table a servi a manger ou a boire sur place : c'est la
// depense d'un restaurant, pas d'une nuitee ni d'une bouteille. Toute autre enseigne reste en
// lice face au restaurant, et le desaccord se tranche comme les autres.
const CEDENT_A_L_ADDITION: ReadonlySet<SousCategorie> = new Set([
  SOUS_CATEGORIE.voyages,
  SOUS_CATEGORIE.alcool,
])

type Trouvaille = {
  categorie: Facture['categorie']
  sousCategorie: Facture['sousCategorie']
}

const AUCUNE: Trouvaille = { categorie: null, sousCategorie: null }

type Sources = { lignes: readonly BlocTexte[][]; marchand: Facture['marchand'] }

// Les sous-categories que les sources designent, et la confiance de la source qui les fonde.
type Candidates = { sousCategories: readonly SousCategorie[]; confiance: number }

const SANS_CANDIDATE: Candidates = { sousCategories: [], confiance: 0 }

// Deduit la nature de la depense de l'enseigne et de la forme du recu. Ne tranche jamais une
// ambiguite : une categorie fausse coute plus cher au consommateur qu'une categorie absente.
export function reconnaitreCategorie({ lignes, marchand }: Sources): Trouvaille {
  const candidates = rassembler(lignes, marchand)
  return trancher(candidates.sousCategories, candidates.confiance) ?? AUCUNE
}

function rassembler(lignes: readonly BlocTexte[][], marchand: Facture['marchand']): Candidates {
  const enseigne = lireEnseigne(marchand, lignes)
  const addition = confianceAddition(lignes)
  if (addition !== null) return avecAddition(enseigne, addition * FACTEUR_ADDITION)
  if (enseigne.sousCategories.length > 0) return enseigne
  return lireRayons(lignes)
}

// Le nom du marchand d'abord ; le site web imprime sur le recu quand le nom ne dit rien, parce
// que la ligne du nom est la plus exposee aux defauts de l'ocr (logo, gros caracteres).
function lireEnseigne(marchand: Facture['marchand'], lignes: readonly BlocTexte[][]): Candidates {
  const parNom = marchand === null ? [] : sousCategoriesDe(marchand.valeur)
  if (marchand !== null && parNom.length > 0) {
    return { sousCategories: parNom, confiance: marchand.confiance * FACTEUR_ENSEIGNE }
  }
  return lireSite(lignes)
}

function lireSite(lignes: readonly BlocTexte[][]): Candidates {
  for (const ligne of lignes) {
    const site = siteDe(texteDe(ligne))
    const sousCategories = site === null ? [] : sousCategoriesDe(site)
    if (sousCategories.length > 0) {
      return { sousCategories, confiance: confianceDe(ligne) * FACTEUR_ENSEIGNE }
    }
  }
  return SANS_CANDIDATE
}

function lireRayons(lignes: readonly BlocTexte[][]): Candidates {
  const confiance = confianceRayons(lignes)
  if (confiance === null) return SANS_CANDIDATE
  return { sousCategories: [SOUS_CATEGORIE.epicerie], confiance: confiance * FACTEUR_RAYONS }
}

// Une addition met le restaurant en lice a cote de ce que dit l'enseigne, une fois retirees les
// enseignes qui lui cedent. Une enseigne de restaurant la confirme ; une enseigne de cafe la
// ramene au groupe ; une enseigne d'un autre groupe (une salle de quilles) fait tout refuser.
function avecAddition(enseigne: Candidates, confiance: number): Candidates {
  const restantes = enseigne.sousCategories.filter(
    (sousCategorie) => !CEDENT_A_L_ADDITION.has(sousCategorie),
  )
  return {
    sousCategories: [...new Set([...restantes, SOUS_CATEGORIE.restaurant])],
    confiance: restantes.length === 0 ? confiance : Math.max(confiance, enseigne.confiance),
  }
}

// null quand rien ne permet de conclure, et c'est le cas nominal : la plupart des enseignes ne
// sont dans aucun catalogue.
function trancher(sousCategories: readonly SousCategorie[], confiance: number): Trouvaille | null {
  const premiere = sousCategories[0]
  if (premiere === undefined) return null

  const categorie = { valeur: SOUS_CATEGORIES[premiere], confiance }
  if (sousCategories.length === 1) {
    return { categorie, sousCategorie: { valeur: premiere, confiance } }
  }

  // Plusieurs candidates : on rend le groupe s'il est le meme pour toutes (« tim hortons » est
  // de l'alimentation, sans qu'on sache dire restaurant ou cafe), et rien du tout sinon
  // (« indigo » vaut stationnement ou librairie, deux groupes — impossible de choisir sans
  // deviner).
  const memeGroupe = sousCategories.every(
    (sousCategorie) => SOUS_CATEGORIES[sousCategorie] === categorie.valeur,
  )
  return memeGroupe ? { categorie, sousCategorie: null } : null
}
