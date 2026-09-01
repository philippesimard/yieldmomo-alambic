import type { ImageChauffee } from '@alambic/noyau'
import type { MotEtiquete } from './etiquettes'
import type { Mot } from './mots'

// Tout ce qu'un moteur d'etiquetage doit savoir faire : poser une etiquette et un score sur
// chaque mot, dans le meme ordre. Rien de plus. La reconstruction en facture reste du cote de
// la Collecte : deux moteurs deviennent comparables parce qu'ils sont traites a l'identique,
// et changer de modele ne touche que l'adaptateur.
export type MoteurEtiquetage = {
  readonly nom: string
  etiqueter(mots: readonly Mot[], image: ImageChauffee): Promise<MotEtiquete[]>
}
