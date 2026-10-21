import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { type BlocTexte, CODE_ERREUR, ErreurAlambic, type ImageChauffee } from '@alambic/noyau'
import { InferenceSession, Tensor } from 'onnxruntime-node'
import sharp from 'sharp'
import type { MoteurOcr } from '../moteur'
import { type Boite, boitesDepuisCarte, dimensionsDetection, tenseurDetection } from './detection'
import { type Gris, redimensionner, redresser, tourner } from './pixels'
import { decoderCtc, type Lecture, tenseurReconnaissance } from './reconnaissance'

const NOM_MOTEUR_ONNX = 'onnx'

const MODELES = {
  detection: fileURLToPath(new URL('../../modeles/detection.onnx', import.meta.url)),
  reconnaissance: fileURLToPath(new URL('../../modeles/reconnaissance.onnx', import.meta.url)),
  dictionnaire: fileURLToPath(new URL('../../modeles/dictionnaire.txt', import.meta.url)),
} as const

// Le blanc du CTC en tete, l'espace en queue : c'est l'ordre des 838 classes du modele.
const BLANC = 'blank'
const ESPACE = ' '

// Paddle lit les lignes par lots de 6, triees par largeur : le bourrage d'un lot depend de ses
// voisines, et les memes lots donnent les memes lectures.
const TAILLE_LOT = 6

// Une ligne plus haute que large d'au moins ce rapport est imprimee a la verticale.
const RAPPORT_VERTICAL = 1.5

// La seconde lecture du sidecar Paddle, a l'identique : une ligne lue sous ce seuil est relue sur
// sa boite droite, un peu d'air au-dessus et en dessous, et le meilleur score l'emporte. Mesure sur
// le corpus : le seul total faux (419,10 lu pour 49,10) sort a 0,879 et la relecture le corrige.
const SEUIL_RELECTURE = 0.9
const MARGE_RELECTURE = 0.1
const COTE_MIN_ROGNURE = 4

// Le convertisseur laisse des constantes inutilisees que le moteur signale une a une au
// chargement : seules les erreurs meritent les journaux.
const JOURNAL_ERREURS_SEULEMENT = 3

export type OptionsMoteurOnnx = {
  // Threads de calcul de chaque session : chaque ouvrier a les siennes.
  fils: number
}

type Sessions = {
  detection: InferenceSession
  reconnaissance: InferenceSession
  caracteres: string[]
}

// Les modeles tournent dans le thread de l'ouvrier qui lit : ni verrou, ni http, ni sidecar.
// Les sessions se chargent a la premiere lecture et servent ensuite a toutes les suivantes.
export function creerMoteurOnnx(options: OptionsMoteurOnnx): MoteurOcr {
  let sessions: Promise<Sessions> | null = null
  return {
    nom: NOM_MOTEUR_ONNX,
    lire: async (image) => {
      sessions ??= charger(options)
      try {
        return await lire(image, await sessions)
      } catch (erreur) {
        if (erreur instanceof ErreurAlambic) throw erreur
        throw new ErreurAlambic(
          CODE_ERREUR.erreurInterne,
          500,
          "Le moteur ocr onnx n'a pas pu lire l'image.",
          erreur,
        )
      }
    },
  }
}

async function charger(options: OptionsMoteurOnnx): Promise<Sessions> {
  const reglages: InferenceSession.SessionOptions = {
    intraOpNumThreads: options.fils,
    interOpNumThreads: 1,
    executionMode: 'sequential',
    graphOptimizationLevel: 'all',
    logSeverityLevel: JOURNAL_ERREURS_SEULEMENT,
    // Sans cela, les threads du calcul tournent a vide entre deux appels et volent le processeur
    // aux autres ouvriers.
    extra: { session: { intra_op: { allow_spinning: '0' } } },
  }
  const [detection, reconnaissance, dictionnaire] = await Promise.all([
    InferenceSession.create(MODELES.detection, reglages),
    InferenceSession.create(MODELES.reconnaissance, reglages),
    readFile(MODELES.dictionnaire, 'utf8'),
  ])
  const caracteres = [BLANC, ...dictionnaire.split('\n').slice(0, -1), ESPACE]
  return { detection, reconnaissance, caracteres }
}

async function lire(image: ImageChauffee, sessions: Sessions): Promise<BlocTexte[]> {
  const gris = await decoder(image)
  const boites = await detecter(gris, sessions.detection)
  const premieres = await reconnaitre(
    boites.map((boite) => ligneDe(gris, boite)),
    sessions,
  )
  const lectures = await relire(gris, boites, premieres, sessions)
  return boites.map((boite, rang) => ({
    texte: lectures[rang]?.texte ?? '',
    cadre: {
      x: boite.x0,
      y: boite.y0,
      largeur: boite.x1 - boite.x0,
      hauteur: boite.y1 - boite.y0,
    },
    confiance: lectures[rang]?.confiance ?? 0,
  }))
}

async function decoder(image: ImageChauffee): Promise<Gris> {
  const { data, info } = await sharp(image.contenu)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return {
    pixels: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    largeur: info.width,
    hauteur: info.height,
  }
}

async function detecter(gris: Gris, session: InferenceSession): Promise<Boite[]> {
  const dimensions = dimensionsDetection(gris.largeur, gris.hauteur)
  const reduite = redimensionner(gris, dimensions.largeur, dimensions.hauteur)
  const entree = new Tensor('float32', tenseurDetection(reduite), [
    1,
    3,
    reduite.hauteur,
    reduite.largeur,
  ])
  const sortie = await session.run({ [premierNom(session.inputNames)]: entree })
  const carte = sortie[premierNom(session.outputNames)]
  if (!(carte?.data instanceof Float32Array)) {
    throw new ErreurAlambic(
      CODE_ERREUR.erreurInterne,
      500,
      'La detection onnx a rendu une carte inattendue.',
    )
  }
  return boitesDepuisCarte(carte.data, reduite.largeur, reduite.hauteur, gris.largeur, gris.hauteur)
}

async function reconnaitre(lignes: readonly Gris[], sessions: Sessions): Promise<Lecture[]> {
  const ordre = lignes
    .map((ligne, rang) => ({ rang, ratio: ligne.largeur / ligne.hauteur }))
    .sort((a, b) => a.ratio - b.ratio)
  const lectures: Lecture[] = new Array(lignes.length)

  for (let debut = 0; debut < ordre.length; debut += TAILLE_LOT) {
    const lot = ordre.slice(debut, debut + TAILLE_LOT)
    const { donnees, largeur } = tenseurReconnaissance(
      lot.map(({ rang }) => lignes[rang] ?? ligneVide()),
    )
    const entree = new Tensor('float32', donnees, [lot.length, 3, 48, largeur])
    const sortie = await sessions.reconnaissance.run({
      [premierNom(sessions.reconnaissance.inputNames)]: entree,
    })
    const probabilites = sortie[premierNom(sessions.reconnaissance.outputNames)]
    const valeurs = probabilites?.data
    const pas = Number(probabilites?.dims[1] ?? 0)
    const classes = Number(probabilites?.dims[2] ?? 0)
    if (!(valeurs instanceof Float32Array) || classes !== sessions.caracteres.length) {
      throw new ErreurAlambic(
        CODE_ERREUR.erreurInterne,
        500,
        `La reconnaissance onnx rend ${classes} classes pour ${sessions.caracteres.length} caracteres.`,
      )
    }
    lot.forEach(({ rang }, position) => {
      lectures[rang] = decoderCtc(valeurs, position * pas * classes, pas, sessions.caracteres)
    })
  }
  return lectures
}

async function relire(
  gris: Gris,
  boites: readonly Boite[],
  lectures: readonly Lecture[],
  sessions: Sessions,
): Promise<Lecture[]> {
  const faibles = boites.flatMap((boite, rang) => {
    if ((lectures[rang]?.confiance ?? 0) >= SEUIL_RELECTURE) return []
    const marge = (boite.y1 - boite.y0) * MARGE_RELECTURE
    const gauche = Math.trunc(Math.max(0, boite.x0))
    const droite = Math.trunc(Math.min(gris.largeur, boite.x1))
    const haut = Math.trunc(Math.max(0, boite.y0 - marge))
    const bas = Math.trunc(Math.min(gris.hauteur, boite.y1 + marge))
    if (droite - gauche < COTE_MIN_ROGNURE || bas - haut < COTE_MIN_ROGNURE) return []
    const coins: Boite['coins'] = [
      { x: gauche, y: haut },
      { x: droite, y: haut },
      { x: droite, y: bas },
      { x: gauche, y: bas },
    ]
    return [{ rang, ligne: redresser(gris, coins) }]
  })
  if (faibles.length === 0) return [...lectures]

  const relues = await reconnaitre(
    faibles.map(({ ligne }) => ligne),
    sessions,
  )
  const meilleures = [...lectures]
  faibles.forEach(({ rang }, position) => {
    const relue = relues[position]
    const premiere = meilleures[rang]
    if (relue !== undefined && relue.confiance > (premiere?.confiance ?? 0))
      meilleures[rang] = relue
  })
  return meilleures
}

// La ligne d'une boite remise a plat, couchee si le texte est vertical.
function ligneDe(gris: Gris, boite: Boite): Gris {
  const ligne = redresser(gris, boite.coins)
  return ligne.hauteur / ligne.largeur >= RAPPORT_VERTICAL ? tourner(ligne) : ligne
}

function ligneVide(): Gris {
  return { pixels: new Uint8Array(1), largeur: 1, hauteur: 1 }
}

function premierNom(noms: readonly string[]): string {
  return noms[0] ?? ''
}
