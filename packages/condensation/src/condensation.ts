import {
  type BlocTexte,
  CODE_ERREUR,
  type Condensat,
  ErreurAlambic,
  grouperEnLignes,
  type ImageChauffee,
} from '@alambic/noyau'
import type { MoteurOcr } from './moteur'

// Extrait tout le texte de l'image, puis lui rend son ordre de lecture. Le moteur est injecte
// et jamais choisi ici : c'est ce qui permettra de comparer deux moteurs sur le meme corpus
// sans toucher au reste du pipeline.
export async function condenser(image: ImageChauffee, moteur: MoteurOcr): Promise<Condensat> {
  const blocs = await moteur.lire(image)

  // Une image dont on ne tire aucun caractere est un echec franc, pas une facture vide : le
  // consommateur doit pouvoir distinguer « le recu ne contenait rien de lisible, refais la
  // photo » de « le recu a ete lu mais aucun total n'y a ete reconnu ».
  if (blocs.length === 0) {
    throw new ErreurAlambic(CODE_ERREUR.aucunTexte, 422, "Aucun texte n'a ete lu sur l'image.")
  }

  // Un moteur rend ses fragments dans l'ordre qui l'arrange, et deux moteurs ne le font pas
  // dans le meme : c'est ici que l'ordre de lecture se decide, une fois pour tous.
  const lignes = grouperEnLignes(blocs)
  const ordonnes = lignes.flat()

  return {
    texte: lignes.map((ligne) => ligne.map((bloc) => bloc.texte).join(' ')).join('\n'),
    blocs: ordonnes,
    confiance: confianceGlobale(ordonnes),
  }
}

// Ponderee par la longueur du texte : un montant mal lu compte plus qu'un caractere parasite
// lu avec certitude, alors qu'une moyenne simple leur donnerait le meme poids.
function confianceGlobale(blocs: readonly BlocTexte[]): number {
  let caracteres = 0
  let somme = 0
  for (const bloc of blocs) {
    caracteres += bloc.texte.length
    somme += bloc.confiance * bloc.texte.length
  }
  return caracteres === 0 ? 0 : somme / caracteres
}
