import {
  type Apercu,
  CODE_ERREUR,
  ErreurAlambic,
  FORMAT_IMAGE,
  GENRE_APERCU,
  type ImageChauffee,
  STATUT_ETAPE,
  type Traceur,
} from '@alambic/noyau'
import sharp, { type OutputInfo, type Sharp } from 'sharp'

// Largeur a laquelle on ramene l'image avant l'ocr. En dessous, les petits caracteres d'un
// recu thermique se ferment ; au-dessus, le cout de l'ocr grimpe sans que la lecture
// s'ameliore. A reajuster sur mesures quand le vrai moteur sera branche.
export const LARGEUR_CIBLE = 2000

// Hauteur maximale acceptee en sortie. Une photo de recu long (rouleau de caisse) peut
// depasser plusieurs fois la largeur : sans plafond, une seule image occuperait un ouvrier
// pendant tout le delai de distillation.
const HAUTEUR_MAX = 6000

// Largeur des vignettes de trace. Assez grand pour juger un seuillage a l'oeil, assez petit
// pour que quatre vignettes voyagent en base64 sans alourdir le flux.
const LARGEUR_VIGNETTE = 800

const SOUS_ETAPE = {
  orientation: 'orientation',
  niveauxDeGris: 'niveaux_de_gris',
  redimension: 'redimension',
  encodagePng: 'encodage_png',
} as const

export const SOUS_ETAPES_CHAUFFE = [
  SOUS_ETAPE.orientation,
  SOUS_ETAPE.niveauxDeGris,
  SOUS_ETAPE.redimension,
  SOUS_ETAPE.encodagePng,
] as const

// Preparation minimale de l'image pour l'ocr. Le vrai travail de la Chauffe (redressement de
// perspective, seuillage adaptatif, debruitage, detection des bords du ticket) viendra a son
// tour : ce qui suit est le socle sur lequel il s'ajoutera.
export async function chauffer(original: Buffer, traceur?: Traceur): Promise<ImageChauffee> {
  try {
    return traceur === undefined ? await enUnePasse(original) : await enPasses(original, traceur)
  } catch (erreur) {
    // sharp leve aussi bien sur un fichier tronque que sur un format qu'il ne connait pas :
    // dans les deux cas la requete est en cause, pas le serveur, donc 400 et non 500.
    throw new ErreurAlambic(CODE_ERREUR.imageIllisible, 400, "L'image n'a pas pu etre lue.", erreur)
  }
}

// Le chemin de production, inchange : sharp enchaine les operations sans jamais materialiser
// d'image intermediaire, et une seule passe de decodage-encodage paie pour les quatre.
async function enUnePasse(original: Buffer): Promise<ImageChauffee> {
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
}

type Etat = { data: Buffer; info: OutputInfo }

// Les memes operations, mais une par une, pour que chacune rende sa vignette. Ce chemin ne
// sert qu'a l'observation et n'existe que sous traceur : il decode et reencode quatre fois la
// ou la production ne le fait qu'une, ce qui serait un gaspillage pur en production.
async function enPasses(original: Buffer, traceur: Traceur): Promise<ImageChauffee> {
  const finOrientation = traceur.demarrer(SOUS_ETAPE.orientation)
  const orientationExif = (await sharp(original, { failOn: 'error' }).metadata()).orientation
  const oriente = await enPixels(sharp(original, { failOn: 'error' }).rotate())
  finOrientation({
    statut: STATUT_ETAPE.reussi,
    apercus: [
      await apercuImage(depuis(oriente), oriente),
      apercuDonnees({
        orientationExif: orientationExif ?? null,
        redressee: orientationExif !== undefined && orientationExif > 1,
        largeur: oriente.info.width,
        hauteur: oriente.info.height,
        canaux: oriente.info.channels,
      }),
    ],
  })

  const finGris = traceur.demarrer(SOUS_ETAPE.niveauxDeGris)
  const gris = await enPixels(depuis(oriente).greyscale())
  finGris({
    statut: STATUT_ETAPE.reussi,
    apercus: [
      await apercuImage(depuis(gris), gris),
      apercuDonnees({
        canauxAvant: oriente.info.channels,
        canauxApres: gris.info.channels,
        octetsAvant: oriente.data.byteLength,
        octetsApres: gris.data.byteLength,
      }),
    ],
  })

  const finRedimension = traceur.demarrer(SOUS_ETAPE.redimension)
  const redimensionne = await enPixels(
    depuis(gris).resize({
      width: LARGEUR_CIBLE,
      height: HAUTEUR_MAX,
      fit: 'inside',
      withoutEnlargement: true,
    }),
  )
  const tropEtroite = gris.info.width < LARGEUR_CIBLE
  finRedimension({
    statut: tropEtroite ? STATUT_ETAPE.degrade : STATUT_ETAPE.reussi,
    motif: tropEtroite
      ? `Image de ${gris.info.width} px de large, sous la cible de ${LARGEUR_CIBLE} px. withoutEnlargement la laisse telle quelle : l'OCR lira à une résolution insuffisante.`
      : undefined,
    apercus: [
      await apercuImage(depuis(redimensionne), redimensionne),
      apercuDonnees({
        largeurCible: LARGEUR_CIBLE,
        hauteurMax: HAUTEUR_MAX,
        redimensionnee: !tropEtroite,
        avant: [gris.info.width, gris.info.height],
        apres: [redimensionne.info.width, redimensionne.info.height],
      }),
    ],
  })

  const finEncodage = traceur.demarrer(SOUS_ETAPE.encodagePng)
  const png = await depuis(redimensionne).png().toBuffer({ resolveWithObject: true })
  finEncodage({
    statut: STATUT_ETAPE.reussi,
    apercus: [
      await apercuImage(sharp(png.data), png),
      apercuDonnees({
        format: FORMAT_IMAGE.png,
        sansPerte: true,
        octets: png.data.byteLength,
      }),
    ],
  })

  return {
    contenu: png.data,
    largeur: png.info.width,
    hauteur: png.info.height,
    format: FORMAT_IMAGE.png,
  }
}

// En pixels bruts entre deux passes, jamais en jpeg : un reencodage avec perte a chaque passe
// ferait mentir les vignettes, qui servent justement a juger la qualite de l'image.
function enPixels(source: Sharp): Promise<Etat> {
  return source.raw().toBuffer({ resolveWithObject: true })
}

function depuis(etat: Etat): Sharp {
  return sharp(etat.data, {
    raw: {
      width: etat.info.width,
      height: etat.info.height,
      // Assertion sure : sharp ne rend jamais plus de quatre canaux, et son type d'entree
      // n'accepte que ces quatre valeurs la ou celui de sortie declare un `number`.
      channels: etat.info.channels as 1 | 2 | 3 | 4,
    },
  })
}

// La vignette est reduite, mais l'apercu porte les dimensions REELLES de l'image a ce stade :
// c'est d'elles qu'un lecteur a besoin pour poser des cadres en pourcentage.
async function apercuImage(source: Sharp, etat: Etat): Promise<Apercu> {
  const png = await source
    .resize({ width: LARGEUR_VIGNETTE, withoutEnlargement: true })
    .png()
    .toBuffer()
  return {
    genre: GENRE_APERCU.image,
    png,
    largeur: etat.info.width,
    hauteur: etat.info.height,
  }
}

function apercuDonnees(valeur: unknown): Apercu {
  return { genre: GENRE_APERCU.donnees, valeur }
}
