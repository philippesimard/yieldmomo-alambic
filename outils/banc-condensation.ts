// Banc de calibration de la Condensation. Passe tout un dossier de photos par la Chauffe puis
// le moteur ocr, et rend un tableau : c'est lui qui arbitre mobile/server, mesure l'effet de
// la binarisation et recalibrera SEUIL_CONFIANCE. Le texte ordonne de chaque photo va dans
// <dossier>/sorties/<nom>--condensat.txt, pour etre relu a l'oeil.
//
//   npm run banc:condensation -- corpus
//   npm run banc:condensation -- corpus --moteur factice
//   npm run banc:condensation -- corpus --detection server
//   npm run banc:condensation -- corpus --brute        (sans binarisation : resize + gris)
//
// Le banc demarre son propre sidecar sur un port a lui (3102) pour ne pas gener un
// `npm run dev` en cours, et l'arrete a la fin.

import { type ChildProcess, spawn } from 'node:child_process'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chauffer } from '@alambic/chauffe'
import {
  condenser,
  creerMoteurPaddle,
  type MoteurOcr,
  moteurFactice,
  SIDECAR_PADDLE,
  SOUS_ETAPES_CONDENSATION,
} from '@alambic/condensation'
import {
  type Condensat,
  ErreurAlambic,
  FORMAT_IMAGE,
  type ImageChauffee,
  type IssueSousEtape,
  STATUT_ETAPE,
  type Traceur,
} from '@alambic/noyau'
import sharp from 'sharp'

const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.avif', '.tif', '.tiff'])
const DOSSIER_SORTIES = 'sorties'

const NOM_MOTEUR = { factice: 'factice', paddleocr: 'paddleocr' } as const
const DETECTION = { mobile: 'mobile', server: 'server' } as const

const PORT_BANC = 3102
const DELAI_LECTURE_MS = 60_000
const INTERVALLE_SONDE_MS = 500
// Genereux : le premier lancement telecharge les modeles avant de prendre le port.
const DELAI_SIDECAR_MS = 15 * 60_000

// Memes bornes que la Chauffe (LARGEUR_CIBLE / HAUTEUR_MAX) : --brute ne compare que la
// binarisation, pas la taille de l'image.
const LARGEUR_BRUTE = 2000
const HAUTEUR_BRUTE = 6000

type Passage = {
  photo: string
  verdict: string
  blocs: number
  lignes: number
  confiance: number | undefined
  minimum: number | undefined
  chauffeMs: number
  durees: Map<string, number>
  motifs: [string, string][]
  totalMs: number
}

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    moteur: { type: 'string', default: NOM_MOTEUR.paddleocr },
    detection: { type: 'string', default: DETECTION.mobile },
    brute: { type: 'boolean', default: false },
  },
  allowPositionals: true,
})

if (values.moteur !== NOM_MOTEUR.factice && values.moteur !== NOM_MOTEUR.paddleocr) {
  process.stdout.write(`Moteur inconnu : ${values.moteur}. Choisir factice ou paddleocr.\n`)
  process.exit(1)
}
if (values.detection !== DETECTION.mobile && values.detection !== DETECTION.server) {
  process.stdout.write(`Detection inconnue : ${values.detection}. Choisir mobile ou server.\n`)
  process.exit(1)
}

const dossier = positionals[0] ?? 'corpus'
const photos = (await readdir(dossier).catch(() => [])).filter((nom) =>
  EXTENSIONS.has(extname(nom).toLowerCase()),
)

if (photos.length === 0) {
  process.stdout.write(`Aucune image dans ${dossier}/.\n`)
  process.exit(0)
}

const sorties = join(dossier, DOSSIER_SORTIES)
await mkdir(sorties, { recursive: true })

let sidecar: ChildProcess | null = null
const moteur: MoteurOcr =
  values.moteur === NOM_MOTEUR.factice
    ? moteurFactice
    : creerMoteurPaddle({ url: `http://127.0.0.1:${PORT_BANC}`, delaiMs: DELAI_LECTURE_MS })

if (values.moteur === NOM_MOTEUR.paddleocr) {
  sidecar = await demarrerSidecar(values.detection)
}

try {
  const passages: Passage[] = []
  for (const photo of photos.sort()) {
    passages.push(await passer(photo))
  }
  afficher(passages)
} finally {
  sidecar?.kill('SIGTERM')
}

async function demarrerSidecar(detection: string): Promise<ChildProcess> {
  const python = fileURLToPath(
    new URL('../packages/condensation/sidecar/.venv/bin/python', import.meta.url),
  )
  process.stdout.write(
    `Demarrage du sidecar (${detection}) sur le port ${PORT_BANC} — le premier lancement telecharge les modeles...\n`,
  )
  // stderr herite : les messages du sidecar (telechargements, pret) s'affichent tels quels.
  const enfant = spawn(
    python,
    [SIDECAR_PADDLE.chemin, '--port', String(PORT_BANC), '--detection', detection],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  )

  let mort = false
  enfant.on('error', () => {
    mort = true
  })
  enfant.on('exit', () => {
    mort = true
  })

  const limite = Date.now() + DELAI_SIDECAR_MS
  while (Date.now() < limite) {
    if (mort) {
      throw new Error(
        `Le sidecar est mort avant d'etre pret. Le venv existe-t-il ? Voir le README :\n  cd packages/condensation/sidecar && uv venv --python 3.11 && uv pip install -r requirements.txt`,
      )
    }
    try {
      const reponse = await fetch(`http://127.0.0.1:${PORT_BANC}${SIDECAR_PADDLE.routeSante}`)
      if (reponse.ok) return enfant
    } catch {
      // Pas encore pret.
    }
    await new Promise((resoudre) => setTimeout(resoudre, INTERVALLE_SONDE_MS))
  }
  enfant.kill('SIGKILL')
  throw new Error('Le sidecar ne repond toujours pas, abandon.')
}

// Court-circuite la binarisation de la Chauffe : resize aux memes bornes, niveaux de gris,
// rien d'autre. C'est la mesure « binarise vs naturel » — sans toucher a la Chauffe.
async function preparerBrute(original: Buffer): Promise<ImageChauffee> {
  const { data, info } = await sharp(original)
    .rotate()
    .flatten({ background: '#ffffff' })
    .greyscale()
    .resize({
      width: LARGEUR_BRUTE,
      height: HAUTEUR_BRUTE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png()
    .toBuffer({ resolveWithObject: true })
  return {
    contenu: data,
    largeur: info.width,
    hauteur: info.height,
    format: FORMAT_IMAGE.png,
    qualite: 1,
  }
}

async function passer(photo: string): Promise<Passage> {
  const original = await readFile(join(dossier, photo))
  const nom = basename(photo, extname(photo))
  const durees = new Map<string, number>()
  const motifs: [string, string][] = []

  const traceur: Traceur = {
    demarrer(sousEtape) {
      const debut = performance.now()
      return (issue: IssueSousEtape) => {
        durees.set(sousEtape, performance.now() - debut)
        if (issue.motif !== undefined) {
          motifs.push([sousEtape, issue.motif])
        }
      }
    },
  }

  const debut = performance.now()
  try {
    const debutChauffe = performance.now()
    const image = values.brute ? await preparerBrute(original) : await chauffer(original)
    const chauffeMs = performance.now() - debutChauffe

    const condensat = await condenser(image, moteur, traceur)
    await writeFile(join(sorties, `${nom}--condensat.txt`), `${condensat.texte}\n`)

    return {
      photo,
      verdict: STATUT_ETAPE.reussi,
      blocs: condensat.blocs.length,
      lignes: condensat.texte.split('\n').length,
      confiance: condensat.confiance,
      minimum: minimumDe(condensat),
      chauffeMs,
      durees,
      motifs,
      totalMs: performance.now() - debut,
    }
  } catch (erreur) {
    if (!(erreur instanceof ErreurAlambic)) {
      throw erreur
    }
    return {
      photo,
      verdict: erreur.code,
      blocs: 0,
      lignes: 0,
      confiance: undefined,
      minimum: undefined,
      chauffeMs: 0,
      durees,
      motifs,
      totalMs: performance.now() - debut,
    }
  }
}

function minimumDe(condensat: Condensat): number | undefined {
  if (condensat.blocs.length === 0) return undefined
  return condensat.blocs.reduce(
    (minimum, bloc) => Math.min(minimum, bloc.confiance),
    Number.POSITIVE_INFINITY,
  )
}

// Les noms complets rendraient le tableau plus large qu'un terminal.
function abreger(nom: string): string {
  return nom
    .split('_')
    .map((mot) => mot.slice(0, 4))
    .join('')
    .slice(0, 5)
}

function afficher(passages: readonly Passage[]) {
  const largeurPhoto = Math.max(12, ...passages.map((p) => p.photo.length))
  const colonnes = [...SOUS_ETAPES_CONDENSATION]
  const enTete = [
    'photo'.padEnd(largeurPhoto),
    'verdict'.padEnd(18),
    'blocs'.padStart(5),
    'lign'.padStart(4),
    'conf',
    ' min',
    'chauf'.padStart(6),
    ...colonnes.map((nom) => abreger(nom).padStart(6)),
    'TOTAL'.padStart(6),
  ]
  process.stdout.write(`\n${enTete.join(' ')}\n${'-'.repeat(enTete.join(' ').length)}\n`)

  for (const passage of passages) {
    const cellules = [
      passage.photo.padEnd(largeurPhoto),
      passage.verdict.padEnd(18),
      String(passage.blocs).padStart(5),
      String(passage.lignes).padStart(4),
      (passage.confiance === undefined ? '   —' : passage.confiance.toFixed(2)).padStart(4),
      (passage.minimum === undefined ? '   —' : passage.minimum.toFixed(2)).padStart(4),
      passage.chauffeMs.toFixed(0).padStart(6),
      ...colonnes.map((nom) => {
        const duree = passage.durees.get(nom)
        return (duree === undefined ? '—' : duree.toFixed(0)).padStart(6)
      }),
      passage.totalMs.toFixed(0).padStart(6),
    ]
    process.stdout.write(`${cellules.join(' ')}\n`)
    for (const [sousEtape, motif] of passage.motifs) {
      process.stdout.write(`  ${' '.repeat(largeurPhoto)} ${sousEtape} : ${motif}\n`)
    }
  }

  const reussis = passages.filter((p) => p.verdict === STATUT_ETAPE.reussi)
  const moyenne = reussis.reduce((somme, p) => somme + p.totalMs, 0) / (reussis.length || 1)
  process.stdout.write(
    `\n${reussis.length}/${passages.length} condensees (moteur ${moteur.nom}${values.brute ? ', image brute' : ''}), ${moyenne.toFixed(0)} ms en moyenne. Textes dans ${sorties}/\n`,
  )
}
