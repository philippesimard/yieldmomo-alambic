import type { BlocTexte, ImageChauffee } from '@alambic/noyau'

// Tout ce qu'un moteur ocr doit savoir faire : rendre les fragments de texte qu'il voit, avec
// leur position et sa confiance. Rien de plus. Mettre l'ordre de lecture, la composition du
// texte et la confiance globale du cote de la Condensation (et non du moteur) a deux effets :
// ce contrat reste assez petit pour qu'un moteur local comme un service distant s'y plie sans
// effort, et deux moteurs deviennent comparables parce qu'ils sont traites a l'identique.
export type MoteurOcr = {
  readonly nom: string
  lire(image: ImageChauffee): Promise<BlocTexte[]>
}
