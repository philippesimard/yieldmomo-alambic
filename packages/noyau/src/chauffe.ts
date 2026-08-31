// Ce que la Chauffe rend a la Condensation. Type TypeScript et non schema Zod : cette
// frontiere est interne au pipeline, elle ne franchit aucune limite de confiance, et la
// valider a l'execution couterait sur chaque distillation sans rien prouver.

export const FORMAT_IMAGE = {
  png: 'png',
  jpeg: 'jpeg',
  webp: 'webp',
} as const

export type FormatImage = (typeof FORMAT_IMAGE)[keyof typeof FORMAT_IMAGE]

export type ImageChauffee = {
  contenu: Buffer
  largeur: number
  hauteur: number
  format: FormatImage
  // Entre 0 et 1 : ce que la Chauffe pense de la lisibilite de ce qu'elle rend. La Condensation
  // n'a pas a redecouvrir qu'une image est limite alors que la Chauffe vient de le mesurer.
  qualite: number
}
