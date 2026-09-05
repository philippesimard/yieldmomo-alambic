import {
  CODE_ERREUR,
  ErreurAlambic,
  FORMAT_IMAGE,
  type ImageChauffee,
  STATUT_ETAPE,
  type Traceur,
} from '@alambic/noyau'
import { donnees, vignette } from './apercus'
import { documenter } from './document'
import { depuis, type Etat, type Sortie } from './etat'
import { finir } from './finition'
import { mesurerNettete } from './nettete'
import { preparer } from './preparation'
import { redresser } from './redressement'

const SOUS_ETAPE = {
  preparation: 'preparation',
  document: 'document',
  nettete: 'nettete',
  redressement: 'redressement',
  finition: 'finition',
  encodagePng: 'encodage_png',
} as const

export const SOUS_ETAPES_CHAUFFE = [
  SOUS_ETAPE.preparation,
  SOUS_ETAPE.document,
  SOUS_ETAPE.nettete,
  SOUS_ETAPE.redressement,
  SOUS_ETAPE.finition,
  SOUS_ETAPE.encodagePng,
] as const

export { LARGEUR_CIBLE } from './preparation'

// Six sous-etapes, chacune ecrite une seule fois. La trace ne double pas le chemin : elle
// s'insere autour, et les apercus ne sont fabriques que si un traceur les reclame.
//
// L'ordre n'est pas negociable sur un point : `document` passe AVANT `nettete`. Tout ce qui
// suit travaille alors sur le document seul, et non sur la photo entiere — mesurer la nettete
// d'un ticket sur un decor de restaurant flou par nature n'a aucun sens.
//
// La Chauffe s'arrete au redressement et rend le document EN GRIS. Elle a longtemps rehausse
// le contraste, binarise puis debruite : ces trois gestes servent un ocr classique, qui a
// besoin qu'on lui separe l'encre du papier. PP-OCRv5 apprend sur des photographies et fait ce
// tri lui-meme — beaucoup mieux, puisqu'il lui reste les niveaux de gris que le seuillage
// jetait. Mesure sur le corpus : 72 montants sur 73 retrouves au sortir du redressement contre
// 53 apres binarisation et debruitage, pour une confiance ocr de 0,96 contre 0,85. Preparer
// l'image au-dela du redressement, c'est detruire ce que le moteur sait lire.
export async function chauffer(original: Buffer, traceur?: Traceur): Promise<ImageChauffee> {
  try {
    return await enchainer(original, traceur)
  } catch (erreur) {
    if (erreur instanceof ErreurAlambic) {
      throw erreur
    }
    // sharp leve aussi bien sur un fichier tronque que sur un format qu'il ne connait pas :
    // dans les deux cas la requete est en cause, pas le serveur, donc 400 et non 500.
    throw new ErreurAlambic(CODE_ERREUR.imageIllisible, 400, "L'image n'a pas pu etre lue.", erreur)
  }
}

async function enchainer(original: Buffer, traceur?: Traceur): Promise<ImageChauffee> {
  const prepare = await passer(SOUS_ETAPE.preparation, () => preparer(original), traceur)
  const cadre = await passer(SOUS_ETAPE.document, () => documenter(prepare.valeur), traceur)
  const net = await passer(SOUS_ETAPE.nettete, () => mesurerNettete(cadre.valeur), traceur)
  const droit = await passer(SOUS_ETAPE.redressement, () => redresser(net.valeur), traceur)
  const fini = await passer(SOUS_ETAPE.finition, () => finir(droit.valeur), traceur)
  const png = await passer(SOUS_ETAPE.encodagePng, () => encoder(fini.valeur), traceur)

  return {
    ...png.valeur,
    format: FORMAT_IMAGE.png,
    qualite: pireNote([cadre, net]),
  }
}

// Le seul endroit qui chronometre, statue et publie. Une sous-etape qui rend un motif s'est
// degradee ; une sous-etape qui leve ne se cloture pas du tout, et c'est le traceur de
// l'appelant qui la clot en erreur.
async function passer<T>(
  nom: string,
  appliquer: () => Promise<Sortie<T>>,
  traceur?: Traceur,
): Promise<Sortie<T>> {
  const fin = traceur?.demarrer(nom)
  const sortie = await appliquer()
  fin?.({
    statut: sortie.motif === undefined ? STATUT_ETAPE.reussi : STATUT_ETAPE.degrade,
    motif: sortie.motif,
    apercus: await sortie.apercus?.(),
  })
  return sortie
}

type Encode = { contenu: Buffer; largeur: number; hauteur: number }

async function encoder(etat: Etat): Promise<Sortie<Encode>> {
  // Sans perte : un artefact jpeg sur un caractere se paie en erreur de lecture, et une erreur
  // de lecture sur un montant se paie en donnee financiere fausse. Le png reste raisonnable sur
  // un gris de recu, ou de larges aplats de papier se compressent bien.
  const { data, info } = await depuis(etat).png().toBuffer({ resolveWithObject: true })
  const valeur = { contenu: data, largeur: info.width, hauteur: info.height }

  return {
    valeur,
    apercus: async () => [
      await vignette(etat),
      donnees({ format: FORMAT_IMAGE.png, sansPerte: true, octets: data.byteLength }),
    ],
  }
}

// Le maillon faible, pas la moyenne : une image parfaitement nette dont le recadrage a manque
// le document n'est pas a moitie lisible, elle est illisible.
const pireNote = (sorties: readonly Sortie<unknown>[]): number =>
  sorties.reduce((pire, sortie) => Math.min(pire, sortie.note ?? 1), 1)
