import { apercusDe } from './apercus'
import { BLANC, depuis, type Etat, enEtat, lire, reduire, type Sortie } from './etat'
import { ENCRE, seuillerAdaptatif } from './seuil'

// L'angle se mesure sur une miniature : l'inclinaison d'une page est une propriete de sa mise
// en page, pas de sa resolution, et un dixieme de degre se voit deja a cette taille.
const LARGEUR_MESURE = 800

// Au-dela, ce n'est plus un residu de redressement mais une photo prise de travers, et la
// projection trouverait autant de maxima que de colonnes de chiffres.
const ANGLE_MAX = 10
const PAS_GROSSIER = 1
const PAS_FIN = 0.1

// En dessous, tourner l'image couterait une interpolation complete pour un gain que l'ocr ne
// verrait pas.
const ANGLE_NEGLIGEABLE = 0.2

const POINTS_MAX = 40_000

// La meme fenetre que la binarisation : c'est le texte qu'on veut isoler, pas le document sur
// son fond. Un seuil global prendrait le fond de table pour de l'encre et mesurerait l'angle
// d'une nappe.
const PART_FENETRE = 0.05

// Hors de cette plage, ce qui a ete pris pour de l'encre est une ombre ou une surexposition, et
// mesurer un angle dessus n'aurait aucun sens.
const PART_ENCRE_MIN = 0.002
const PART_ENCRE_MAX = 0.4

export async function redresser(etat: Etat): Promise<Sortie<Etat>> {
  const mesure = await reduire(etat, LARGEUR_MESURE)
  const seuillage = seuillerAdaptatif(mesure, PART_FENETRE)
  const encre = pointsEncre(seuillage.binaire)

  if (seuillage.partEncre < PART_ENCRE_MIN || seuillage.partEncre > PART_ENCRE_MAX) {
    return {
      valeur: etat,
      motif: `Le seuillage ne trouve que ${Math.round(seuillage.partEncre * 100)} % de pixels d'encre : trop peu ou trop pour y lire des lignes de texte. L'image passe sans rotation.`,
      apercus: apercusDe(seuillage.binaire, {
        angle: 0,
        tourne: false,
        partEncre: arrondir(seuillage.partEncre),
      }),
    }
  }

  const angle = meilleurAngle(encre, mesure)

  if (Math.abs(angle) < ANGLE_NEGLIGEABLE) {
    return {
      valeur: etat,
      apercus: apercusDe(etat, {
        angle: arrondir(angle),
        tourne: false,
        seuilNegligeable: ANGLE_NEGLIGEABLE,
        partEncre: arrondir(seuillage.partEncre),
      }),
    }
  }

  // L'angle mesure est l'inclinaison du texte, en repere image ou les y descendent. Pour la
  // ramener a l'horizontale, il faut tourner en sens inverse : sharp compte les angles positifs
  // dans le sens horaire.
  const tourne = await enEtat(depuis(etat).rotate(-angle, { background: BLANC }))

  return {
    valeur: tourne,
    apercus: apercusDe(tourne, {
      angle: arrondir(angle),
      tourne: true,
      avant: [etat.largeur, etat.hauteur],
      apres: [tourne.largeur, tourne.hauteur],
      partEncre: arrondir(seuillage.partEncre),
    }),
  }
}

type Encre = { xs: Int32Array; ys: Int32Array; compte: number }

// Les coordonnees des pixels d'encre, echantillonnees. Le score se calcule pour une
// soixantaine d'angles : au-dela du plafond, chaque point supplementaire coute soixante fois
// sans rien ajouter a la precision de l'angle.
function pointsEncre(binaire: Etat): Encre {
  let total = 0
  for (let i = 0; i < binaire.pixels.length; i += 1) {
    if (lire(binaire.pixels, i) === ENCRE) {
      total += 1
    }
  }

  const pas = Math.max(1, Math.ceil(total / POINTS_MAX))
  const retenus = Math.ceil(total / pas)
  const xs = new Int32Array(retenus)
  const ys = new Int32Array(retenus)

  let rencontres = 0
  let compte = 0
  for (let y = 0; y < binaire.hauteur; y += 1) {
    const ligne = y * binaire.largeur
    for (let x = 0; x < binaire.largeur; x += 1) {
      if (lire(binaire.pixels, ligne + x) !== ENCRE) {
        continue
      }
      if (rencontres % pas === 0 && compte < retenus) {
        xs[compte] = x
        ys[compte] = y
        compte += 1
      }
      rencontres += 1
    }
  }

  return { xs, ys, compte }
}

// Deux passes : une grille au degre pour trouver le bon voisinage, puis un dixieme de degre
// dedans. Balayer tout l'intervalle au dixieme couterait dix fois plus pour le meme angle.
function meilleurAngle(encre: Encre, etat: Etat): number {
  const marge = Math.ceil(Math.tan((ANGLE_MAX * Math.PI) / 180) * etat.largeur) + 1
  const profil = new Int32Array(etat.hauteur + 2 * marge)

  const grossier = balayer(
    encre,
    profil,
    marge,
    -ANGLE_MAX,
    PAS_GROSSIER,
    (2 * ANGLE_MAX) / PAS_GROSSIER,
  )
  const pasFins = Math.round((2 * PAS_GROSSIER) / PAS_FIN)
  return balayer(encre, profil, marge, grossier - PAS_GROSSIER, PAS_FIN, pasFins)
}

function balayer(
  encre: Encre,
  profil: Int32Array,
  marge: number,
  depart: number,
  pas: number,
  nombre: number,
): number {
  let meilleur = depart
  let meilleurScore = -1

  for (let i = 0; i <= nombre; i += 1) {
    const angle = depart + i * pas
    if (Math.abs(angle) > ANGLE_MAX) {
      continue
    }
    const score = scoreProjection(encre, profil, marge, angle)
    if (score > meilleurScore) {
      meilleurScore = score
      meilleur = angle
    }
  }

  return meilleur
}

// On ne tourne pas l'image pour l'essayer : on decale chaque ligne de `x * tan(angle)`, ce qui
// suffit aux petits angles. Le profil d'une page droite est fait de pics (les lignes de texte)
// separes de creux (les interlignes) ; la somme des carres est maximale la ou les pics sont les
// plus francs, donc la ou le texte est horizontal.
function scoreProjection(encre: Encre, profil: Int32Array, marge: number, angle: number): number {
  profil.fill(0)
  const tangente = Math.tan((angle * Math.PI) / 180)

  for (let i = 0; i < encre.compte; i += 1) {
    const x = encre.xs[i] ?? 0
    const y = encre.ys[i] ?? 0
    const ligne = Math.round(y - tangente * x) + marge
    if (ligne >= 0 && ligne < profil.length) {
      profil[ligne] = (profil[ligne] ?? 0) + 1
    }
  }

  let score = 0
  for (let i = 0; i < profil.length; i += 1) {
    const hauteur = profil[i] ?? 0
    score += hauteur * hauteur
  }
  return score
}

const arrondir = (valeur: number): number => Math.round(valeur * 100) / 100
