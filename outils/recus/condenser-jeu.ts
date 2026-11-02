// Fait passer le jeu engendre par la vraie Chauffe et le vrai ocr, et reporte ses etiquettes sur
// les mots LUS. Le modele de la Collecte apprend alors sur ce qu'il recevra en service : le texte
// de l'ocr, fautes comprises, et ses boites, et non le texte exact et les boites parfaites du
// generateur.
//
//   npm run generer-recus
//   npm run condenser-jeu                       (lit outils/jeu, ecrit outils/jeu/ocr)
//   npm run entrainer-modele -- --jeu outils/jeu/ocr
//
// Le report ne suit pas la geometrie, que la Chauffe recadre et redresse : il aligne caractere
// par caractere le texte imprime et le texte lu (distance d'edition), puis chaque mot lu prend
// l'etiquette majoritaire de ses caracteres. Un recu dont trop peu de caracteres s'alignent
// (photo illisible, recu couche que l'ocr lit de travers) n'apprendrait que du bruit : il est
// ecarte.

import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chauffer } from '@alambic/chauffe'
import { decouperEnMots } from '@alambic/collecte'
import { condenser, creerMoteurOnnx } from '@alambic/condensation'
import { ErreurAlambic, grouperEnLignes } from '@alambic/noyau'

const JEU = fileURLToPath(new URL('../jeu', import.meta.url))
const SPLITS = ['train', 'valid', 'test'] as const

// L'etiquette du generateur pour un mot hors de tout champ, et celles qui ne sont pas du texte.
const EXTERIEUR = 'autre'
const NON_TEXTUELLES: ReadonlySet<string> = new Set(['qr', 'code_barres'])

// Un « mot » sans lettre ni chiffre est un filet de separation (« ------ », « ****** ») : l'ocr
// ne le rend pas comme du texte, et le compter fausserait l'alignement et sa mesure.
const LISIBLE = /[\p{L}\p{N}]/u

// Sous cette part de caracteres imprimes retrouves dans la lecture, le recu est ecarte. Mesure
// sur 20 recus : les lisibles s'alignent a 99-100 %, ceux que l'ocr lit en partie (lignes
// manquees, recu penche) entre 60 et 72 % — leurs mots lus restent bien etiquetes et ce sont
// les conditions difficiles qu'il faut apprendre ; un recu couche lu en bouillie tombe sous 40 %.
const ALIGNEMENT_MINIMUM = 0.5

// La part de caracteres d'un mot lu qui doivent se retrouver a l'identique dans le texte imprime
// pour que le mot en recoive l'etiquette.
const CORRESPONDANCE_MINIMALE = 0.6

// La barre de progression : sa largeur en caracteres, et le pas des lignes hors terminal.
const LARGEUR_BARRE = 30
const PAS_JOURNAL = 50

// Les pas du chemin d'alignement.
const DIAGONALE = 1
const SUPPRESSION = 2
const INSERTION = 3

type MotGenere = { texte: string; etiquette: string }
type MotLu = {
  texte: string
  etiquette: string
  indice_ligne: number
  bbox: [number, number, number, number]
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    jeu: { type: 'string', default: JEU },
    sortie: { type: 'string', default: join(JEU, 'ocr') },
    limite: { type: 'string', default: '0' },
  },
})

const moteur = creerMoteurOnnx({ fils: availableParallelism() })
const limite = Number(values.limite)
const bilan = { recus: 0, ecartes: 0, illisibles: 0, alignes: 0, imprimes: 0 }

// Tout le travail d'abord, pour que la progression connaisse le total.
const travail: { split: string; fichier: string }[] = []
for (const split of SPLITS) {
  const boites = join(values.jeu, split, 'boxes')
  if (!existsSync(boites)) continue
  await mkdir(join(values.sortie, split, 'boxes'), { recursive: true })
  const fichiers = (await readdir(boites)).filter((nom) => nom.endsWith('.json')).sort()
  for (const fichier of limite > 0 ? fichiers.slice(0, limite) : fichiers) {
    travail.push({ split, fichier })
  }
}

const debut = performance.now()
for (const { split, fichier } of travail) {
  const source = join(values.jeu, split)
  const genere = JSON.parse(await readFile(join(source, 'boxes', fichier), 'utf8')) as {
    file_name: string
    mots: MotGenere[]
  }
  const lu = await lire(join(source, genere.file_name))
  bilan.recus += 1
  if (lu === null) {
    bilan.illisibles += 1
  } else {
    const { mots, alignes, imprimes } = reporter(genere.mots, lu.mots)
    bilan.alignes += alignes
    bilan.imprimes += imprimes
    if (imprimes === 0 || alignes / imprimes < ALIGNEMENT_MINIMUM) {
      bilan.ecartes += 1
    } else {
      await writeFile(
        join(values.sortie, split, 'boxes', fichier),
        JSON.stringify({ largeur: lu.largeur, hauteur: lu.hauteur, mots }),
      )
    }
  }
  afficherProgression(split)
}
if (process.stderr.isTTY) process.stderr.write('\n')

process.stdout.write(
  `${bilan.recus} recus, ${bilan.illisibles} refuses par le pipeline, ${bilan.ecartes} ecartes (alignement sous ${ALIGNEMENT_MINIMUM * 100} %) ; ${((100 * bilan.alignes) / Math.max(1, bilan.imprimes)).toFixed(1)} % des caracteres imprimes retrouves. Ecrit dans ${values.sortie}/\n`,
)

// Une barre redessinee sur place dans un terminal ; ailleurs (journal, ci), une ligne tous les
// PAS_JOURNAL recus, pour ne pas noyer le fichier.
function afficherProgression(split: string): void {
  const faits = bilan.recus
  const total = travail.length
  if (!process.stderr.isTTY && faits % PAS_JOURNAL !== 0 && faits !== total) return
  const parRecu = (performance.now() - debut) / 1000 / faits
  const reste = Math.round(parRecu * (total - faits))
  const pleins = Math.round((LARGEUR_BARRE * faits) / total)
  const barre = `${'█'.repeat(pleins)}${'░'.repeat(LARGEUR_BARRE - pleins)}`
  const ligne = `${barre} ${faits}/${total} (${Math.floor((100 * faits) / total)} %) · ${split} · ${parRecu.toFixed(1)} s/recu · reste ${duree(reste)} · ${bilan.ecartes + bilan.illisibles} ecartes`
  process.stderr.write(process.stderr.isTTY ? `\r${ligne}\x1b[K` : `${ligne}\n`)
}

function duree(secondes: number): string {
  const heures = Math.floor(secondes / 3600)
  const minutes = Math.floor((secondes % 3600) / 60)
  return heures > 0
    ? `${heures} h ${String(minutes).padStart(2, '0')}`
    : `${minutes} min ${String(secondes % 60).padStart(2, '0')} s`
}

// Les mots tels que la Collecte les recoit en service : la meme chauffe, le meme ocr, le meme
// decoupage en mots. La ligne de chaque mot est celle de son bloc.
async function lire(chemin: string) {
  try {
    const image = await chauffer(await readFile(chemin))
    const condensat = await condenser(image, moteur)
    const ligneDe = new Map(
      grouperEnLignes(condensat.blocs).flatMap((ligne, rang) => ligne.map((bloc) => [bloc, rang])),
    )
    const mots = decouperEnMots(condensat.blocs).map((mot) => {
      const bloc = condensat.blocs[mot.indexBloc]
      return {
        texte: mot.texte,
        ligne: bloc === undefined ? 0 : (ligneDe.get(bloc) ?? 0),
        bbox: [
          mot.cadre.x,
          mot.cadre.y,
          mot.cadre.x + mot.cadre.largeur,
          mot.cadre.y + mot.cadre.hauteur,
        ] as [number, number, number, number],
      }
    })
    return { mots, largeur: image.largeur, hauteur: image.hauteur }
  } catch (erreur) {
    // Une photo trop floue ou sans texte lisible : le service la refuserait aussi.
    if (erreur instanceof ErreurAlambic) return null
    throw new Error(`${basename(chemin)} : ${String(erreur)}`)
  }
}

// Le texte compare sans casse ni accents : l'ocr rend « CAFE » la ou le generateur imprime
// « Café » en petites capitales, et ce n'est pas une erreur a apprendre au modele.
function comparable(caractere: string): string {
  return caractere.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

// Un caractere compare par caractere : la decomposition d'un accent ne doit pas allonger le texte.
function aComparer(texte: string): string {
  return [...texte].map((caractere) => comparable(caractere).slice(0, 1) || caractere).join('')
}

// Les caracteres d'une suite de mots, separes d'une espace, chacun avec le mot qui le porte.
function caracteresDe(mots: readonly { texte: string }[]): { texte: string; mots: Int32Array } {
  let texte = ''
  const proprietaires: number[] = []
  mots.forEach((mot, rang) => {
    if (texte.length > 0) {
      texte += ' '
      proprietaires.push(-1)
    }
    const comparables = aComparer(mot.texte)
    texte += comparables
    for (let indice = 0; indice < comparables.length; indice++) proprietaires.push(rang)
  })
  return { texte, mots: Int32Array.from(proprietaires) }
}

function reporter(
  generes: readonly MotGenere[],
  lus: readonly { texte: string; ligne: number; bbox: [number, number, number, number] }[],
): { mots: MotLu[]; alignes: number; imprimes: number } {
  const imprimes = generes.filter(
    (mot) => !NON_TEXTUELLES.has(mot.etiquette) && LISIBLE.test(mot.texte),
  )
  const source = caracteresDe(imprimes)
  const lecture = caracteresDe(lus)
  const total = source.texte.replace(/ /g, '').length
  // L'alignement global suppose le meme ordre des deux cotes. Sur un recu penche, l'ocr peut lire
  // l'en-tete apres le corps : chaque ligne lue s'aligne alors seule, la ou elle ressemble le plus
  // au texte imprime.
  const globale = aligner(source.texte, lecture.texte)
  const correspondance =
    compterAlignes(globale, source.texte, lecture.texte) >= ALIGNEMENT_MINIMUM * total
      ? globale
      : alignerParLigne(source.texte, lecture.texte, lus)

  // Les voix de chaque mot lu : l'etiquette du mot imprime qui porte chacun de ses caracteres
  // IDENTIQUES. Un caractere apparie a un autre ne vote pas : sur un recu penche, l'ocr lit
  // « TOTAL » a cote du montant de la TVQ, et l'alignement apparie ce montant au total imprime.
  const voix = lus.map(() => new Map<string, number>())
  const voter = (motLu: number, dansSource: number): void => {
    const etiquette = imprimes[source.mots[dansSource] ?? -1]?.etiquette ?? EXTERIEUR
    const urne = voix[motLu]
    urne?.set(etiquette, (urne.get(etiquette) ?? 0) + 1)
  }
  const identiques = new Int32Array(lus.length)
  correspondance.forEach((dansSource, position) => {
    const motLu = lecture.mots[position] ?? -1
    if (motLu < 0 || dansSource < 0 || source.texte[dansSource] !== lecture.texte[position]) return
    voter(motLu, dansSource)
    identiques[motLu] = (identiques[motLu] ?? 0) + 1
  })

  // Un mot que l'alignement a mal apparie est recherche seul dans tout le texte imprime : le
  // montant de la TVQ s'y retrouve a la ligne de la TVQ. Introuvable, il reste sans etiquette
  // plutot que d'en porter une fausse.
  lus.forEach((mot, rang) => {
    const texteMot = aComparer(mot.texte)
    if ((identiques[rang] ?? 0) >= CORRESPONDANCE_MINIMALE * texteMot.length) return
    voix[rang] = new Map()
    const retrouves: number[] = []
    alignerLocalement(source.texte, texteMot).forEach((dansSource, position) => {
      if (dansSource >= 0 && source.texte[dansSource] === texteMot[position]) {
        retrouves.push(dansSource)
      }
    })
    if (retrouves.length < CORRESPONDANCE_MINIMALE * texteMot.length) return
    for (const dansSource of retrouves) voter(rang, dansSource)
  })

  const mots = lus.map((mot, rang) => {
    const urne = [...(voix[rang] ?? new Map<string, number>())].sort((a, b) => b[1] - a[1])
    return {
      texte: mot.texte,
      etiquette: urne[0]?.[0] ?? EXTERIEUR,
      indice_ligne: mot.ligne,
      bbox: mot.bbox,
    }
  })
  return {
    mots,
    alignes: compterAlignes(correspondance, source.texte, lecture.texte),
    imprimes: total,
  }
}

function compterAlignes(correspondance: Int32Array, source: string, lecture: string): number {
  let alignes = 0
  correspondance.forEach((dansSource, position) => {
    if (dansSource >= 0 && lecture[position] !== ' ' && source[dansSource] === lecture[position]) {
      alignes += 1
    }
  })
  return alignes
}

// Chaque ligne lue alignee seule (alignement local de Smith-Waterman) sur le texte imprime entier.
function alignerParLigne(
  source: string,
  lecture: string,
  lus: readonly { texte: string; ligne: number }[],
): Int32Array {
  const correspondance = new Int32Array(lecture.length).fill(-1)
  let debut = 0
  let rang = 0
  while (rang < lus.length) {
    const ligne = lus[rang]?.ligne
    let fin = debut
    while (rang < lus.length && lus[rang]?.ligne === ligne) {
      fin += (lus[rang]?.texte.length ?? 0) + 1
      rang += 1
    }
    const morceau = lecture.slice(debut, Math.min(fin - 1, lecture.length))
    alignerLocalement(source, morceau).forEach((dansSource, position) => {
      correspondance[debut + position] = dansSource
    })
    debut = fin
  }
  return correspondance
}

// Le passage du texte imprime qui ressemble le plus au morceau lu : +2 par caractere identique,
// -1 par difference, ecart ou ajout. Pour chaque caractere du morceau, sa position imprimee ou -1.
function alignerLocalement(source: string, morceau: string): Int32Array {
  const n = source.length
  const m = morceau.length
  const scores = new Int32Array((n + 1) * (m + 1))
  const choix = new Uint8Array((n + 1) * (m + 1))
  let meilleur = 0
  let fin = 0
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cellule = i * (m + 1) + j
      const diagonale =
        (scores[cellule - m - 2] ?? 0) +
        (source.charCodeAt(i - 1) === morceau.charCodeAt(j - 1) ? 2 : -1)
      const haut = (scores[cellule - m - 1] ?? 0) - 1
      const gauche = (scores[cellule - 1] ?? 0) - 1
      const valeur = Math.max(0, diagonale, haut, gauche)
      scores[cellule] = valeur
      choix[cellule] =
        valeur === 0
          ? 0
          : valeur === diagonale
            ? DIAGONALE
            : valeur === haut
              ? SUPPRESSION
              : INSERTION
      if (valeur > meilleur) {
        meilleur = valeur
        fin = cellule
      }
    }
  }

  const correspondance = new Int32Array(m).fill(-1)
  let i = Math.floor(fin / (m + 1))
  let j = fin % (m + 1)
  while (i > 0 && j > 0 && (scores[i * (m + 1) + j] ?? 0) > 0) {
    const pas = choix[i * (m + 1) + j]
    if (pas === DIAGONALE) {
      correspondance[j - 1] = i - 1
      i -= 1
      j -= 1
    } else if (pas === SUPPRESSION) {
      i -= 1
    } else {
      j -= 1
    }
  }
  return correspondance
}

// Alignement global par distance d'edition (Levenshtein) : pour chaque caractere lu, la position
// du caractere imprime qui lui correspond, ou -1 s'il est en trop. Deux lignes de couts suffisent
// pour la distance ; la matrice des choix, en octets, permet de remonter le chemin.
function aligner(source: string, lecture: string): Int32Array {
  const n = source.length
  const m = lecture.length
  const choix = new Uint8Array((n + 1) * (m + 1))
  let precedente = new Int32Array(m + 1).map((_, j) => j)
  let courante = new Int32Array(m + 1)
  for (let j = 1; j <= m; j++) choix[j] = INSERTION
  for (let i = 1; i <= n; i++) {
    courante[0] = i
    choix[i * (m + 1)] = SUPPRESSION
    for (let j = 1; j <= m; j++) {
      const diagonale =
        (precedente[j - 1] ?? 0) + (source.charCodeAt(i - 1) === lecture.charCodeAt(j - 1) ? 0 : 1)
      const haut = (precedente[j] ?? 0) + 1
      const gauche = (courante[j - 1] ?? 0) + 1
      if (diagonale <= haut && diagonale <= gauche) {
        courante[j] = diagonale
        choix[i * (m + 1) + j] = DIAGONALE
      } else if (haut <= gauche) {
        courante[j] = haut
        choix[i * (m + 1) + j] = SUPPRESSION
      } else {
        courante[j] = gauche
        choix[i * (m + 1) + j] = INSERTION
      }
    }
    ;[precedente, courante] = [courante, precedente]
  }

  const correspondance = new Int32Array(m).fill(-1)
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    const pas = choix[i * (m + 1) + j]
    if (pas === DIAGONALE) {
      correspondance[j - 1] = i - 1
      i -= 1
      j -= 1
    } else if (pas === SUPPRESSION) {
      i -= 1
    } else {
      j -= 1
    }
  }
  return correspondance
}
