import { CODE_ERREUR, ErreurAlambic, FORMAT_IMAGE, type ImageChauffee } from '@alambic/noyau'
import sharp from 'sharp'

// Largeur a laquelle on ramene l'image avant l'ocr. En dessous, les petits caracteres d'un
// recu thermique se ferment ; au-dessus, le cout de l'ocr grimpe sans que la lecture
// s'ameliore. A reajuster sur mesures quand le vrai moteur sera branche.
export const LARGEUR_CIBLE = 2000

// Hauteur maximale acceptee en sortie. Une photo de recu long (rouleau de caisse) peut
// depasser plusieurs fois la largeur : sans plafond, une seule image occuperait un ouvrier
// pendant tout le delai de distillation.
const HAUTEUR_MAX = 6000

// Preparation minimale de l'image pour l'ocr. Le vrai travail de la Chauffe (redressement de
// perspective, seuillage adaptatif, debruitage, detection des bords du ticket) viendra a son
// tour : ce qui suit est le socle sur lequel il s'ajoutera.
export async function chauffer(original: Buffer): Promise<ImageChauffee> {
  try {
    const { data, info } = await sharp(original, { failOn: 'error' })
      // Sans rotation appliquee ici, une photo prise de travers serait lue couchee : les
      // traitements suivants effacent la metadonnee d'orientation exif.
      .rotate()
      // La couleur n'apporte rien a un ocr et triple les octets a transporter jusqu'a lui.
      .greyscale()
      .resize({
        width: LARGEUR_CIBLE,
        height: HAUTEUR_MAX,
        fit: 'inside',
        // Agrandir une photo floue n'ajoute aucun detail, mais multiplie le travail de l'ocr.
        withoutEnlargement: true,
      })
      // Sans perte : un artefact jpeg sur un caractere se paie en erreur de lecture, et une
      // erreur de lecture sur un montant se paie en donnee financiere fausse.
      .png()
      .toBuffer({ resolveWithObject: true })

    return {
      contenu: data,
      largeur: info.width,
      hauteur: info.height,
      format: FORMAT_IMAGE.png,
    }
  } catch (erreur) {
    // sharp leve aussi bien sur un fichier tronque que sur un format qu'il ne connait pas :
    // dans les deux cas la requete est en cause, pas le serveur, donc 400 et non 500.
    throw new ErreurAlambic(CODE_ERREUR.imageIllisible, 400, "L'image n'a pas pu etre lue.", erreur)
  }
}
