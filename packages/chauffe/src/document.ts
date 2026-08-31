import type { Apercu } from '@alambic/noyau'
import { donnees, vignette } from './apercus'
import {
  airePolygone,
  boiteEnglobante,
  enveloppeConvexe,
  ordonnerHoraire,
  plusGrandeRegion,
  quatreSommets,
  type Region,
} from './contour'
import type { Etat, EtatCouleur, Sortie } from './etat'
import { type Point, remapper, resoudreHomographie } from './homographie'
import { HAUTEUR_MAX, LARGEUR_CIBLE, type Prepare } from './preparation'
import { seuilOtsu } from './seuil'

// Ce qu'Alambic recoit est toujours la meme chose : un objet clair et peu sature, dans un decor
// quelconque. On cherche donc une REGION et non des aretes. Un bord de papier peut etre bouge,
// masque par un doigt, ou sortir du cadre ; une region claire, elle, reste une region claire.

// Un document qui couvre moins que ca est trop loin pour etre lu, ou bien ce qui a ete trouve
// n'est pas le document. Au-dela du plafond, c'est toute la photo qui a ete prise pour un
// document, ce qui ne renseigne sur rien.
const AIRE_MIN = 0.12
const AIRE_MAX = 0.985

// Part d'un bord du cadre couverte par le document au-dela de laquelle on considere qu'il sort
// de la photo par ce cote. Ses vrais coins ne sont alors pas dans l'image, et le quadrilatere
// qu'on y trouverait aurait des sommets poses sur le bord du cadre : le redresser tordrait le
// texte au lieu de l'aplanir.
//
// Ce que ce seuil NE fait PAS : refuser la photo. Mesure sur le corpus, la moitie des photos
// touchent au moins un bord — c'est le cadrage serre normal de quelqu'un qui photographie un
// recu, pas une anomalie. Aucun seuil ne separe « cadre serre » de « contenu manquant » sans
// rejeter des photos parfaitement lisibles ; savoir s'il manque une ligne se decide apres
// lecture, pas ici.
const PART_BORD_SORTIE = 0.08

// Le contour suit le bord exterieur du papier, ou subsiste un lisere du decor. Le resserrer de
// quelques pour mille laisse ce lisere dehors, tres loin d'atteindre le texte.
const RESSERREMENT = 0.008

// Marge conservee autour de la boite englobante quand on ne peut pas redresser.
const MARGE_BOITE = 0.01

// Ce qu'une region occupe de sa propre enveloppe convexe. Un document est convexe : plus la
// region s'en ecarte, moins ce qu'on a trouve ressemble a une feuille de papier. Mesure sur le
// corpus, les segmentations justes tiennent entre 0,91 et 1,00 ; les deux ratees tombent a 0,67
// — la ou le document se fond dans un mur clair ou une fenetre surexposee.
//
// Ce seuil ne fait que baisser la note : sur ces photos-la, la region fautive est la SEULE
// candidate — le recu y est fusionne avec le fond, et aucune autre composante ne vaut mieux.
// Le dire dans le score est tout ce qu'on peut faire d'honnete ici.
const CONVEXITE_SURE = 0.85

const NOTE_SANS_REDRESSEMENT = 0.8
const NOTE_SANS_DOCUMENT = 0.6
const NOTE_REGION_DOUTEUSE = 0.5

export async function documenter(prepare: Prepare): Promise<Sortie<Etat>> {
  const { image, miniature } = prepare
  const scores = scorePapier(miniature)
  const seuil = seuilOtsu(scores)

  const candidat = new Uint8Array(scores.length)
  for (let i = 0; i < scores.length; i += 1) {
    candidat[i] = (scores[i] ?? 0) >= seuil ? 1 : 0
  }

  const region = plusGrandeRegion(candidat, miniature.largeur, miniature.hauteur)
  const partAire = region === undefined ? 0 : region.aire / (miniature.largeur * miniature.hauteur)

  if (region === undefined || partAire < AIRE_MIN || partAire > AIRE_MAX) {
    return {
      valeur: image,
      note: NOTE_SANS_DOCUMENT,
      motif: `Aucune région claire ne se détache du fond (${Math.round(partAire * 100)} % de l'image) : document et décor se confondent. L'image passe sans cadrage.`,
      apercus: apercusDe(image, region, { cadre: 'aucun', partAire: arrondir(partAire), seuil }),
    }
  }

  const enveloppe = enveloppeConvexe(region)
  const convexite = region.aire / Math.max(1, airePolygone(enveloppe))
  const douteuse = convexite < CONVEXITE_SURE

  const sorties = region.bordsCouverts.filter((part) => part >= PART_BORD_SORTIE).length
  const echelle = image.largeur / miniature.largeur
  const sommets = sorties === 0 && !douteuse ? quadrilatere(region, enveloppe, echelle) : undefined

  if (sommets === undefined) {
    const boite = decouper(image, region, echelle)
    return {
      valeur: boite,
      note: douteuse ? NOTE_REGION_DOUTEUSE : NOTE_SANS_REDRESSEMENT,
      motif: douteuse
        ? `La région trouvée n'occupe que ${Math.round(convexite * 100)} % de son enveloppe : le document se confond en partie avec un fond clair, et ce qui a été recadré en contient une part. L'image est seulement recadrée.`
        : sorties === 0
          ? "Le contour du document n'est pas un quadrilatère : perspective non corrigée, l'image est seulement recadrée."
          : `Le document sort de la photo par ${sorties} bord${sorties > 1 ? 's' : ''} : ses coins ne sont pas tous dans l'image, donc pas de correction de perspective. L'image est seulement recadrée.`,
      apercus: apercusDe(boite, region, {
        cadre: 'boite',
        bordsFranchis: sorties,
        convexite: arrondir(convexite),
        bordsCouverts: region.bordsCouverts.map(arrondir),
        apres: [boite.largeur, boite.hauteur],
      }),
    }
  }

  const redresse = redresserPerspective(image, sommets)
  if (redresse === undefined) {
    const boite = decouper(image, region, echelle)
    return {
      valeur: boite,
      note: NOTE_SANS_REDRESSEMENT,
      motif:
        "Les quatre coins détectés sont alignés : aucune transformation ne les redresse. L'image est seulement recadrée.",
      apercus: apercusDe(boite, region, { cadre: 'boite' }),
    }
  }

  return {
    valeur: redresse,
    apercus: apercusDe(redresse, region, {
      cadre: 'perspective',
      coins: sommets.map((sommet) => [Math.round(sommet.x), Math.round(sommet.y)]),
      partAire: arrondir(partAire),
      convexite: arrondir(convexite),
      bordsCouverts: region.bordsCouverts.map(arrondir),
      avant: [image.largeur, image.hauteur],
      apres: [redresse.largeur, redresse.hauteur],
    }),
  }
}

// Ce qui distingue du papier dans une photo : c'est clair ET c'est peu sature. La clarte seule
// confondrait le papier avec une fenetre surexposee ou un mur blanc ; la saturation seule le
// confondrait avec toute surface terne. Le produit des deux ecarte une main, du bois, un ciel,
// et c'est la l'information que la mise en niveaux de gris detruisait avant meme qu'on s'en
// serve.
function scorePapier(miniature: EtatCouleur): Uint8Array {
  const scores = new Uint8Array(miniature.largeur * miniature.hauteur)

  for (let i = 0; i < scores.length; i += 1) {
    const rouge = miniature.pixels[i * 3] ?? 0
    const vert = miniature.pixels[i * 3 + 1] ?? 0
    const bleu = miniature.pixels[i * 3 + 2] ?? 0
    const haut = Math.max(rouge, vert, bleu)
    const bas = Math.min(rouge, vert, bleu)
    const saturation = haut === 0 ? 0 : (haut - bas) / haut
    scores[i] = Math.round(haut * (1 - saturation))
  }

  return scores
}

function quadrilatere(
  region: Region,
  enveloppe: readonly Point[],
  echelle: number,
): Point[] | undefined {
  const diagonale = Math.hypot(region.largeur, region.hauteur)
  const sommets = quatreSommets(enveloppe, diagonale)
  if (sommets === undefined) {
    return undefined
  }

  const ordonnes = ordonnerHoraire(sommets)
  const centre = {
    x: ordonnes.reduce((somme, sommet) => somme + sommet.x, 0) / ordonnes.length,
    y: ordonnes.reduce((somme, sommet) => somme + sommet.y, 0) / ordonnes.length,
  }

  return ordonnes.map((sommet) => ({
    x: (centre.x + (sommet.x - centre.x) * (1 - RESSERREMENT)) * echelle,
    y: (centre.y + (sommet.y - centre.y) * (1 - RESSERREMENT)) * echelle,
  }))
}

function redresserPerspective(image: Etat, sommets: readonly Point[]): Etat | undefined {
  const { largeur, hauteur } = tailleRedressee(sommets)
  const rectangle: Point[] = [
    { x: 0, y: 0 },
    { x: largeur, y: 0 },
    { x: largeur, y: hauteur },
    { x: 0, y: hauteur },
  ]

  // Resolue du rectangle de sortie VERS le quadrilatere d'entree : `remapper` parcourt les
  // pixels de sortie et va chercher d'ou chacun vient, ce qui evite toute inversion.
  const transformation = resoudreHomographie(rectangle, sommets)
  return transformation === undefined
    ? undefined
    : remapper(image, transformation, largeur, hauteur)
}

// La taille du document une fois a plat : la moyenne des deux cotes opposes. Vu de biais, un
// bord est plus court que son oppose ; prendre le plus long etirerait le texte du cote deja le
// plus grand, prendre le plus court le comprimerait.
function tailleRedressee(sommets: readonly Point[]): { largeur: number; hauteur: number } {
  const [hautGauche, hautDroit, basDroit, basGauche] = sommets
  if (
    hautGauche === undefined ||
    hautDroit === undefined ||
    basDroit === undefined ||
    basGauche === undefined
  ) {
    return { largeur: 1, hauteur: 1 }
  }

  const largeurBrute = (distance(hautGauche, hautDroit) + distance(basGauche, basDroit)) / 2
  const hauteurBrute = (distance(hautGauche, basGauche) + distance(hautDroit, basDroit)) / 2

  // Le meme plafond que la preparation : redresser une perspective ne doit pas etre un moyen
  // detourne de rendre a l'ocr une image plus grande que ce qu'il traite en temps borne.
  const facteur = Math.min(1, LARGEUR_CIBLE / largeurBrute, HAUTEUR_MAX / hauteurBrute)

  return {
    largeur: Math.max(1, Math.round(largeurBrute * facteur)),
    hauteur: Math.max(1, Math.round(hauteurBrute * facteur)),
  }
}

// Le repli quand la perspective n'est pas inferable : on garde la boite du document et on jette
// le decor. Moins bien qu'un redressement, infiniment mieux que de laisser le decor a l'ocr.
function decouper(image: Etat, region: Region, echelle: number): Etat {
  const boite = boiteEnglobante(region)
  const marge = Math.round(MARGE_BOITE * Math.max(image.largeur, image.hauteur))
  const gauche = Math.max(0, Math.round(boite.gauche * echelle) - marge)
  const haut = Math.max(0, Math.round(boite.haut * echelle) - marge)
  const droite = Math.min(image.largeur - 1, Math.round(boite.droite * echelle) + marge)
  const bas = Math.min(image.hauteur - 1, Math.round(boite.bas * echelle) + marge)

  const largeur = Math.max(1, droite - gauche + 1)
  const hauteur = Math.max(1, bas - haut + 1)
  const pixels = Buffer.allocUnsafe(largeur * hauteur)
  for (let y = 0; y < hauteur; y += 1) {
    image.pixels.copy(
      pixels,
      y * largeur,
      (haut + y) * image.largeur + gauche,
      (haut + y) * image.largeur + gauche + largeur,
    )
  }

  return { pixels, largeur, hauteur }
}

// Le masque tel que la segmentation l'a vu, en image : c'est ce qu'on regarde en premier quand
// un cadrage surprend.
function apercusDe(
  resultat: Etat,
  region: Region | undefined,
  valeur: Record<string, unknown>,
): () => Promise<Apercu[]> {
  return async () => {
    const apercus = [await vignette(resultat)]
    if (region !== undefined) {
      const pixels = Buffer.allocUnsafe(region.masque.length)
      for (let i = 0; i < pixels.length; i += 1) {
        pixels[i] = region.masque[i] === 1 ? 255 : 0
      }
      apercus.push(await vignette({ pixels, largeur: region.largeur, hauteur: region.hauteur }))
    }
    apercus.push(donnees(valeur))
    return apercus
  }
}

const distance = (depart: Point, arrivee: Point): number =>
  Math.hypot(arrivee.x - depart.x, arrivee.y - depart.y)

const arrondir = (valeur: number): number => Math.round(valeur * 100) / 100
