// Banc de calibration de la Chauffe. Passe tout un dossier de photos et rend un tableau : c'est
// la vue d'ensemble qui permet de bouger un seuil sans casser cinq autres cas. Le hublot montre
// une photo en detail ; le banc montre le corpus entier d'un coup.
//
//   npm run banc -- corpus
//
// Les images produites vont dans <dossier>/sorties, pour etre regardees a l'oeil ensuite.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { chauffer, SOUS_ETAPES_CHAUFFE } from '@alambic/chauffe'
import {
  ErreurAlambic,
  GENRE_APERCU,
  type IssueSousEtape,
  STATUT_ETAPE,
  type Traceur,
} from '@alambic/noyau'

const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.avif', '.tif', '.tiff'])
const DOSSIER_SORTIES = 'sorties'

type Passage = {
  photo: string
  verdict: string
  qualite: number | undefined
  dimensions: string
  durees: Map<string, number>
  motifs: [string, string][]
  totalMs: number
}

const dossier = process.argv[2] ?? 'corpus'
const photos = (await readdir(dossier).catch(() => [])).filter((nom) =>
  EXTENSIONS.has(extname(nom).toLowerCase()),
)

if (photos.length === 0) {
  process.stdout.write(
    `Aucune image dans ${dossier}/.\nDeposez-y des photos de recus (nettes, floues, en contre-jour, debordantes, sur fond clair et sur fond fonce), puis relancez.\n`,
  )
  process.exit(0)
}

const sorties = join(dossier, DOSSIER_SORTIES)
await mkdir(sorties, { recursive: true })

const passages: Passage[] = []
for (const photo of photos.sort()) {
  passages.push(await passer(photo))
}

afficher(passages)

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
        void ecrireApercus(nom, sousEtape, issue)
      }
    },
  }

  const debut = performance.now()
  try {
    const image = await chauffer(original, traceur)
    await writeFile(join(sorties, `${nom}--final.png`), image.contenu)
    return {
      photo,
      verdict: STATUT_ETAPE.reussi,
      qualite: image.qualite,
      dimensions: `${image.largeur}x${image.hauteur}`,
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
      qualite: undefined,
      dimensions: '',
      durees,
      motifs,
      totalMs: performance.now() - debut,
    }
  }
}

async function ecrireApercus(nom: string, sousEtape: string, issue: IssueSousEtape) {
  const images = (issue.apercus ?? []).filter((apercu) => apercu.genre === GENRE_APERCU.image)
  for (const [rang, apercu] of images.entries()) {
    const suffixe = images.length > 1 ? `-${rang}` : ''
    await writeFile(join(sorties, `${nom}--${sousEtape}${suffixe}.png`), apercu.png)
  }
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
  const colonnes = [...SOUS_ETAPES_CHAUFFE]
  const enTete = [
    'photo'.padEnd(largeurPhoto),
    'verdict'.padEnd(18),
    'qual',
    'dimensions'.padEnd(11),
    ...colonnes.map((nom) => abreger(nom).padStart(5)),
    'TOTAL'.padStart(6),
  ]
  process.stdout.write(`\n${enTete.join(' ')}\n${'-'.repeat(enTete.join(' ').length)}\n`)

  for (const passage of passages) {
    const cellules = [
      passage.photo.padEnd(largeurPhoto),
      passage.verdict.padEnd(18),
      (passage.qualite === undefined ? '   —' : passage.qualite.toFixed(2)).padStart(4),
      passage.dimensions.padEnd(11),
      ...colonnes.map((nom) => {
        const duree = passage.durees.get(nom)
        return (duree === undefined ? '—' : duree.toFixed(0)).padStart(5)
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
    `\n${reussis.length}/${passages.length} distillees, ${moyenne.toFixed(0)} ms en moyenne. Images dans ${sorties}/\n`,
  )
}
