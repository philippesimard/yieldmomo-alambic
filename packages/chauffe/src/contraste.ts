import { apercusDe } from './apercus'
import { depuis, type Etat, enEtat, type Sortie } from './etat'

// Fenetre exprimee en fraction de la largeur et non en pixels : un reglage en pixels vaudrait
// pour un format et serait a cote pour tous les autres.
//
// Le cout de clahe croit lineairement avec la fenetre alors que le contraste qu'il ouvre
// plafonne des la vingtaine de pixels : mesure sur une image de 2000 px, une fenetre de 24 px
// rend 98 % du contraste d'une fenetre de 64 px pour un tiers du temps.
const PART_FENETRE = 80
const FENETRE_MIN = 12
const FENETRE_MAX = 32

// Pente maximale du contraste cumule. Plus haut, le bruit du papier remonte au niveau de
// l'encre ; plus bas, une ombre franche resiste a l'egalisation.
const PENTE_MAX = 3

// Egalise l'eclairage LOCAL, ce qu'aucun reglage global ne sait faire : sur un ticket a moitie
// dans l'ombre, un seul niveau de gris est a la fois du papier d'un cote et de l'encre de
// l'autre. C'est ce qui rend le seuillage qui suit capable de traiter les deux moities.
export async function rehausserContraste(etat: Etat): Promise<Sortie<Etat>> {
  // Fenetre carree, dimensionnee sur la largeur seule : une fenetre plus haute que large sur un
  // rouleau de caisse melangerait des lignes de texte qui n'ont rien a voir entre elles.
  const cote = fenetre(etat.largeur)

  const rehausse = await enEtat(
    depuis(etat).clahe({
      width: cote,
      height: cote,
      maxSlope: PENTE_MAX,
    }),
  )

  return {
    valeur: rehausse,
    apercus: apercusDe(rehausse, {
      fenetre: cote,
      penteMax: PENTE_MAX,
    }),
  }
}

// Trois pixels au minimum : sous cette taille la fenetre ne contient plus de voisinage, et
// jamais plus que la dimension elle-meme, que sharp refuserait.
const fenetre = (dimension: number): number =>
  Math.max(FENETRE_MIN, Math.min(FENETRE_MAX, dimension, Math.round(dimension / PART_FENETRE)))
