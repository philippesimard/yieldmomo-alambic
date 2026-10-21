import type { BoiteNormalisee } from '../mots'

// Les fenetres du sidecar de la Collecte, a l'identique de transformers : 512 jetons dont les
// deux speciaux, et 128 jetons repris de la fenetre precedente pour que chaque mot ait du
// contexte des deux cotes.
const LONGUEUR_MAX = 512
const CHEVAUCHEMENT = 128
const CONTENU_MAX = LONGUEUR_MAX - 2

// Boite des jetons speciaux et du bourrage, hors de tout mot.
const BOITE_VIDE: BoiteNormalisee = [0, 0, 0, 0]

export type Speciaux = { debut: number; fin: number; bourrage: number }

// Un lot de fenetres pret pour le modele : [fenetres, longueur] et [fenetres, longueur, 4].
export type Lot = {
  fenetres: number
  longueur: number
  ids: BigInt64Array
  boites: BigInt64Array
  masque: BigInt64Array
  // Pour chaque fenetre et chaque position, l'indice du mot, ou -1 hors des mots.
  mots: Int32Array
}

// Les jetons de chaque mot, deja decoupes, mis bout a bout puis coupes en fenetres chevauchantes
// comme `return_overflowing_tokens` de transformers.
export function construireLot(
  jetonsParMot: readonly (readonly number[])[],
  boites: readonly BoiteNormalisee[],
  speciaux: Speciaux,
): Lot {
  const jetons: number[] = []
  const motDe: number[] = []
  jetonsParMot.forEach((ids, mot) => {
    for (const id of ids) {
      jetons.push(id)
      motDe.push(mot)
    }
  })

  const debuts: number[] = [0]
  while ((debuts.at(-1) ?? 0) + CONTENU_MAX < jetons.length) {
    debuts.push((debuts.at(-1) ?? 0) + CONTENU_MAX - CHEVAUCHEMENT)
  }
  const tailles = debuts.map((debut) => Math.min(CONTENU_MAX, jetons.length - debut) + 2)
  const longueur = Math.max(...tailles)
  const fenetres = debuts.length

  const lot: Lot = {
    fenetres,
    longueur,
    ids: new BigInt64Array(fenetres * longueur).fill(BigInt(speciaux.bourrage)),
    boites: new BigInt64Array(fenetres * longueur * 4),
    masque: new BigInt64Array(fenetres * longueur),
    mots: new Int32Array(fenetres * longueur).fill(-1),
  }
  debuts.forEach((debut, fenetre) => {
    const base = fenetre * longueur
    const contenu = (tailles[fenetre] ?? 2) - 2
    lot.ids[base] = BigInt(speciaux.debut)
    lot.ids[base + contenu + 1] = BigInt(speciaux.fin)
    lot.masque.fill(1n, base, base + contenu + 2)
    for (let position = 0; position < contenu; position++) {
      const mot = motDe[debut + position] ?? -1
      const cellule = base + position + 1
      lot.ids[cellule] = BigInt(jetons[debut + position] ?? speciaux.bourrage)
      lot.mots[cellule] = mot
      const boite = boites[mot] ?? BOITE_VIDE
      for (let coin = 0; coin < 4; coin++) lot.boites[cellule * 4 + coin] = BigInt(boite[coin] ?? 0)
    }
  })
  return lot
}

export type Etiquetage = { classe: number; score: number }

// Pour chaque mot, la classe la plus probable de son premier jeton, dans la premiere fenetre ou
// il apparait : le chevauchement garantit que chaque mot est vu au moins une fois. Un mot sans
// jeton (rien de lisible apres normalisation) reste sans etiquette.
export function premieresEtiquettes(
  logits: Float32Array,
  lot: Lot,
  classes: number,
  nombreDeMots: number,
): (Etiquetage | null)[] {
  const etiquettes: (Etiquetage | null)[] = new Array(nombreDeMots).fill(null)
  for (let cellule = 0; cellule < lot.mots.length; cellule++) {
    const mot = lot.mots[cellule] ?? -1
    if (mot < 0 || etiquettes[mot] !== null) continue
    etiquettes[mot] = meilleureClasse(logits, cellule * classes, classes)
  }
  return etiquettes
}

// Le softmax n'est calcule que pour la classe retenue : c'est sa probabilite que rend le score.
function meilleureClasse(logits: Float32Array, debut: number, classes: number): Etiquetage {
  let classe = 0
  let maximum = Number.NEGATIVE_INFINITY
  for (let indice = 0; indice < classes; indice++) {
    const valeur = logits[debut + indice] ?? Number.NEGATIVE_INFINITY
    if (valeur > maximum) {
      maximum = valeur
      classe = indice
    }
  }
  let somme = 0
  for (let indice = 0; indice < classes; indice++) {
    somme += Math.exp((logits[debut + indice] ?? Number.NEGATIVE_INFINITY) - maximum)
  }
  return { classe, score: 1 / somme }
}
