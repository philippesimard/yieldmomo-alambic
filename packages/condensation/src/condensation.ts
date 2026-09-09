import {
  type BlocTexte,
  CODE_ERREUR,
  type Condensat,
  ErreurAlambic,
  GENRE_APERCU,
  grouperEnLignes,
  type ImageChauffee,
  type QualiteLecture,
  STATUT_ETAPE,
  type Traceur,
} from '@alambic/noyau'
import type { MoteurOcr } from './moteur'

// Part des blocs qu'on accepte de voir lus moins bien que le plancher. Un dixieme : assez bas
// pour qu'un seul montant de travers pese, assez haut pour qu'un caractere parasite isole ne
// condamne pas une lecture propre.
const PART_PLANCHER = 0.1

// Sous ce plancher, un montant a pu se lire de travers sans que rien ne le signale. Mesure sur
// le corpus : les trois recus dont l'ocr s'est trompe ont un plancher de 0,39, 0,47 et 0,65,
// les vingt-trois autres de 0,87 et plus. Le seuil se pose dans l'ecart.
//
// C'est le plancher et non la moyenne qui tranche : ponderee par la longueur du texte, la
// moyenne donne 0,89 a 0,99 a TOUT le corpus — y compris au recu dont le total a ete lu 419,10
// au lieu de 49,10, a 0,92. Elle resume ce qui a ete lu, elle ne dit rien de ce qui a derape.
const SEUIL_PLANCHER = 0.75

// Distance en dessous de laquelle un cadre touche le bord de l'image.
const MARGE_BORDURE = 2

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
  const vus = await moteur.lire(image)

  // Un fragment vu sans etre lu arrive avec un texte vide : c'est la Condensation qui le
  // compte et qui le retire, pas le moteur qui le tait. Sans ce partage, un moteur qui ne lit
  // plus rien passerait pour un moteur qui ne voit plus rien.
  const blocs = vus.filter((bloc) => bloc.texte.trim() !== '')
  const muets = vus.length - blocs.length

  // Une image dont on ne tire aucun caractere est un echec franc, pas une facture vide : le
  // consommateur doit pouvoir distinguer « le recu ne contenait rien de lisible, refais la
  // photo » de « le recu a ete lu mais aucun total n'y a ete reconnu ». Des boites muettes ne
  // sauvent pas la lecture : rien n'en sort.
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
        // Les muets compris : une zone que le moteur a vue sans la lire ne se voit nulle part
        // ailleurs, et c'est exactement ce qu'on veut regarder quand une lecture surprend.
        cadres: vus.map((bloc) => ({
          cadre: bloc.cadre,
          texte: bloc.texte,
          confiance: bloc.confiance,
        })),
        largeur: image.largeur,
        hauteur: image.hauteur,
      },
      {
        genre: GENRE_APERCU.donnees,
        valeur: { moteur: moteur.nom, blocs: blocs.length, muets },
      },
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
  const lecture: QualiteLecture = {
    plancher: plancherDe(ordonnes),
    muets,
    bordure: compterEnBordure(ordonnes, image.largeur),
  }
  const douteuse = lecture.plancher < SEUIL_PLANCHER
  finConfiance?.({
    statut: douteuse ? STATUT_ETAPE.degrade : STATUT_ETAPE.reussi,
    motif: douteuse
      ? `Un dixième des fragments a été lu sous ${lecture.plancher.toFixed(2)} — sous le plancher de ${SEUIL_PLANCHER.toFixed(2)}. Les montants lus ne sont pas fiables.`
      : undefined,
    apercus: [
      {
        genre: GENRE_APERCU.donnees,
        valeur: {
          plancher: lecture.plancher,
          seuil: SEUIL_PLANCHER,
          part: PART_PLANCHER,
          globale: confiance,
          ponderation: 'longueur du texte',
          muets: lecture.muets,
          bordure: lecture.bordure,
          caracteres: ordonnes.reduce((somme, bloc) => somme + bloc.texte.length, 0),
          minimum: extremum(ordonnes, Math.min),
          maximum: extremum(ordonnes, Math.max),
        },
      },
    ],
  })

  return {
    texte: lignes.map((ligne) => ligne.map((bloc) => bloc.texte).join(' ')).join('\n'),
    blocs: ordonnes,
    confiance,
    lecture,
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

// La confiance sous laquelle se trouve `PART_PLANCHER` des blocs. Repond a « un fragment a-t-il
// pu se lire de travers ? », la ou une moyenne repond a « l'ensemble est-il propre ? » — et
// c'est la premiere question qui decide si un montant est publiable.
function plancherDe(blocs: readonly BlocTexte[]): number {
  const confiances = blocs.map((bloc) => bloc.confiance).sort((a, b) => a - b)
  const rang = Math.min(confiances.length - 1, Math.floor(confiances.length * PART_PLANCHER))
  return confiances[rang] ?? 0
}

// Un bloc colle au bord lateral signale un document rogne : le texte perdu ne fait baisser
// aucune confiance, puisque le moteur lit tres bien ce qui reste.
function compterEnBordure(blocs: readonly BlocTexte[], largeur: number): number {
  return blocs.filter(
    (bloc) =>
      bloc.cadre.x <= MARGE_BORDURE || bloc.cadre.x + bloc.cadre.largeur >= largeur - MARGE_BORDURE,
  ).length
}

// Une reduction et non `Math.min(...blocs)` : l'etalement passe un argument par bloc, et un
// long recu depasserait la pile.
function extremum(blocs: readonly BlocTexte[], choisir: (a: number, b: number) => number): number {
  return blocs.reduce((retenu, bloc) => choisir(retenu, bloc.confiance), blocs[0]?.confiance ?? 0)
}
