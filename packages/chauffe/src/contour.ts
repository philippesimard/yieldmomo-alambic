import type { Point } from './homographie'

// La geometrie d'une region : de quoi passer d'un masque de pixels a quatre coins. Rien ici ne
// sait ce qu'est un document ni une photo, uniquement ce qu'est une forme.

export type Region = {
  masque: Uint8Array
  largeur: number
  hauteur: number
  aire: number
  // Pour chacun des quatre bords du cadre — haut, droite, bas, gauche — la part de sa longueur
  // que la region couvre. Un cote largement couvert est un cote ou le document sort de la
  // photo, donc du contenu perdu. C'est plus parlant qu'un contact global : deux cotes opposes
  // coupes, c'est un ticket ampute par les deux bouts.
  bordsCouverts: [number, number, number, number]
}

const DEDANS = 1
const DEHORS = 0

// La plus grande tache d'un seul tenant, trous bouches.
//
// Deux passes en une : d'abord la plus grande composante connexe, ce qui ecarte la fenetre
// surexposee ou la nappe claire au profit du document ; ensuite le bouchage des trous, ce qui
// absorbe le doigt qui masque un bord, une ombre portee, un pli.
export function plusGrandeRegion(
  candidat: Uint8Array,
  largeur: number,
  hauteur: number,
): Region | undefined {
  const etiquettes = new Int32Array(largeur * hauteur).fill(-1)
  const pile = new Int32Array(largeur * hauteur)
  let meilleure = -1
  let meilleureAire = 0
  let etiquette = 0

  for (let depart = 0; depart < candidat.length; depart += 1) {
    if (candidat[depart] !== DEDANS || etiquettes[depart] !== -1) {
      continue
    }
    const aire = remplir(candidat, etiquettes, pile, largeur, hauteur, depart, DEDANS, etiquette)
    if (aire > meilleureAire) {
      meilleureAire = aire
      meilleure = etiquette
    }
    etiquette += 1
  }

  if (meilleure === -1) {
    return undefined
  }

  const masque = new Uint8Array(largeur * hauteur)
  for (let i = 0; i < masque.length; i += 1) {
    masque[i] = etiquettes[i] === meilleure ? DEDANS : DEHORS
  }

  boucherTrous(masque, pile, largeur, hauteur)

  let aire = 0
  for (let i = 0; i < masque.length; i += 1) {
    if (masque[i] === DEDANS) {
      aire += 1
    }
  }

  return { masque, largeur, hauteur, aire, bordsCouverts: bordsCouverts(masque, largeur, hauteur) }
}

// Remplissage par pile explicite et non par recursion : une region peut couvrir la photo
// entiere, et autant d'appels imbriques feraient deborder la pile d'appels.
function remplir(
  source: Uint8Array,
  etiquettes: Int32Array,
  pile: Int32Array,
  largeur: number,
  hauteur: number,
  depart: number,
  valeur: number,
  etiquette: number,
): number {
  let sommet = 0
  let aire = 0
  pile[sommet] = depart
  sommet += 1
  etiquettes[depart] = etiquette

  while (sommet > 0) {
    sommet -= 1
    const indice = pile[sommet] ?? 0
    aire += 1
    const x = indice % largeur
    const y = (indice - x) / largeur

    for (const voisin of [
      x > 0 ? indice - 1 : -1,
      x < largeur - 1 ? indice + 1 : -1,
      y > 0 ? indice - largeur : -1,
      y < hauteur - 1 ? indice + largeur : -1,
    ]) {
      if (voisin < 0 || etiquettes[voisin] !== -1 || source[voisin] !== valeur) {
        continue
      }
      etiquettes[voisin] = etiquette
      pile[sommet] = voisin
      sommet += 1
    }
  }

  return aire
}

// Tout ce qui est hors du masque sans etre joignable depuis le bord du cadre est un trou.
function boucherTrous(masque: Uint8Array, pile: Int32Array, largeur: number, hauteur: number) {
  const atteint = new Int32Array(largeur * hauteur).fill(-1)

  for (const depart of bordsDuCadre(largeur, hauteur)) {
    if (masque[depart] === DEHORS && atteint[depart] === -1) {
      remplir(masque, atteint, pile, largeur, hauteur, depart, DEHORS, 0)
    }
  }

  for (let i = 0; i < masque.length; i += 1) {
    if (masque[i] === DEHORS && atteint[i] === -1) {
      masque[i] = DEDANS
    }
  }
}

function* bordsDuCadre(largeur: number, hauteur: number): Generator<number> {
  for (let x = 0; x < largeur; x += 1) {
    yield x
    yield (hauteur - 1) * largeur + x
  }
  for (let y = 0; y < hauteur; y += 1) {
    yield y * largeur
    yield y * largeur + largeur - 1
  }
}

function bordsCouverts(
  masque: Uint8Array,
  largeur: number,
  hauteur: number,
): [number, number, number, number] {
  const part = (compte: number, longueur: number): number =>
    longueur === 0 ? 0 : compte / longueur
  let haut = 0
  let bas = 0
  let gauche = 0
  let droite = 0

  for (let x = 0; x < largeur; x += 1) {
    if (masque[x] === DEDANS) {
      haut += 1
    }
    if (masque[(hauteur - 1) * largeur + x] === DEDANS) {
      bas += 1
    }
  }
  for (let y = 0; y < hauteur; y += 1) {
    if (masque[y * largeur] === DEDANS) {
      gauche += 1
    }
    if (masque[y * largeur + largeur - 1] === DEDANS) {
      droite += 1
    }
  }

  return [part(haut, largeur), part(droite, hauteur), part(bas, largeur), part(gauche, hauteur)]
}

// La boite englobante de la region, en coordonnees de la region.
export function boiteEnglobante(region: Region): {
  gauche: number
  haut: number
  droite: number
  bas: number
} {
  let gauche = region.largeur
  let droite = -1
  let haut = region.hauteur
  let bas = -1

  for (let y = 0; y < region.hauteur; y += 1) {
    const ligne = y * region.largeur
    for (let x = 0; x < region.largeur; x += 1) {
      if (region.masque[ligne + x] !== DEDANS) {
        continue
      }
      if (x < gauche) gauche = x
      if (x > droite) droite = x
      if (y < haut) haut = y
      if (y > bas) bas = y
    }
  }

  return { gauche, haut, droite, bas }
}

// L'enveloppe convexe de la region, en parcours monotone d'Andrew. On part de l'enveloppe et
// non du contour brut parce qu'un document est convexe : ses golfes sont des accidents (un
// doigt, une ombre) dont on veut precisement se debarrasser.
export function enveloppeConvexe(region: Region): Point[] {
  const points: Point[] = []
  const { masque, largeur, hauteur } = region

  // Les extremes gauche et droit de chaque ligne suffisent : aucun point interieur ne peut etre
  // sur l'enveloppe, et cela ramene des dizaines de milliers de pixels a quelques centaines.
  for (let y = 0; y < hauteur; y += 1) {
    const ligne = y * largeur
    let gauche = -1
    let droite = -1
    for (let x = 0; x < largeur; x += 1) {
      if (masque[ligne + x] === DEDANS) {
        if (gauche === -1) {
          gauche = x
        }
        droite = x
      }
    }
    if (gauche !== -1) {
      points.push({ x: gauche, y })
      if (droite !== gauche) {
        points.push({ x: droite, y })
      }
    }
  }

  if (points.length < 3) {
    return points
  }

  points.sort((a, b) => a.x - b.x || a.y - b.y)

  const bas: Point[] = []
  for (const point of points) {
    while (bas.length >= 2 && produitCroise(bas[bas.length - 2], bas[bas.length - 1], point) <= 0) {
      bas.pop()
    }
    bas.push(point)
  }

  const haut: Point[] = []
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const point = points[i]
    if (point === undefined) {
      continue
    }
    while (
      haut.length >= 2 &&
      produitCroise(haut[haut.length - 2], haut[haut.length - 1], point) <= 0
    ) {
      haut.pop()
    }
    haut.push(point)
  }

  bas.pop()
  haut.pop()
  return [...bas, ...haut]
}

function produitCroise(origine?: Point, premier?: Point, second?: Point): number {
  if (origine === undefined || premier === undefined || second === undefined) {
    return 0
  }
  return (
    (premier.x - origine.x) * (second.y - origine.y) -
    (premier.y - origine.y) * (second.x - origine.x)
  )
}

// L'aire d'un polygone, par la formule du lacet.
export function airePolygone(sommets: readonly Point[]): number {
  let total = 0
  for (let i = 0; i < sommets.length; i += 1) {
    const courant = sommets[i]
    const suivant = sommets[(i + 1) % sommets.length]
    if (courant === undefined || suivant === undefined) {
      continue
    }
    total += courant.x * suivant.y - suivant.x * courant.y
  }
  return Math.abs(total / 2)
}

// Le quadrilatere qui resume le polygone : on simplifie de plus en plus fort jusqu'a ce qu'il
// ne reste que quatre sommets. Une tolerance fixe ne marcherait pas — elle depend de la taille
// du document et de la regularite de ses bords, qu'on ne connait pas d'avance.
export function quatreSommets(polygone: readonly Point[], diagonale: number): Point[] | undefined {
  if (polygone.length < 4) {
    return undefined
  }
  if (polygone.length === 4) {
    return [...polygone]
  }

  const TOLERANCE_DEPART = 0.002
  const TOLERANCE_FIN = 0.25
  const CROISSANCE = 1.15

  for (let part = TOLERANCE_DEPART; part < TOLERANCE_FIN; part *= CROISSANCE) {
    const simplifie = simplifier(polygone, part * diagonale)
    if (simplifie.length === 4) {
      return simplifie
    }
    if (simplifie.length < 4) {
      // On vient de sauter de cinq sommets ou plus a moins de quatre : le polygone n'a pas de
      // palier a quatre, donc pas de forme de quadrilatere.
      return undefined
    }
  }

  return undefined
}

// Douglas-Peucker sur un polygone ferme : on duplique le premier sommet en fin de liste pour le
// traiter comme une ligne ouverte, puis on retire le doublon.
//
// Le point de depart n'est pas quelconque : il est toujours conserve par l'algorithme, donc il
// doit etre un vrai coin, sans quoi il occupe une des quatre places pour rien. Le sommet le plus
// eloigne du centre en est forcement un — c'est ce qui distingue un coin d'un point de bord.
function simplifier(polygone: readonly Point[], tolerance: number): Point[] {
  const depart = plusEloigneDuCentre(polygone)
  const tourne = [...polygone.slice(depart), ...polygone.slice(0, depart)]
  const premier = tourne[0]
  if (premier === undefined) {
    return []
  }
  const ferme = [...tourne, premier]
  const garde = new Uint8Array(ferme.length)
  garde[0] = 1
  garde[ferme.length - 1] = 1
  decouper(ferme, 0, ferme.length - 1, tolerance, garde)

  const retenus: Point[] = []
  for (let i = 0; i < ferme.length - 1; i += 1) {
    const point = ferme[i]
    if (garde[i] === 1 && point !== undefined) {
      retenus.push(point)
    }
  }
  return retenus
}

function plusEloigneDuCentre(polygone: readonly Point[]): number {
  const centre = {
    x: polygone.reduce((somme, sommet) => somme + sommet.x, 0) / polygone.length,
    y: polygone.reduce((somme, sommet) => somme + sommet.y, 0) / polygone.length,
  }

  let indice = 0
  let record = -1
  for (let i = 0; i < polygone.length; i += 1) {
    const sommet = polygone[i]
    if (sommet === undefined) {
      continue
    }
    const ecart = Math.hypot(sommet.x - centre.x, sommet.y - centre.y)
    if (ecart > record) {
      record = ecart
      indice = i
    }
  }
  return indice
}

function decouper(
  points: readonly Point[],
  debut: number,
  fin: number,
  tolerance: number,
  garde: Uint8Array,
) {
  if (fin <= debut + 1) {
    return
  }
  const depart = points[debut]
  const arrivee = points[fin]
  if (depart === undefined || arrivee === undefined) {
    return
  }

  let pire = debut
  let pireEcart = 0
  for (let i = debut + 1; i < fin; i += 1) {
    const point = points[i]
    if (point === undefined) {
      continue
    }
    const ecart = distanceAuSegment(point, depart, arrivee)
    if (ecart > pireEcart) {
      pireEcart = ecart
      pire = i
    }
  }

  if (pireEcart <= tolerance) {
    return
  }
  garde[pire] = 1
  decouper(points, debut, pire, tolerance, garde)
  decouper(points, pire, fin, tolerance, garde)
}

function distanceAuSegment(point: Point, depart: Point, arrivee: Point): number {
  const dx = arrivee.x - depart.x
  const dy = arrivee.y - depart.y
  const longueur = dx * dx + dy * dy
  if (longueur === 0) {
    return Math.hypot(point.x - depart.x, point.y - depart.y)
  }
  const part = Math.max(
    0,
    Math.min(1, ((point.x - depart.x) * dx + (point.y - depart.y) * dy) / longueur),
  )
  return Math.hypot(point.x - (depart.x + part * dx), point.y - (depart.y + part * dy))
}

// Les sommets remis dans l'ordre horaire depuis le coin haut-gauche, pour que l'homographie
// sache quel coin va ou. L'angle depuis le centre suffit : le polygone est convexe.
export function ordonnerHoraire(sommets: readonly Point[]): Point[] {
  const centre = {
    x: sommets.reduce((somme, sommet) => somme + sommet.x, 0) / sommets.length,
    y: sommets.reduce((somme, sommet) => somme + sommet.y, 0) / sommets.length,
  }
  const parAngle = [...sommets].sort(
    (a, b) =>
      Math.atan2(a.y - centre.y, a.x - centre.x) - Math.atan2(b.y - centre.y, b.x - centre.x),
  )

  // atan2 part de l'axe des x vers la droite ; le coin haut-gauche est celui de plus petite
  // somme x+y, et c'est par lui que l'homographie attend qu'on commence.
  let premier = 0
  for (let i = 1; i < parAngle.length; i += 1) {
    const candidat = parAngle[i]
    const tenant = parAngle[premier]
    if (
      candidat !== undefined &&
      tenant !== undefined &&
      candidat.x + candidat.y < tenant.x + tenant.y
    ) {
      premier = i
    }
  }
  return [...parAngle.slice(premier), ...parAngle.slice(0, premier)]
}
