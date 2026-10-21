export type Point = { x: number; y: number }

// Un rectangle oriente, decrit dans son propre repere : un point p y a pour coordonnees
// u = p . axe et v = p . normale, et le rectangle couvre [u0, u1] x [v0, v1]. Elargir, tester
// l'appartenance et lire les coins deviennent des operations sur quatre nombres.
export type RectangleOriente = {
  axe: Point
  u0: number
  u1: number
  v0: number
  v1: number
}

// Le rectangle d'aire minimale qui contient les points, comme cv2.minAreaRect : l'un de ses cotes
// porte toujours une arete de l'enveloppe convexe, il suffit donc de les essayer toutes.
export function rectangleMinimal(points: readonly Point[]): RectangleOriente {
  const enveloppe = enveloppeConvexe(points)
  let meilleur = cadrer(enveloppe, { x: 1, y: 0 })
  for (let indice = 0; indice < enveloppe.length; indice++) {
    const a = enveloppe[indice]
    const b = enveloppe[(indice + 1) % enveloppe.length]
    if (a === undefined || b === undefined) continue
    const longueur = Math.hypot(b.x - a.x, b.y - a.y)
    if (longueur === 0) continue
    const candidat = cadrer(enveloppe, { x: (b.x - a.x) / longueur, y: (b.y - a.y) / longueur })
    if (aire(candidat) < aire(meilleur)) meilleur = candidat
  }
  return meilleur
}

export function elargir(rectangle: RectangleOriente, distance: number): RectangleOriente {
  return {
    axe: rectangle.axe,
    u0: rectangle.u0 - distance,
    u1: rectangle.u1 + distance,
    v0: rectangle.v0 - distance,
    v1: rectangle.v1 + distance,
  }
}

export function contient(rectangle: RectangleOriente, point: Point): boolean {
  const { u, v } = projeter(point, rectangle.axe)
  return (
    u >= rectangle.u0 - EPSILON &&
    u <= rectangle.u1 + EPSILON &&
    v >= rectangle.v0 - EPSILON &&
    v <= rectangle.v1 + EPSILON
  )
}

// Les coins dans l'ordre haut-gauche, haut-droit, bas-droit, bas-gauche, choisis comme le fait
// Paddle (get_mini_boxes) : les deux plus a gauche, puis chacun des deux couples trie par hauteur.
export function coins(rectangle: RectangleOriente): [Point, Point, Point, Point] {
  const { axe, u0, u1, v0, v1 } = rectangle
  const coin = (u: number, v: number): Point => ({
    x: u * axe.x - v * axe.y,
    y: u * axe.y + v * axe.x,
  })
  const tries = [coin(u0, v0), coin(u1, v0), coin(u1, v1), coin(u0, v1)].sort((a, b) => a.x - b.x)
  // Sur : un rectangle a toujours quatre coins.
  const [a, b, c, d] = tries as [Point, Point, Point, Point]
  const [hautGauche, basGauche] = b.y > a.y ? [a, b] : [b, a]
  const [hautDroit, basDroit] = d.y > c.y ? [c, d] : [d, c]
  return [hautGauche, hautDroit, basDroit, basGauche]
}

// Un point pile sur le bord compte dedans, comme un pixel trace par cv2.fillPoly.
const EPSILON = 1e-6

function projeter(point: Point, axe: Point): { u: number; v: number } {
  return { u: point.x * axe.x + point.y * axe.y, v: -point.x * axe.y + point.y * axe.x }
}

function cadrer(points: readonly Point[], axe: Point): RectangleOriente {
  let u0 = Number.POSITIVE_INFINITY
  let u1 = Number.NEGATIVE_INFINITY
  let v0 = Number.POSITIVE_INFINITY
  let v1 = Number.NEGATIVE_INFINITY
  for (const point of points) {
    const { u, v } = projeter(point, axe)
    u0 = Math.min(u0, u)
    u1 = Math.max(u1, u)
    v0 = Math.min(v0, v)
    v1 = Math.max(v1, v)
  }
  return { axe, u0, u1, v0, v1 }
}

function aire(rectangle: RectangleOriente): number {
  return (rectangle.u1 - rectangle.u0) * (rectangle.v1 - rectangle.v0)
}

// Enveloppe convexe par la chaine monotone d'Andrew.
function enveloppeConvexe(points: readonly Point[]): Point[] {
  const tries = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (tries.length < 3) return tries
  const bas: Point[] = []
  for (const point of tries) {
    while (bas.length >= 2 && produit(bas.at(-2), bas.at(-1), point) <= 0) bas.pop()
    bas.push(point)
  }
  const haut: Point[] = []
  for (const point of [...tries].reverse()) {
    while (haut.length >= 2 && produit(haut.at(-2), haut.at(-1), point) <= 0) haut.pop()
    haut.push(point)
  }
  return [...bas.slice(0, -1), ...haut.slice(0, -1)]
}

function produit(o: Point | undefined, a: Point | undefined, b: Point): number {
  if (o === undefined || a === undefined) return 0
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}
