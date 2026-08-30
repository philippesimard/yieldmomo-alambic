// Ce que la Condensation rend a la Collecte. Meme raison qu'ImageChauffee de rester un type
// TypeScript : frontiere interne, aucune validation a l'execution.

// Position d'un fragment de texte, en pixels de l'image CHAUFFEE (pas de l'originale : la
// Chauffe redimensionne, et la Collecte ne connait que ce qu'elle recoit).
export type Cadre = {
  x: number
  y: number
  largeur: number
  hauteur: number
}

// Confiance : 0 = illisible, 1 = certain. Toujours dans cet intervalle, quel que soit le
// moteur ocr : c'est a l'adaptateur du moteur de normaliser son echelle a lui.
export type BlocTexte = {
  texte: string
  cadre: Cadre
  confiance: number
}

// Les blocs, et pas seulement le texte a plat : sur un recu, le libelle d'un article et son
// montant sont sur la meme ligne mais dans deux colonnes. Sans la geometrie, la Collecte ne
// peut plus les rapprocher, et une facture a deux articles devient illisible.
export type Condensat = {
  texte: string
  blocs: BlocTexte[]
  confiance: number
}
