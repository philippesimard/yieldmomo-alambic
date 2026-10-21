import type { Point } from './rectangle'

// Une image en niveaux de gris, un octet par pixel, ligne apres ligne.
export type Gris = {
  pixels: Uint8Array
  largeur: number
  hauteur: number
}

// Redimensionnement bilineaire a la maniere d'OpenCV (cv2.INTER_LINEAR), arrondi a l'octet comme
// lui : les modeles ont ete entraines et regles sur ses sorties. Le noyau de sharp, qui moyenne
// les pixels a la reduction, deplacerait les boites detectees.
export function redimensionner(source: Gris, largeur: number, hauteur: number): Gris {
  if (largeur === source.largeur && hauteur === source.hauteur) return source

  const pixels = new Uint8Array(largeur * hauteur)
  const echelleX = source.largeur / largeur
  const echelleY = source.hauteur / hauteur
  const colonnes = coordonnees(largeur, echelleX, source.largeur)
  for (let y = 0; y < hauteur; y++) {
    const [ligne, fy] = coordonnee(y, echelleY, source.hauteur)
    const haut = ligne * source.largeur
    const bas = Math.min(ligne + 1, source.hauteur - 1) * source.largeur
    for (let x = 0; x < largeur; x++) {
      const colonne = colonnes.indices[x] ?? 0
      const fx = colonnes.poids[x] ?? 0
      const droite = Math.min(colonne + 1, source.largeur - 1)
      const valeur =
        (1 - fy) * ((1 - fx) * at(source, haut + colonne) + fx * at(source, haut + droite)) +
        fy * ((1 - fx) * at(source, bas + colonne) + fx * at(source, bas + droite))
      pixels[y * largeur + x] = Math.round(valeur)
    }
  }
  return { pixels, largeur, hauteur }
}

// La position source d'un pixel de destination, centres alignes, bornee comme OpenCV la borne.
function coordonnee(destination: number, echelle: number, taille: number): [number, number] {
  const exacte = (destination + 0.5) * echelle - 0.5
  const entiere = Math.floor(exacte)
  if (entiere < 0) return [0, 0]
  if (entiere >= taille - 1) return [taille - 1, 0]
  return [entiere, exacte - entiere]
}

// Les colonnes se recalculeraient a chaque ligne : on les calcule une fois.
function coordonnees(
  largeur: number,
  echelle: number,
  taille: number,
): { indices: Int32Array; poids: Float32Array } {
  const indices = new Int32Array(largeur)
  const poids = new Float32Array(largeur)
  for (let x = 0; x < largeur; x++) {
    const [colonne, fx] = coordonnee(x, echelle, taille)
    indices[x] = colonne
    poids[x] = fx
  }
  return { indices, poids }
}

function at(image: Gris, indice: number): number {
  return image.pixels[indice] ?? 0
}

// La rognure d'un quadrilatere (haut-gauche, haut-droit, bas-droit, bas-gauche) remise a plat,
// comme get_rotate_crop_image de Paddle : une ligne un peu penchee se lit redressee.
export function redresser(
  image: Gris,
  [hautGauche, hautDroit, basDroit, basGauche]: readonly [Point, Point, Point, Point],
): Gris {
  const largeur = Math.max(
    1,
    Math.trunc(Math.max(distance(hautGauche, hautDroit), distance(basDroit, basGauche))),
  )
  const hauteur = Math.max(
    1,
    Math.trunc(Math.max(distance(hautGauche, basGauche), distance(hautDroit, basDroit))),
  )
  const pixels = new Uint8Array(largeur * hauteur)
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      const u = x / largeur
      const v = y / hauteur
      const sx = hautGauche.x + u * (hautDroit.x - hautGauche.x) + v * (basGauche.x - hautGauche.x)
      const sy = hautGauche.y + u * (hautDroit.y - hautGauche.y) + v * (basGauche.y - hautGauche.y)
      pixels[y * largeur + x] = Math.round(echantillon(image, sx, sy))
    }
  }
  return { pixels, largeur, hauteur }
}

// Interpolation bicubique d'OpenCV (cv2.INTER_CUBIC, A = -0,75), bords prolonges : celle que
// Paddle applique a ses rognures. La bilineaire adoucit les traits et perd des premiers chiffres
// (« 10.50 » lu « 0.50 »).
const CUBIQUE = -0.75

function echantillon(image: Gris, x: number, y: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const poidsX = poidsCubiques(x - x0)
  const poidsY = poidsCubiques(y - y0)
  let valeur = 0
  for (let j = 0; j < 4; j++) {
    const by = Math.max(0, Math.min(y0 - 1 + j, image.hauteur - 1)) * image.largeur
    let ligne = 0
    for (let i = 0; i < 4; i++) {
      const bx = Math.max(0, Math.min(x0 - 1 + i, image.largeur - 1))
      ligne += (poidsX[i] ?? 0) * (image.pixels[by + bx] ?? 0)
    }
    valeur += (poidsY[j] ?? 0) * ligne
  }
  return Math.max(0, Math.min(255, valeur))
}

function poidsCubiques(t: number): [number, number, number, number] {
  const a = CUBIQUE
  const w0 = ((a * (t + 1) - 5 * a) * (t + 1) + 8 * a) * (t + 1) - 4 * a
  const w1 = ((a + 2) * t - (a + 3)) * t * t + 1
  const w2 = ((a + 2) * (1 - t) - (a + 3)) * (1 - t) * (1 - t) + 1
  return [w0, w1, w2, 1 - w0 - w1 - w2]
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

// Quart de tour dans le sens antihoraire, comme np.rot90 : un texte imprime a la verticale se lit
// une fois couche.
export function tourner(image: Gris): Gris {
  const pixels = new Uint8Array(image.largeur * image.hauteur)
  for (let y = 0; y < image.hauteur; y++) {
    for (let x = 0; x < image.largeur; x++) {
      pixels[(image.largeur - 1 - x) * image.hauteur + y] = image.pixels[y * image.largeur + x] ?? 0
    }
  }
  return { pixels, largeur: image.hauteur, hauteur: image.largeur }
}
