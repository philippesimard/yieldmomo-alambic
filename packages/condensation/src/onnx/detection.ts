import type { Gris } from './pixels'
import {
  coins,
  contient,
  elargir,
  type Point,
  type RectangleOriente,
  rectangleMinimal,
} from './rectangle'

// Les reglages du modele PP-OCRv5_mobile_det tels que le sidecar Paddle les applique : ils sont
// relus dans son inference.yml et dans le serveur, pour que les deux moteurs voient les memes
// boites.

// La Chauffe sort jusqu'a 2000 px de large ; la limite par defaut du modele (~960) mangerait les
// petits caracteres. Elle porte sur le plus long cote.
const LIMITE_COTE = 2016

// Le reseau exige des dimensions multiples de 32.
const MULTIPLE = 32

// Normalisation ImageNet, canal par canal, dans l'ordre BGR ou le modele les attend. L'image est
// grise : les trois canaux portent la meme valeur, mais pas la meme moyenne.
const MOYENNE = [0.485, 0.456, 0.406] as const
const ECART_TYPE = [0.229, 0.224, 0.225] as const

// Post-traitement DB : un pixel est du texte au-dela du seuil, une region n'est retenue que si sa
// probabilite moyenne passe le seuil de boite, puis elle est elargie (le modele detecte le coeur
// des caracteres, pas leur contour).
const SEUIL_PIXEL = 0.3
const SEUIL_BOITE = 0.6
const RAPPORT_ELARGISSEMENT = 1.5
const COTE_MIN = 3
const CANDIDATS_MAX = 1000

// Une ligne detectee : son quadrilatere (haut-gauche, haut-droit, bas-droit, bas-gauche), qui
// suit l'inclinaison du texte, et le rectangle droit qui l'englobe.
export type Boite = {
  coins: [Point, Point, Point, Point]
  x0: number
  y0: number
  x1: number
  y1: number
  score: number
}

// Les dimensions que le reseau recoit, comme resize_image_type0 de PaddleX.
export function dimensionsDetection(
  largeur: number,
  hauteur: number,
): { largeur: number; hauteur: number } {
  const ratio =
    Math.max(largeur, hauteur) > LIMITE_COTE ? LIMITE_COTE / Math.max(largeur, hauteur) : 1
  return {
    largeur: multipleDe(Math.trunc(largeur * ratio)),
    hauteur: multipleDe(Math.trunc(hauteur * ratio)),
  }
}

// Python arrondit les demis au pair (round(2.5) = 2) : on fait de meme pour tomber sur les memes
// dimensions que Paddle.
function multipleDe(cote: number): number {
  const quotient = cote / MULTIPLE
  const plancher = Math.floor(quotient)
  const reste = quotient - plancher
  const arrondi = reste === 0.5 ? plancher + (plancher % 2) : Math.round(quotient)
  return Math.max(arrondi * MULTIPLE, MULTIPLE)
}

// Le tenseur [1, 3, H, W] d'une image deja redimensionnee.
export function tenseurDetection(image: Gris): Float32Array {
  const surface = image.largeur * image.hauteur
  const donnees = new Float32Array(3 * surface)
  for (let canal = 0; canal < 3; canal++) {
    const moyenne = MOYENNE[canal] ?? 0
    const ecart = ECART_TYPE[canal] ?? 1
    const decalage = canal * surface
    for (let indice = 0; indice < surface; indice++) {
      donnees[decalage + indice] = ((image.pixels[indice] ?? 0) / 255 - moyenne) / ecart
    }
  }
  return donnees
}

// Les boites de texte de la carte de probabilites, en coordonnees de l'image source.
export function boitesDepuisCarte(
  carte: Float32Array,
  largeur: number,
  hauteur: number,
  largeurSource: number,
  hauteurSource: number,
): Boite[] {
  const echelleX = largeurSource / largeur
  const echelleY = hauteurSource / hauteur
  const boites: Boite[] = []
  for (const region of regions(carte, largeur, hauteur).slice(0, CANDIDATS_MAX)) {
    const rectangle = rectangleMinimal(region)
    const longueur = rectangle.u1 - rectangle.u0
    const epaisseur = rectangle.v1 - rectangle.v0
    if (Math.min(longueur, epaisseur) < COTE_MIN) continue

    const score = moyenneDans(carte, largeur, hauteur, rectangle)
    if (score < SEUIL_BOITE) continue

    // L'elargissement de Paddle (pyclipper, coins arrondis) d'une distance aire x rapport /
    // perimetre ; le rectangle d'aire minimale du resultat est le rectangle elargi d'autant.
    const distance = (longueur * epaisseur * RAPPORT_ELARGISSEMENT) / (2 * (longueur + epaisseur))
    if (Math.min(longueur, epaisseur) + 2 * distance < COTE_MIN + 2) continue

    const sommets = coins(elargir(rectangle, distance)).map((coin) => ({
      x: borner(Math.round(coin.x * echelleX), largeurSource),
      y: borner(Math.round(coin.y * echelleY), hauteurSource),
    }))
    const xs = sommets.map((coin) => coin.x)
    const ys = sommets.map((coin) => coin.y)
    boites.push({
      // Sur : coins() rend toujours quatre sommets, et map en garde le nombre.
      coins: sommets as Boite['coins'],
      x0: Math.min(...xs),
      y0: Math.min(...ys),
      x1: Math.max(...xs),
      y1: Math.max(...ys),
      score,
    })
  }
  return boites
}

// Les composantes connexes (8 voisins) des pixels au-dessus du seuil, chacune resumee par les
// extremites de ses rangees : leur enveloppe convexe est celle de toute la composante.
function regions(carte: Float32Array, largeur: number, hauteur: number): Point[][] {
  const vues = new Uint8Array(largeur * hauteur)
  const pile = new Int32Array(largeur * hauteur)
  const trouvees: Point[][] = []
  for (let depart = 0; depart < carte.length; depart++) {
    if (vues[depart] === 1 || (carte[depart] ?? 0) <= SEUIL_PIXEL) continue

    const rangees = new Map<number, { min: number; max: number }>()
    let sommet = 0
    pile[sommet++] = depart
    vues[depart] = 1
    while (sommet > 0) {
      const indice = pile[--sommet] ?? 0
      const x = indice % largeur
      const y = (indice - x) / largeur
      const rangee = rangees.get(y)
      if (rangee === undefined) rangees.set(y, { min: x, max: x })
      else {
        rangee.min = Math.min(rangee.min, x)
        rangee.max = Math.max(rangee.max, x)
      }
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= hauteur) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= largeur) continue
          const voisin = ny * largeur + nx
          if (vues[voisin] === 1 || (carte[voisin] ?? 0) <= SEUIL_PIXEL) continue
          vues[voisin] = 1
          pile[sommet++] = voisin
        }
      }
    }
    trouvees.push(
      [...rangees].flatMap(([y, { min, max }]) => [
        { x: min, y },
        { x: max, y },
      ]),
    )
  }
  return trouvees
}

// Le score « rapide » de Paddle : la probabilite moyenne des pixels couverts par le rectangle.
function moyenneDans(
  carte: Float32Array,
  largeur: number,
  hauteur: number,
  rectangle: RectangleOriente,
): number {
  const sommets = coins(rectangle)
  const xs = sommets.map((coin) => coin.x)
  const ys = sommets.map((coin) => coin.y)
  const xMin = borner(Math.floor(Math.min(...xs)), largeur - 1)
  const xMax = borner(Math.ceil(Math.max(...xs)), largeur - 1)
  const yMin = borner(Math.floor(Math.min(...ys)), hauteur - 1)
  const yMax = borner(Math.ceil(Math.max(...ys)), hauteur - 1)
  let somme = 0
  let couverts = 0
  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      if (!contient(rectangle, { x, y })) continue
      somme += carte[y * largeur + x] ?? 0
      couverts++
    }
  }
  return couverts === 0 ? 0 : somme / couverts
}

function borner(valeur: number, maximum: number): number {
  return Math.max(0, Math.min(valeur, maximum))
}
