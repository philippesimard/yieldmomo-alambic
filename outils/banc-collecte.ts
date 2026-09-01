// Banc de calibration de la Collecte. Passe tout un dossier de photos par le pipeline complet
// (chauffe, condensation, collecte) et rend un tableau : champs reconnus, confiances, durees
// par sous-etape. Pour chaque photo, les mots etiquetes et la facture partent dans
// <dossier>/sorties/<nom>--collecte.json — boites normalisees 0-1000, directement rechargeable
// pour le fine-tuning (words/bboxes/ner_tags) : corriger `etiquette` a la main, c'est deja
// annoter.
//
//   npm run banc:collecte -- corpus
//   npm run banc:collecte -- corpus --moteur factice
//   npm run banc:collecte -- corpus --moteur-ocr factice
//   npm run banc:collecte -- corpus --modele <checkpoint-hf>
//
// Le banc demarre ses propres sidecars sur des ports a lui (3102 pour l'ocr, 3104 pour la
// collecte) pour ne pas gener un `npm run dev` en cours, et les arrete a la fin.

import { type ChildProcess, spawn } from 'node:child_process'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chauffer } from '@alambic/chauffe'
import {
  boiteNormalisee,
  collecter,
  creerMoteurLayoutlm,
  ETIQUETTE,
  type MotEtiquete,
  type MoteurEtiquetage,
  moteurFacticeEtiquetage,
  SIDECAR_LAYOUTLM,
  SOUS_ETAPES_COLLECTE,
} from '@alambic/collecte'
import {
  condenser,
  creerMoteurPaddle,
  type MoteurOcr,
  moteurFactice,
  SIDECAR_PADDLE,
} from '@alambic/condensation'
import {
  ErreurAlambic,
  type Facture,
  type ImageChauffee,
  type IssueSousEtape,
  STATUT_ETAPE,
  type Traceur,
} from '@alambic/noyau'

const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.avif', '.tif', '.tiff'])
const DOSSIER_SORTIES = 'sorties'

const NOM_MOTEUR_OCR = { factice: 'factice', paddleocr: 'paddleocr' } as const
const NOM_MOTEUR_COLLECTE = { factice: 'factice', layoutlmv3: 'layoutlmv3' } as const

// 3102 est deja le port du banc de condensation : les deux bancs peuvent tourner cote a cote
// avec un `npm run dev` (3101, 3103) sans se marcher dessus.
const PORT_BANC_OCR = 3102
const PORT_BANC_COLLECTE = 3104

const MODELE_PAR_DEFAUT = 'nielsr/layoutlmv3-finetuned-cord'

const DELAI_LECTURE_MS = 60_000
const DELAI_ETIQUETAGE_MS = 60_000
const INTERVALLE_SONDE_MS = 500
// Genereux : le premier lancement telecharge les modeles avant de prendre le port.
const DELAI_SIDECAR_MS = 15 * 60_000

type Passage = {
  photo: string
  verdict: string
  facture: Facture | null
  durees: Map<string, number>
  motifs: [string, string][]
  condensationMs: number
  totalMs: number
}

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    moteur: { type: 'string', default: NOM_MOTEUR_COLLECTE.layoutlmv3 },
    'moteur-ocr': { type: 'string', default: NOM_MOTEUR_OCR.paddleocr },
    detection: { type: 'string', default: 'mobile' },
    modele: { type: 'string', default: MODELE_PAR_DEFAUT },
  },
  allowPositionals: true,
})

const moteurOcrChoisi = values['moteur-ocr']
if (moteurOcrChoisi !== NOM_MOTEUR_OCR.factice && moteurOcrChoisi !== NOM_MOTEUR_OCR.paddleocr) {
  process.stdout.write(`Moteur ocr inconnu : ${moteurOcrChoisi}. Choisir factice ou paddleocr.\n`)
  process.exit(1)
}
if (
  values.moteur !== NOM_MOTEUR_COLLECTE.factice &&
  values.moteur !== NOM_MOTEUR_COLLECTE.layoutlmv3
) {
  process.stdout.write(`Moteur inconnu : ${values.moteur}. Choisir factice ou layoutlmv3.\n`)
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

const moteurOcr: MoteurOcr =
  moteurOcrChoisi === NOM_MOTEUR_OCR.factice
    ? moteurFactice
    : creerMoteurPaddle({ url: `http://127.0.0.1:${PORT_BANC_OCR}`, delaiMs: DELAI_LECTURE_MS })

const moteurCollecte: MoteurEtiquetage =
  values.moteur === NOM_MOTEUR_COLLECTE.factice
    ? moteurFacticeEtiquetage
    : creerMoteurLayoutlm({
        url: `http://127.0.0.1:${PORT_BANC_COLLECTE}`,
        delaiMs: DELAI_ETIQUETAGE_MS,
      })

// Le banc a besoin des mots etiquetes pour l'export annotable, mais `collecter` ne rend que la
// facture : ce moteur-greffier enregistre au passage ce que le vrai moteur repond, sans
// deuxieme inference.
let dernierEtiquetage: MotEtiquete[] = []
const moteurGreffier: MoteurEtiquetage = {
  nom: moteurCollecte.nom,
  etiqueter: async (mots, image) => {
    dernierEtiquetage = await moteurCollecte.etiqueter(mots, image)
    return dernierEtiquetage
  },
}

const sidecars: ChildProcess[] = []
if (moteurOcrChoisi === NOM_MOTEUR_OCR.paddleocr) {
  sidecars.push(
    await demarrerSidecar(
      'ocr',
      pythonDe('condensation'),
      PORT_BANC_OCR,
      SIDECAR_PADDLE.routeSante,
      [
        SIDECAR_PADDLE.chemin,
        '--port',
        String(PORT_BANC_OCR),
        '--detection',
        String(values.detection),
      ],
    ),
  )
}
if (values.moteur === NOM_MOTEUR_COLLECTE.layoutlmv3) {
  sidecars.push(
    await demarrerSidecar(
      'collecte',
      pythonDe('collecte'),
      PORT_BANC_COLLECTE,
      SIDECAR_LAYOUTLM.routeSante,
      [
        SIDECAR_LAYOUTLM.chemin,
        '--port',
        String(PORT_BANC_COLLECTE),
        '--modele',
        String(values.modele),
      ],
    ),
  )
}

try {
  const passages: Passage[] = []
  for (const photo of photos.sort()) {
    passages.push(await passer(photo))
  }
  afficher(passages)
} finally {
  for (const sidecar of sidecars) {
    sidecar.kill('SIGTERM')
  }
}

function pythonDe(paquet: string): string {
  return fileURLToPath(new URL(`../packages/${paquet}/sidecar/.venv/bin/python`, import.meta.url))
}

async function demarrerSidecar(
  nom: string,
  python: string,
  port: number,
  routeSante: string,
  argumentsSidecar: string[],
): Promise<ChildProcess> {
  process.stdout.write(
    `Demarrage du sidecar ${nom} sur le port ${port} — le premier lancement telecharge les modeles...\n`,
  )
  // stderr herite : les messages du sidecar (telechargements, pret) s'affichent tels quels.
  const enfant = spawn(python, argumentsSidecar, { stdio: ['ignore', 'ignore', 'inherit'] })

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
        `Le sidecar ${nom} est mort avant d'etre pret. Le venv existe-t-il ? Voir le README :\n  cd packages/${nom === 'ocr' ? 'condensation' : 'collecte'}/sidecar && uv venv --python 3.11 && uv pip install -r requirements.txt`,
      )
    }
    try {
      const reponse = await fetch(`http://127.0.0.1:${port}${routeSante}`)
      if (reponse.ok) return enfant
    } catch {
      // Pas encore pret.
    }
    await new Promise((resoudre) => setTimeout(resoudre, INTERVALLE_SONDE_MS))
  }
  enfant.kill('SIGKILL')
  throw new Error(`Le sidecar ${nom} ne repond toujours pas, abandon.`)
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
  dernierEtiquetage = []
  try {
    const image = await chauffer(original)

    const debutCondensation = performance.now()
    const condensat = await condenser(image, moteurOcr)
    const condensationMs = performance.now() - debutCondensation

    const facture = await collecter(condensat, image, moteurGreffier, traceur)
    await exporter(nom, photo, image, facture)

    return {
      photo,
      verdict: STATUT_ETAPE.reussi,
      facture,
      durees,
      motifs,
      condensationMs,
      totalMs: performance.now() - debut,
    }
  } catch (erreur) {
    if (!(erreur instanceof ErreurAlambic)) {
      throw erreur
    }
    return {
      photo,
      verdict: erreur.code,
      facture: null,
      durees,
      motifs,
      condensationMs: 0,
      totalMs: performance.now() - debut,
    }
  }
}

// Le brouillon du futur dataset de fine-tuning : mots, boites 0-1000, etiquettes predites.
// Corriger `etiquette` a la main transforme la prediction en annotation.
async function exporter(
  nom: string,
  photo: string,
  image: ImageChauffee,
  facture: Facture,
): Promise<void> {
  const contenu = {
    image: photo,
    largeur: image.largeur,
    hauteur: image.hauteur,
    modele: moteurCollecte.nom,
    mots: dernierEtiquetage.map((mot) => ({
      texte: mot.texte,
      boite: boiteNormalisee(mot.cadre, image.largeur, image.hauteur),
      etiquette: etiquetteBio(mot),
      score: mot.score,
    })),
    facture,
  }
  await writeFile(join(sorties, `${nom}--collecte.json`), `${JSON.stringify(contenu, null, 2)}\n`)
}

// L'export rend le format BIO complet : `debut` distingue B- de I-, et l'exterieur reste nu.
function etiquetteBio(mot: MotEtiquete): string {
  if (mot.etiquette === ETIQUETTE.exterieur) return ETIQUETTE.exterieur
  return mot.debut ? `B-${mot.etiquette}` : `I-${mot.etiquette}`
}

function coche(valeur: unknown): string {
  return valeur === null ? ' —' : ' ✓'
}

// Les noms complets rendraient le tableau plus large qu'un terminal.
function abreger(nom: string): string {
  return nom
    .split('_')
    .map((mot) => mot.slice(0, 4))
    .join('')
    .slice(0, 6)
}

function afficher(passages: readonly Passage[]) {
  const largeurPhoto = Math.max(12, ...passages.map((p) => p.photo.length))
  const colonnes = [...SOUS_ETAPES_COLLECTE]
  const enTete = [
    'photo'.padEnd(largeurPhoto),
    'verdict'.padEnd(18),
    'mar',
    'dat',
    'dev',
    'sst',
    'tot',
    'car',
    'taxes'.padStart(5),
    'artic'.padStart(5),
    'conden'.padStart(7),
    ...colonnes.map((nom) => abreger(nom).padStart(7)),
    'TOTAL'.padStart(7),
  ]
  process.stdout.write(`\n${enTete.join(' ')}\n${'-'.repeat(enTete.join(' ').length)}\n`)

  for (const passage of passages) {
    const facture = passage.facture
    const cellules = [
      passage.photo.padEnd(largeurPhoto),
      passage.verdict.padEnd(18),
      facture === null ? ' —' : coche(facture.marchand),
      facture === null ? ' —' : coche(facture.date),
      facture === null ? ' —' : coche(facture.devise),
      facture === null ? ' —' : coche(facture.sousTotal),
      facture === null ? ' —' : coche(facture.total),
      facture === null ? ' —' : coche(facture.carte),
      String(facture?.taxes.length ?? 0).padStart(5),
      String(facture?.articles.length ?? 0).padStart(5),
      passage.condensationMs.toFixed(0).padStart(7),
      ...colonnes.map((nom) => {
        const duree = passage.durees.get(nom)
        return (duree === undefined ? '—' : duree.toFixed(0)).padStart(7)
      }),
      passage.totalMs.toFixed(0).padStart(7),
    ]
    process.stdout.write(`${cellules.join(' ')}\n`)
    for (const [sousEtape, motif] of passage.motifs) {
      process.stdout.write(`  ${' '.repeat(largeurPhoto)} ${sousEtape} : ${motif}\n`)
    }
  }

  const reussis = passages.filter((p) => p.verdict === STATUT_ETAPE.reussi)
  const moyenne = reussis.reduce((somme, p) => somme + p.totalMs, 0) / (reussis.length || 1)
  process.stdout.write(
    `\n${reussis.length}/${passages.length} collectees (ocr ${moteurOcr.nom}, collecte ${moteurCollecte.nom}), ${moyenne.toFixed(0)} ms en moyenne. Exports dans ${sorties}/\n`,
  )
}
