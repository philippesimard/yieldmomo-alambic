import {
  type BlocTexte,
  CODE_ERREUR,
  type Condensat,
  ErreurAlambic,
  GENRE_APERCU,
  grouperEnLignes,
  type ImageChauffee,
  STATUT_ETAPE,
  type Traceur,
} from '@alambic/noyau'
import type { MoteurOcr } from './moteur'

// En dessous, ce qui est lu n'est plus assez sur pour qu'un montant en soit tire sans qu'un
// humain le confirme. Seuil d'observation et non de refus : la distillation continue, elle se
// signale seulement comme degradee. A reajuster sur mesures quand le vrai moteur sera branche.
const SEUIL_CONFIANCE = 0.6

const SOUS_ETAPE = {
  lectureOcr: 'lecture_ocr',
  miseEnOrdre: 'mise_en_ordre',
  confiance: 'confiance',
} as const

export const SOUS_ETAPES_CONDENSATION = [
  SOUS_ETAPE.lectureOcr,
  SOUS_ETAPE.miseEnOrdre,
  SOUS_ETAPE.confiance,
] as const

// Extrait tout le texte de l'image, puis lui rend son ordre de lecture. Le moteur est injecte
// et jamais choisi ici : c'est ce qui permettra de comparer deux moteurs sur le meme corpus
// sans toucher au reste du pipeline.
export async function condenser(
  image: ImageChauffee,
  moteur: MoteurOcr,
  traceur?: Traceur,
): Promise<Condensat> {
  const finLecture = traceur?.demarrer(SOUS_ETAPE.lectureOcr)
  const blocs = await moteur.lire(image)

  // Une image dont on ne tire aucun caractere est un echec franc, pas une facture vide : le
  // consommateur doit pouvoir distinguer « le recu ne contenait rien de lisible, refais la
  // photo » de « le recu a ete lu mais aucun total n'y a ete reconnu ».
  if (blocs.length === 0) {
    throw new ErreurAlambic(CODE_ERREUR.aucunTexte, 422, "Aucun texte n'a ete lu sur l'image.")
  }

  // L'argument n'est evalue que si le traceur existe : sans traceur, construire les apercus ne
  // coute pas une allocation.
  finLecture?.({
    statut: STATUT_ETAPE.reussi,
    apercus: [
      {
        genre: GENRE_APERCU.cadres,
        cadres: blocs.map((bloc) => ({
          cadre: bloc.cadre,
          texte: bloc.texte,
          confiance: bloc.confiance,
        })),
        largeur: image.largeur,
        hauteur: image.hauteur,
      },
      { genre: GENRE_APERCU.donnees, valeur: { moteur: moteur.nom, blocs: blocs.length } },
    ],
  })

  // Un moteur rend ses fragments dans l'ordre qui l'arrange, et deux moteurs ne le font pas
  // dans le meme : c'est ici que l'ordre de lecture se decide, une fois pour tous.
  const finOrdre = traceur?.demarrer(SOUS_ETAPE.miseEnOrdre)
  const lignes = grouperEnLignes(blocs)
  const ordonnes = lignes.flat()
  finOrdre?.({
    statut: STATUT_ETAPE.reussi,
    apercus: [
      {
        genre: GENRE_APERCU.donnees,
        valeur: {
          lignes: lignes.length,
          // La ou se jouent les erreurs de lecture en colonnes : deux montants tombes sur la
          // meme ligne, ou un libelle separe du sien, se voient ici et nulle part ailleurs.
          ordre: lignes.map((ligne) => ligne.map((bloc) => bloc.texte).join('  ')),
        },
      },
    ],
  })

  const finConfiance = traceur?.demarrer(SOUS_ETAPE.confiance)
  const confiance = confianceGlobale(ordonnes)
  const douteuse = confiance < SEUIL_CONFIANCE
  finConfiance?.({
    statut: douteuse ? STATUT_ETAPE.degrade : STATUT_ETAPE.reussi,
    motif: douteuse
      ? `Confiance globale de ${confiance.toFixed(2)} — sous le seuil de ${SEUIL_CONFIANCE.toFixed(2)}. Les montants lus ne sont pas fiables.`
      : undefined,
    apercus: [
      {
        genre: GENRE_APERCU.donnees,
        valeur: {
          globale: confiance,
          seuil: SEUIL_CONFIANCE,
          ponderation: 'longueur du texte',
          caracteres: ordonnes.reduce((somme, bloc) => somme + bloc.texte.length, 0),
          minimum: Math.min(...ordonnes.map((bloc) => bloc.confiance)),
          maximum: Math.max(...ordonnes.map((bloc) => bloc.confiance)),
        },
      },
    ],
  })

  return {
    texte: lignes.map((ligne) => ligne.map((bloc) => bloc.texte).join(' ')).join('\n'),
    blocs: ordonnes,
    confiance,
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
