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

// Ce que la Condensation sait de sa propre lecture. `confiance` resume ce qui a ete lu ; ces
// trois nombres decrivent ce qui a pu ne PAS l'etre, et c'est la seule question qui compte
// quand un montant part chez le consommateur.
export type QualiteLecture = {
  // Confiance sous laquelle se trouve un dixieme des blocs. Le seul des trois sur lequel
  // l'etape tranche, parce que le seul dont le pouvoir separateur est mesure.
  plancher: number
  // Boites que le moteur a detectees sans en tirer un caractere. Journalise et non juge : au
  // corpus, deux recus sans defaut en portent proportionnellement plus que le recu fautif.
  muets: number
  // Blocs dont le cadre touche un bord lateral. Un document rogne perd du texte sans qu'aucune
  // confiance ne baisse, mais un recu cadre au plus juste touche le bord lui aussi : un cas de
  // chaque sorte au corpus, trop peu pour trancher. Journalise en attendant d'en avoir plus.
  bordure: number
}

// Les blocs, et pas seulement le texte a plat : sur un recu, le libelle d'un article et son
// montant sont sur la meme ligne mais dans deux colonnes. Sans la geometrie, la Collecte ne
// peut plus les rapprocher, et une facture a deux articles devient illisible.
export type Condensat = {
  texte: string
  blocs: BlocTexte[]
  confiance: number
  lecture: QualiteLecture
}
