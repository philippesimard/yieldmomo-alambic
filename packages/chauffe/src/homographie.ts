import { type Etat, lire } from './etat'

export type Point = { x: number; y: number }

// Les huit coefficients a..h d'une homographie, le neuvieme etant fixe a 1 : une homographie
// n'est definie qu'a un facteur pres, et fixer le dernier terme retire cette liberte inutile.
export type Homographie = Float64Array

const INCONNUES = 8
const COLONNES = 9

// En dessous, le pivot n'est plus du signal mais de l'erreur d'arrondi : les quatre points sont
// alignes ou confondus, et il n'existe pas d'homographie.
const PIVOT_MINIMAL = 1e-10

// Ce qu'on met la ou le remap sort du document. Blanc et jamais noir : un bord noir creerait
// un faux contour que le seuillage prendrait pour de l'encre.
const HORS_CADRE = 255

// L'homographie qui envoie `depart` sur `arrivee`. Quatre paires de points donnent huit
// equations pour huit inconnues : il n'y a rien a ajuster, juste un systeme a resoudre.
export function resoudreHomographie(
  depart: readonly Point[],
  arrivee: readonly Point[],
): Homographie | undefined {
  const systeme = new Float64Array(INCONNUES * COLONNES)

  for (let i = 0; i < 4; i += 1) {
    const de = depart[i]
    const vers = arrivee[i]
    if (de === undefined || vers === undefined) {
      return undefined
    }

    const ligneX = 2 * i * COLONNES
    systeme[ligneX] = de.x
    systeme[ligneX + 1] = de.y
    systeme[ligneX + 2] = 1
    systeme[ligneX + 6] = -de.x * vers.x
    systeme[ligneX + 7] = -de.y * vers.x
    systeme[ligneX + 8] = vers.x

    const ligneY = (2 * i + 1) * COLONNES
    systeme[ligneY + 3] = de.x
    systeme[ligneY + 4] = de.y
    systeme[ligneY + 5] = 1
    systeme[ligneY + 6] = -de.x * vers.y
    systeme[ligneY + 7] = -de.y * vers.y
    systeme[ligneY + 8] = vers.y
  }

  return eliminer(systeme)
}

// Gauss-Jordan avec pivot partiel. Sur un systeme de huit lignes, la clarte vaut plus que la
// finesse numerique : la solution se lit directement dans la derniere colonne.
function eliminer(systeme: Float64Array): Homographie | undefined {
  const a = (ligne: number, colonne: number): number => systeme[ligne * COLONNES + colonne] ?? 0

  for (let colonne = 0; colonne < INCONNUES; colonne += 1) {
    let pivot = colonne
    for (let ligne = colonne + 1; ligne < INCONNUES; ligne += 1) {
      if (Math.abs(a(ligne, colonne)) > Math.abs(a(pivot, colonne))) {
        pivot = ligne
      }
    }
    if (Math.abs(a(pivot, colonne)) < PIVOT_MINIMAL) {
      return undefined
    }
    if (pivot !== colonne) {
      echangerLignes(systeme, pivot, colonne)
    }

    const diviseur = a(colonne, colonne)
    for (let j = colonne; j < COLONNES; j += 1) {
      systeme[colonne * COLONNES + j] = a(colonne, j) / diviseur
    }

    for (let ligne = 0; ligne < INCONNUES; ligne += 1) {
      const facteur = a(ligne, colonne)
      if (ligne === colonne || facteur === 0) {
        continue
      }
      for (let j = colonne; j < COLONNES; j += 1) {
        systeme[ligne * COLONNES + j] = a(ligne, j) - facteur * a(colonne, j)
      }
    }
  }

  const coefficients = new Float64Array(INCONNUES)
  for (let i = 0; i < INCONNUES; i += 1) {
    coefficients[i] = a(i, INCONNUES)
  }
  return coefficients
}

function echangerLignes(systeme: Float64Array, premiere: number, seconde: number): void {
  for (let j = 0; j < COLONNES; j += 1) {
    const gauche = premiere * COLONNES + j
    const droite = seconde * COLONNES + j
    const temporaire = systeme[gauche] ?? 0
    systeme[gauche] = systeme[droite] ?? 0
    systeme[droite] = temporaire
  }
}

// La transformation attendue va de la SORTIE vers l'ENTREE : on parcourt les pixels de sortie et
// on va chercher d'ou chacun vient. Dans l'autre sens, l'etirement laisserait des trous.
export function remapper(
  source: Etat,
  transformation: Homographie,
  largeur: number,
  hauteur: number,
): Etat {
  const a = transformation[0] ?? 0
  const b = transformation[1] ?? 0
  const c = transformation[2] ?? 0
  const d = transformation[3] ?? 0
  const e = transformation[4] ?? 0
  const f = transformation[5] ?? 0
  const g = transformation[6] ?? 0
  const h = transformation[7] ?? 0

  const pixels = Buffer.allocUnsafe(largeur * hauteur)

  for (let v = 0; v < hauteur; v += 1) {
    // Sorti de la boucle interne : ces trois termes ne dependent que de la ligne.
    const bv = b * v + c
    const ev = e * v + f
    const hv = h * v + 1
    const debutLigne = v * largeur

    for (let u = 0; u < largeur; u += 1) {
      const poids = g * u + hv
      if (poids === 0) {
        pixels[debutLigne + u] = HORS_CADRE
        continue
      }
      // Une seule division par pixel : c'est l'operation dominante de toute la sous-etape.
      const inverse = 1 / poids
      pixels[debutLigne + u] = bilineaire(source, (a * u + bv) * inverse, (d * u + ev) * inverse)
    }
  }

  return { pixels, largeur, hauteur }
}

function bilineaire(source: Etat, x: number, y: number): number {
  if (x < 0 || y < 0 || x > source.largeur - 1 || y > source.hauteur - 1) {
    return HORS_CADRE
  }

  const gauche = Math.floor(x)
  const haut = Math.floor(y)
  const droite = Math.min(gauche + 1, source.largeur - 1)
  const bas = Math.min(haut + 1, source.hauteur - 1)
  const partX = x - gauche
  const partY = y - haut

  const ligneHaute = haut * source.largeur
  const ligneBasse = bas * source.largeur
  const hautGauche = lire(source.pixels, ligneHaute + gauche)
  const hautDroit = lire(source.pixels, ligneHaute + droite)
  const basGauche = lire(source.pixels, ligneBasse + gauche)
  const basDroit = lire(source.pixels, ligneBasse + droite)

  const enHaut = hautGauche + (hautDroit - hautGauche) * partX
  const enBas = basGauche + (basDroit - basGauche) * partX
  return Math.round(enHaut + (enBas - enHaut) * partY)
}
