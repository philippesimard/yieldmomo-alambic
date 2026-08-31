import { type Etat, lire } from './etat'

// Un pixel est de l'encre s'il est plus sombre que son voisinage de cette fraction. Sans cet
// ecart, le bruit du papier basculerait au hasard de part et d'autre de sa propre moyenne.
const ECART = 0.15

export const ENCRE = 0
export const PAPIER = 255

export type Seuillage = { binaire: Etat; partEncre: number }

// Seuillage adaptatif : chaque pixel est compare a la moyenne de son voisinage, pas a un seuil
// unique pour toute l'image. Un seuil global echouerait exactement sur les deux cas qui
// justifient l'etape : le ticket a moitie a l'ombre, ou le document pose sur un fond plus
// sombre que lui, dont le seuil global ferait un immense aplat d'encre.
//
// La moyenne de n'importe quel voisinage se lit en quatre acces dans l'image cumulee, donc le
// cout ne depend pas de la taille de la fenetre.
export function seuillerAdaptatif(etat: Etat, partFenetre: number): Seuillage {
  const { largeur, hauteur, pixels } = etat
  const cumul = imageCumulee(etat)
  const rayon = Math.max(1, Math.round((largeur * partFenetre) / 2))
  const largeurCumul = largeur + 1

  const binaire = Buffer.allocUnsafe(largeur * hauteur)
  let encre = 0

  for (let y = 0; y < hauteur; y += 1) {
    const haut = Math.max(0, y - rayon)
    const bas = Math.min(hauteur - 1, y + rayon)
    const ligneHaute = haut * largeurCumul
    const ligneBasse = (bas + 1) * largeurCumul
    const hauteurFenetre = bas - haut + 1

    for (let x = 0; x < largeur; x += 1) {
      const gauche = Math.max(0, x - rayon)
      const droite = Math.min(largeur - 1, x + rayon)
      const somme =
        (cumul[ligneBasse + droite + 1] ?? 0) -
        (cumul[ligneHaute + droite + 1] ?? 0) -
        (cumul[ligneBasse + gauche] ?? 0) +
        (cumul[ligneHaute + gauche] ?? 0)
      const aire = hauteurFenetre * (droite - gauche + 1)

      // Multiplication croisee plutot que division : le meme test, sans une division par pixel.
      const sombre = lire(pixels, y * largeur + x) * aire < somme * (1 - ECART)
      binaire[y * largeur + x] = sombre ? ENCRE : PAPIER
      if (sombre) {
        encre += 1
      }
    }
  }

  return {
    binaire: { pixels: binaire, largeur, hauteur },
    partEncre: encre / (largeur * hauteur),
  }
}

// Somme de tous les pixels situes au-dessus et a gauche, bordee d'une ligne et d'une colonne de
// zeros pour que les fenetres qui touchent un bord se lisent sans cas particulier.
//
// Un `Uint32Array` suffit : une image est plafonnee a 2000 x 6000 par la preparation, soit au
// pire 12 millions de pixels a 255, tres en dessous de ce que porte un entier 32 bits.
function imageCumulee(etat: Etat): Uint32Array {
  const largeurCumul = etat.largeur + 1
  const cumul = new Uint32Array(largeurCumul * (etat.hauteur + 1))

  for (let y = 0; y < etat.hauteur; y += 1) {
    const ligne = y * etat.largeur
    const precedente = y * largeurCumul
    const courante = (y + 1) * largeurCumul
    let sommeLigne = 0
    for (let x = 0; x < etat.largeur; x += 1) {
      sommeLigne += lire(etat.pixels, ligne + x)
      cumul[courante + x + 1] = (cumul[precedente + x + 1] ?? 0) + sommeLigne
    }
  }

  return cumul
}

// Otsu : le seuil qui separe le mieux un histogramme en deux populations. Utile la ou il y a
// vraiment deux populations a separer — du papier et un decor — et non pour distinguer du texte
// de son papier, ou l'eclairage local fait echouer tout seuil unique.
export function seuilOtsu(valeurs: Uint8Array): number {
  const histogramme = new Int32Array(256)
  for (let i = 0; i < valeurs.length; i += 1) {
    const valeur = valeurs[i] ?? 0
    histogramme[valeur] = (histogramme[valeur] ?? 0) + 1
  }

  let sommeTotale = 0
  for (let valeur = 0; valeur < 256; valeur += 1) {
    sommeTotale += valeur * (histogramme[valeur] ?? 0)
  }

  let poidsBas = 0
  let sommeBasse = 0
  let meilleureVariance = -1
  let meilleurSeuil = 128

  for (let valeur = 0; valeur < 256; valeur += 1) {
    poidsBas += histogramme[valeur] ?? 0
    if (poidsBas === 0) {
      continue
    }
    const poidsHaut = valeurs.length - poidsBas
    if (poidsHaut === 0) {
      break
    }
    sommeBasse += valeur * (histogramme[valeur] ?? 0)
    const ecart = sommeBasse / poidsBas - (sommeTotale - sommeBasse) / poidsHaut
    const variance = poidsBas * poidsHaut * ecart * ecart
    if (variance > meilleureVariance) {
      meilleureVariance = variance
      meilleurSeuil = valeur
    }
  }

  return meilleurSeuil
}
