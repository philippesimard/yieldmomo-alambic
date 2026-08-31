import sharp, { type Sharp } from 'sharp'
import { apercusDe } from './apercus'
import { BLANC, type Etat, type EtatCouleur, enEtat, enEtatCouleur, type Sortie } from './etat'

// Largeur a laquelle on ramene l'image avant l'ocr. En dessous, les petits caracteres d'un
// recu thermique se ferment ; au-dessus, le cout de l'ocr grimpe sans que la lecture
// s'ameliore. A reajuster sur mesures quand le vrai moteur sera branche.
export const LARGEUR_CIBLE = 2000

// Hauteur maximale acceptee. Une photo de recu long (rouleau de caisse) peut depasser plusieurs
// fois la largeur : sans plafond, une seule image occuperait un ouvrier pendant tout le delai
// de distillation.
export const HAUTEUR_MAX = 6000

// La segmentation travaille sur une miniature : la frontiere entre un ticket et une table est
// une structure large de plusieurs dizaines de pixels ; la chercher a pleine resolution
// couterait cent fois plus pour le meme contour.
const LARGEUR_SEGMENTATION = 384

// Ce que la preparation transmet : l'image de travail en gris, et la MEME image en couleur et
// en petit. La couleur ne sert qu'a trouver le document, mais elle y sert enormement — c'est
// elle qui distingue du papier d'une main ou d'une table en bois — et la desaturer d'emblee
// revenait a jeter cette information avant d'avoir pu s'en servir.
export type Prepare = {
  image: Etat
  miniature: EtatCouleur
}

// Decodage, orientation, desaturation et reduction en une seule chaine sharp : une passe de
// decodage paie pour les quatre operations, et l'image couleur pleine resolution n'est jamais
// materialisee en pixels bruts (36 Mo sur une photo de 12 Mpx).
export async function preparer(original: Buffer): Promise<Sortie<Prepare>> {
  // Une seule chaine sharp jusqu'au redressement exif et a l'aplatissement : au-dela, les deux
  // sorties divergent, et sharp ne peut pas consommer deux fois le meme pipeline.
  const commun = (): Sharp =>
    sharp(original, { failOn: 'error' })
      // Sans rotation appliquee ici, une photo prise de travers serait lue couchee : les
      // traitements suivants effacent la metadonnee d'orientation exif.
      .rotate()
      // Un png transparent deviendrait noir en perdant son alpha, ce qui noierait le texte. Et
      // sans cet aplatissement, greyscale rendrait deux canaux la ou tout le reste du package
      // compte sur un seul.
      .flatten({ background: BLANC })

  const image = await enEtat(
    commun()
      // La couleur n'apporte rien a un ocr et triple les octets a transporter jusqu'a lui.
      .greyscale()
      .resize({
        width: LARGEUR_CIBLE,
        height: HAUTEUR_MAX,
        fit: 'inside',
        // Agrandir une photo floue n'ajoute aucun detail, mais multiplie le travail de l'ocr.
        withoutEnlargement: true,
      }),
  )
  const miniature = await enEtatCouleur(
    commun().resize({ width: LARGEUR_SEGMENTATION, withoutEnlargement: true }),
  )
  const valeur: Prepare = { image, miniature }

  // Un rouleau de caisse sort sous la largeur cible parce que c'est la hauteur qui a mordu la
  // premiere, pas parce que la photo etait petite : les deux cas n'appellent pas le meme geste
  // de la part de celui qui reprend la photo.
  const plafonneeEnHauteur = image.hauteur >= HAUTEUR_MAX
  const tropEtroite = image.largeur < LARGEUR_CIBLE && !plafonneeEnHauteur

  return {
    valeur,
    motif: tropEtroite
      ? `Image de ${image.largeur} px de large, sous la cible de ${LARGEUR_CIBLE} px. Elle n'est pas agrandie : l'OCR lira à une résolution insuffisante.`
      : undefined,
    apercus: async () => {
      const metadonnees = await sharp(original, { failOn: 'error' }).metadata()
      return apercusDe(image, {
        orientationExif: metadonnees.orientation ?? null,
        redressee: metadonnees.orientation !== undefined && metadonnees.orientation > 1,
        format: metadonnees.format,
        avant: [metadonnees.width, metadonnees.height],
        apres: [image.largeur, image.hauteur],
        miniature: [miniature.largeur, miniature.hauteur],
        plafonneeEnHauteur,
        octets: image.pixels.byteLength,
      })()
    },
  }
}
