// Rejoue la lecture du marchand et de la categorie sur les condensats deja sauvegardes, sans
// ocr ni modele : une regle de categorie se juge en une seconde au lieu d'un passage complet du
// banc. Note le corpus contre sa verite terrain, puis passe les pieges — des recus ecrits a la
// main, chacun avec la reponse qu'il doit donner.
//
//   npm run banc:collecte -- corpus     (produit les condensats, une fois)
//   npm run rejeu:categorie -- corpus   (rejoue et note, a chaque changement de regle)
//
// Le corpus n'est pas versionne : sans lui, seuls les pieges passent, et ils suffisent a garder
// les regles. Sort en erreur au premier piege manque ou a la premiere categorie fausse du
// corpus : une categorie fausse coute plus cher au consommateur qu'une categorie absente.

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { reconnaitreCategorie, reconnaitreMarchand } from '@alambic/collecte'
import { type BlocTexte, CATEGORIE, type Facture, SousCategorieSchema } from '@alambic/noyau'
import { z } from 'zod'
import {
  bilan,
  CHAMPS_CATEGORIE,
  confusions,
  EN_TETE_BILAN,
  lireVerite,
  type Note,
  noterMarchand,
  noterTexte,
  VERDICT,
} from './notation'

const DOSSIER_SORTIES = 'sorties'
const SUFFIXE_CONDENSAT = '--condensat.txt'
const FICHIER_PIEGES = new URL('pieges-categorie.json', import.meta.url)

// Le condensat sauvegarde est le texte du Condensat : ses blocs deja regroupes en lignes. On en
// refait une ligne d'un seul bloc chacune. La confiance vaut 1 parce qu'elle ne decide rien dans
// ces reconnaisseurs, elle ne fait que se propager ; le cadre n'est lu par personne ici.
const HAUTEUR_LIGNE = 10

const CHAMPS = ['marchand', ...CHAMPS_CATEGORIE] as const

type Champ = (typeof CHAMPS)[number]

type Lecture = Pick<Facture, Champ>

// Les pieges s'ecrivent a la main : le schema dit lequel est mal forme, et une categorie mal
// orthographiee est refusee au lieu de rester un piege manque pour toujours.
const PiegesSchema = z.object({
  pieges: z.array(
    z.object({
      nom: z.string(),
      lignes: z.array(z.string()).min(1),
      attendu: z.object({
        categorie: z.enum(CATEGORIE).nullable(),
        sousCategorie: SousCategorieSchema.nullable(),
      }),
    }),
  ),
})

const dossier = process.argv[2] ?? 'corpus'
const fauxCorpus = await noterCorpus()
const manques = await passerPieges()
process.exit(fauxCorpus || manques > 0 ? 1 : 0)

// Rend vrai si une categorie du corpus est fausse.
async function noterCorpus(): Promise<boolean> {
  const verite = await lireVerite(dossier)
  const sorties = join(dossier, DOSSIER_SORTIES)
  const condensats = (await readdir(sorties).catch(() => []))
    .filter((nom) => nom.endsWith(SUFFIXE_CONDENSAT))
    .sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))
  if (verite === null || condensats.length === 0) {
    process.stdout.write(
      `\nPas de corpus note dans ${dossier}/ (verite.json et ${DOSSIER_SORTIES}/*${SUFFIXE_CONDENSAT}) : pieges seulement.\n`,
    )
    return false
  }

  // Le condensat porte le nom de la photo sans son extension.
  const photoDe = new Map([...verite.keys()].map((photo) => [photo.replace(/\.[^.]+$/, ''), photo]))
  const notes: Record<Champ, Map<string, Note>> = {
    marchand: new Map(),
    categorie: new Map(),
    sousCategorie: new Map(),
  }
  for (const fichier of condensats) {
    const photo = photoDe.get(fichier.slice(0, -SUFFIXE_CONDENSAT.length))
    const attendu = photo === undefined ? undefined : verite.get(photo)
    if (photo === undefined || attendu === undefined) continue

    const lecture = lire((await readFile(join(sorties, fichier), 'utf8')).split('\n'))
    notes.marchand.set(photo, noterMarchand(lecture.marchand?.valeur ?? null, attendu.marchand))
    notes.categorie.set(photo, noterTexte(lecture.categorie?.valeur ?? null, attendu.categorie))
    notes.sousCategorie.set(
      photo,
      noterTexte(lecture.sousCategorie?.valeur ?? null, attendu.sousCategorie),
    )
  }

  afficherCorpus(notes)
  return CHAMPS_CATEGORIE.some((champ) =>
    [...notes[champ].values()].some((note) => note.verdict === VERDICT.faux),
  )
}

function lire(textes: readonly string[]): Lecture {
  const lignes = textes
    .filter((texte) => texte.trim() !== '')
    .map((texte, rang) => [bloc(texte, rang)])
  const marchand = reconnaitreMarchand(lignes)
  return { marchand, ...reconnaitreCategorie({ lignes, marchand }) }
}

function bloc(texte: string, rang: number): BlocTexte {
  return {
    texte,
    cadre: { x: 0, y: rang * HAUTEUR_LIGNE, largeur: 1, hauteur: HAUTEUR_LIGNE },
    confiance: 1,
  }
}

function afficherCorpus(notes: Readonly<Record<Champ, ReadonlyMap<string, Note>>>) {
  const photos = [...notes.marchand.keys()]
  const largeur = Math.max(12, ...photos.map((photo) => photo.length))
  process.stdout.write(`\nCorpus ${dossier} — ${photos.length} photos\n\n`)
  for (const photo of photos) {
    for (const champ of CHAMPS) {
      const note = notes[champ].get(photo)
      if (note === undefined || note.verdict === VERDICT.juste || note.verdict === VERDICT.vide) {
        continue
      }
      process.stdout.write(
        `${photo.padEnd(largeur)} ${champ} ${note.verdict} : lu « ${note.lu} », attendu « ${note.attendu} »\n`,
      )
    }
  }

  process.stdout.write(`\n${EN_TETE_BILAN}\n`)
  for (const champ of CHAMPS) {
    const verdicts = [...notes[champ].values()].map((note) => note.verdict)
    process.stdout.write(`${bilan(champ, verdicts)}\n`)
  }
  for (const champ of CHAMPS_CATEGORIE) {
    const lignes = confusions(notes[champ])
    if (lignes.length > 0) process.stdout.write(`\n${champ} confondu :\n  ${lignes.join('\n  ')}\n`)
  }
}

// Rend le nombre de pieges manques.
async function passerPieges(): Promise<number> {
  const lu = PiegesSchema.safeParse(JSON.parse(await readFile(FICHIER_PIEGES, 'utf8')))
  if (!lu.success) {
    process.stdout.write(`\nPieges mal formes :\n${z.prettifyError(lu.error)}\n`)
    return 1
  }

  const { pieges } = lu.data
  process.stdout.write('\nPieges\n')
  const manques = pieges.filter((piege) => {
    const lecture = lire(piege.lignes)
    const categorie = lecture.categorie?.valeur ?? null
    const sousCategorie = lecture.sousCategorie?.valeur ?? null
    const tenu =
      categorie === piege.attendu.categorie && sousCategorie === piege.attendu.sousCategorie
    if (!tenu) {
      process.stdout.write(
        `  ✗ ${piege.nom} : rendu « ${categorie ?? '—'} / ${sousCategorie ?? '—'} », attendu « ${piege.attendu.categorie ?? '—'} / ${piege.attendu.sousCategorie ?? '—'} » (marchand « ${lecture.marchand?.valeur ?? '—'} »)\n`,
      )
    }
    return !tenu
  })
  process.stdout.write(`  ${pieges.length - manques.length}/${pieges.length} tenus\n`)
  return manques.length
}
