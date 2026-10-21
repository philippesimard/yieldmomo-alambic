import { type Gris, redimensionner } from './pixels'

// Les reglages du modele latin_PP-OCRv5_mobile_rec tels que PaddleX les applique.

// Chaque ligne est ramenee a 48 px de haut, et lue sur au moins 320 px de large.
const HAUTEUR = 48
const LARGEUR_MIN = 320
const LARGEUR_MAX = 3200

// Index 0 : le « blanc » du CTC, qui separe deux lettres identiques.
const BLANC = 0

export type Lecture = {
  texte: string
  confiance: number
}

// La largeur a laquelle une ligne est redimensionnee, puis celle de son tenseur avant bourrage,
// comme OCRReisizeNormImg de PaddleX.
export function largeursReconnaissance(
  largeur: number,
  hauteur: number,
): { redimensionnee: number; totale: number } {
  const ratio = largeur / hauteur
  const totale = Math.trunc(HAUTEUR * Math.max(LARGEUR_MIN / HAUTEUR, ratio))
  if (totale > LARGEUR_MAX) return { redimensionnee: LARGEUR_MAX, totale: LARGEUR_MAX }
  return { redimensionnee: Math.min(totale, Math.ceil(HAUTEUR * ratio)), totale }
}

// Le tenseur [n, 3, 48, W] d'un lot de lignes, bourre de zeros a la plus large du lot.
export function tenseurReconnaissance(lignes: readonly Gris[]): {
  donnees: Float32Array
  largeur: number
} {
  const largeurs = lignes.map((ligne) => largeursReconnaissance(ligne.largeur, ligne.hauteur))
  const largeur = Math.max(...largeurs.map((l) => l.totale))
  const plan = HAUTEUR * largeur
  const donnees = new Float32Array(lignes.length * 3 * plan)
  lignes.forEach((ligne, rang) => {
    const redimensionnee = redimensionner(ligne, largeurs[rang]?.redimensionnee ?? 1, HAUTEUR)
    for (let y = 0; y < HAUTEUR; y++) {
      for (let x = 0; x < redimensionnee.largeur; x++) {
        const valeur = (redimensionnee.pixels[y * redimensionnee.largeur + x] ?? 0) / 127.5 - 1
        for (let canal = 0; canal < 3; canal++) {
          donnees[(rang * 3 + canal) * plan + y * largeur + x] = valeur
        }
      }
    }
  })
  return { donnees, largeur }
}

// Decodage CTC glouton : la classe la plus probable a chaque pas, les repetitions fusionnees et
// les blancs retires. La confiance est la moyenne des probabilites des caracteres gardes.
// `caracteres` commence par le blanc et finit par l'espace : on y lit par indice, le
// dictionnaire contenant des doublons.
export function decoderCtc(
  probabilites: Float32Array,
  debut: number,
  pas: number,
  caracteres: readonly string[],
): Lecture {
  const classes = caracteres.length
  let texte = ''
  let somme = 0
  let gardes = 0
  let precedente = -1
  for (let t = 0; t < pas; t++) {
    let meilleure = 0
    let probabilite = -1
    const decalage = debut + t * classes
    for (let classe = 0; classe < classes; classe++) {
      const p = probabilites[decalage + classe] ?? 0
      if (p > probabilite) {
        probabilite = p
        meilleure = classe
      }
    }
    if (meilleure !== BLANC && meilleure !== precedente) {
      texte += caracteres[meilleure] ?? ''
      somme += probabilite
      gardes++
    }
    precedente = meilleure
  }
  return { texte, confiance: gardes === 0 ? 0 : somme / gardes }
}
