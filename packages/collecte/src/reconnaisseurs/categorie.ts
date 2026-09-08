import { type Facture, SOUS_CATEGORIES, type SousCategorie } from '@alambic/noyau'
import { MOTS_CLES } from './mots-cles-categories'

// L'enseigne en tete de ticket est la seule source : elle dit chez qui on a paye, donc ce
// qu'on est venu acheter. Les libelles d'articles ont ete essayes puis ecartes — ils nomment
// un produit et non la nature du commerce, et sur le corpus ils n'ajoutaient que des erreurs
// (« BIERE THE DU LABRADOR » faisait de l'epicerie de l'alcool, « PIZZA GARNIE BACON » en
// faisait un restaurant).
//
// Le facteur dit que la categorie est deduite et non lue : le recu n'imprime nulle part
// « epicerie », c'est nous qui le concluons de l'enseigne.
const FACTEUR_ENSEIGNE = 0.8

// La plage des signes combinants (U+0300 a U+036F), retires apres decomposition NFD.
const DIACRITIQUES = /[̀-ͯ]/g

// Tout ce qui n'est ni lettre ni chiffre separe deux mots. « TIM HORTONS #1234 » devient donc
// les mots tim, hortons, 1234 — et le numero de succursale ne colle plus a l'enseigne.
const SEPARATEURS = /[^\p{L}\p{N}]+/u

// Index des mots-cles, construit une fois au chargement : le nom d'une enseigne est court, la
// table ne l'est pas. On interroge des fenetres de mots plutot que de balayer toute la table.
const INDEX = new Map<string, SousCategorie[]>()
// Sur : MOTS_CLES est un Record<SousCategorie, readonly string[]>, donc ses cles sont
// exactement les SousCategorie. Object.entries les elargit en string, c'est tout.
for (const [sousCategorie, motsCles] of Object.entries(MOTS_CLES) as [
  SousCategorie,
  readonly string[],
][]) {
  for (const motCle of motsCles) {
    const existantes = INDEX.get(motCle)
    if (existantes === undefined) INDEX.set(motCle, [sousCategorie])
    else existantes.push(sousCategorie)
  }
}

// Le plus long mot-cle de la table, en nombre de mots : la plus grande fenetre a essayer.
// Derive de la table et non fixe a la main, pour qu'un mot-cle plus long reste trouvable.
const FENETRE_MAXIMUM = Math.max(...[...INDEX.keys()].map((motCle) => motCle.split(' ').length))

type Trouvaille = {
  categorie: Facture['categorie']
  sousCategorie: Facture['sousCategorie']
}

const AUCUNE: Trouvaille = { categorie: null, sousCategorie: null }

// Deduit la nature de la depense des mots-cles reconnus dans l'enseigne. Ne tranche jamais une
// ambiguite : une categorie fausse coute plus cher au consommateur qu'une categorie absente.
export function reconnaitreCategorie(marchand: Facture['marchand']): Trouvaille {
  if (marchand === null) return AUCUNE
  return (
    trancher(chercher(decouper(marchand.valeur)), marchand.confiance * FACTEUR_ENSEIGNE) ?? AUCUNE
  )
}

function decouper(texte: string): string[] {
  return texte
    .normalize('NFD')
    .replace(DIACRITIQUES, '')
    .toLowerCase()
    .split(SEPARATEURS)
    .filter((mot) => mot !== '')
}

// Les sous-categories designees par la plus longue correspondance trouvee. La longueur d'abord
// parce qu'un mot-cle long est plus specifique qu'un court : « costco essence » l'emporte sur
// « costco », qui serait ambigu.
function chercher(mots: readonly string[]): SousCategorie[] {
  for (let taille = Math.min(FENETRE_MAXIMUM, mots.length); taille >= 1; taille--) {
    const trouvees = new Set<SousCategorie>()
    for (let debut = 0; debut + taille <= mots.length; debut++) {
      for (const sousCategorie of INDEX.get(mots.slice(debut, debut + taille).join(' ')) ?? []) {
        trouvees.add(sousCategorie)
      }
    }
    if (trouvees.size > 0) return [...trouvees]
  }

  return []
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
  // (« costco » vaut epicerie ou essence, deux groupes — impossible de choisir sans deviner).
  const memeGroupe = sousCategories.every(
    (sousCategorie) => SOUS_CATEGORIES[sousCategorie] === categorie.valeur,
  )
  return memeGroupe ? { categorie, sousCategorie: null } : null
}
