// Note les factures exportees par le banc de collecte contre la verite terrain du corpus.
// Le banc dit ce que le pipeline a trouve ; la mesure dit s'il avait raison. Sans elle, on
// bouge un seuil en croyant l'avoir ameliore.
//
//   npm run banc:collecte -- corpus   (produit les exports)
//   npm run mesure -- corpus          (les note)
//   npm run mesure -- corpus --json outils/references/v1-corpus.json        (fige une reference)
//   npm run mesure -- corpus --reference outils/references/v1-corpus.json   (compare, sort en
//                                                                            erreur si recul)
//
// La verite terrain vit dans <dossier>/verite.json, relevee a l'oeil sur chaque photo. La
// reference ne garde que des verdicts et des comptes, jamais une valeur lue : elle se versionne
// sans rien devoiler des recus.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { COHERENCE, type Coherence, type Facture } from '@alambic/noyau'
import {
  type Attendu,
  bilan,
  CHAMPS_CATEGORIE,
  type Compte,
  compter,
  confusions,
  EN_TETE_BILAN,
  lireVerite,
  type Note,
  noterMarchand,
  noterTexte,
  texte,
  VERDICT,
  type Verdict,
} from './notation'

const DOSSIER_SORTIES = 'sorties'
const SUFFIXE_EXPORT = '--collecte.json'

// Les montants se comparent au cent : l'ocr rend le montant imprime, pas un arrondi.
const TOLERANCE = 0.005

const CHAMPS_SIMPLES = [
  'marchand',
  'date',
  'devise',
  'sousTotal',
  'total',
  'carte',
  'categorie',
  'sousCategorie',
] as const

const SIGNE: Record<Verdict, string> = {
  [VERDICT.juste]: '✓',
  [VERDICT.faux]: '✗',
  [VERDICT.manquant]: '·',
  [VERDICT.vide]: '✓',
}

const COLONNES = [...CHAMPS_SIMPLES, 'taxes', 'articles'] as const

// Les champs qu'engage le bilan sous-total + taxes = total : quand la Collecte le dit coherent,
// les trois doivent etre justes, sinon le drapeau ment.
const CHAMPS_DU_BILAN = ['sousTotal', 'total', 'taxes'] as const

// Combien de factures dans chaque etat, et combien des coherentes le sont a raison.
type BilanCoherence = Record<Coherence, number> & { justes: number }

// Ce que la mesure fige et compare : assez pour reperer un recul champ par champ et photo par
// photo, rien qui dise ce qu'un recu contenait.
type Resume = {
  checkpoints: string[]
  photos: number
  facturesJustes: number
  champs: Record<string, Compte>
  verdicts: Record<string, Record<string, Verdict>>
  // Absente des exports d'avant le solveur.
  coherence?: BilanCoherence
}

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    json: { type: 'string' },
    reference: { type: 'string' },
  },
  allowPositionals: true,
})

const dossier = positionals[0] ?? 'corpus'
const sorties = join(dossier, DOSSIER_SORTIES)

const verite = await lireVerite(dossier)
if (verite === null) {
  process.stdout.write(`Aucune verite terrain dans ${dossier}/ : rien a noter.\n`)
  process.exit(0)
}

const exports_ = (await readdir(sorties).catch(() => [])).filter((nom) =>
  nom.endsWith(SUFFIXE_EXPORT),
)

if (exports_.length === 0) {
  process.stdout.write(
    `Aucun export dans ${sorties}/. Lancer d'abord : npm run banc:collecte -- ${dossier}\n`,
  )
  process.exit(0)
}

const notes = new Map<string, Map<string, Note>>()
const checkpoints = new Set<string>()
const coherences = new Map<string, Coherence>()
for (const fichier of exports_.sort()) {
  const contenu = JSON.parse(await readFile(join(sorties, fichier), 'utf8')) as {
    image: string
    checkpoint?: string | null
    facture: Facture
    coherence?: Coherence
  }
  const attendu = verite.get(contenu.image)
  if (attendu === undefined) continue
  notes.set(contenu.image, noter(contenu.facture, attendu))
  // Le nom seul : un chemin absolu dirait sur quel poste la mesure a tourne, pas ce qu'elle juge.
  if (contenu.checkpoint) checkpoints.add(basename(contenu.checkpoint))
  if (contenu.coherence !== undefined) coherences.set(contenu.image, contenu.coherence)
}

afficher(notes)

const resume = resumer(notes, checkpoints, coherences)
if (resume.coherence !== undefined) {
  process.stdout.write(`${texteCoherence(resume.coherence)}\n`)
}
if (values.json !== undefined) {
  await mkdir(dirname(values.json), { recursive: true })
  await writeFile(values.json, `${JSON.stringify(resume, null, 2)}\n`)
  process.stdout.write(`\nResume ecrit dans ${values.json}\n`)
}
if (values.reference !== undefined) {
  // Sur : la reference est un resume ecrit par ce script meme, avec --json.
  const reference = JSON.parse(await readFile(values.reference, 'utf8')) as Resume
  if (comparer(resume, reference)) process.exitCode = 1
}

function resumer(
  notes: ReadonlyMap<string, ReadonlyMap<string, Note>>,
  checkpoints: Set<string>,
  coherences: ReadonlyMap<string, Coherence>,
) {
  const verdicts: Record<string, Record<string, Verdict>> = {}
  for (const [photo, champs] of notes) {
    verdicts[photo] = Object.fromEntries([...champs].map(([nom, note]) => [nom, note.verdict]))
  }
  const champs = Object.fromEntries(
    COLONNES.map((nom) => [nom, compter([...notes.values()].map((c) => c.get(nom)?.verdict))]),
  )
  const facturesJustes = [...notes.values()].filter((notesPhoto) =>
    [...notesPhoto.values()].every((note) => estJuste(note.verdict)),
  ).length
  const resume: Resume = {
    checkpoints: [...checkpoints].sort(),
    photos: notes.size,
    facturesJustes,
    champs,
    verdicts,
    coherence: coherences.size === 0 ? undefined : bilanCoherence(notes, coherences),
  }
  return resume
}

function bilanCoherence(
  notes: ReadonlyMap<string, ReadonlyMap<string, Note>>,
  coherences: ReadonlyMap<string, Coherence>,
): BilanCoherence {
  const bilan: BilanCoherence = {
    [COHERENCE.coherente]: 0,
    [COHERENCE.incoherente]: 0,
    [COHERENCE.indeterminee]: 0,
    justes: 0,
  }
  for (const [photo, champs] of notes) {
    const coherence = coherences.get(photo)
    if (coherence === undefined) continue
    bilan[coherence] += 1
    const bilanJuste = CHAMPS_DU_BILAN.every((nom) => {
      const note = champs.get(nom)
      return note === undefined || estJuste(note.verdict)
    })
    if (coherence === COHERENCE.coherente && bilanJuste) bilan.justes += 1
  }
  return bilan
}

function texteCoherence(bilan: BilanCoherence): string {
  const coherentes = bilan[COHERENCE.coherente]
  const part = coherentes === 0 ? 1 : bilan.justes / coherentes
  return `Coherence : ${coherentes} coherentes dont ${bilan.justes} a raison (${(part * 100).toFixed(1)} %), ${bilan[COHERENCE.incoherente]} incoherentes, ${bilan[COHERENCE.indeterminee]} indeterminees`
}

// Un recul, c'est un champ qui perd une reponse juste ou gagne une reponse fausse : un faux
// ment au consommateur, il pese plus qu'un manquant et ne doit jamais se cacher derriere un
// juste gagne ailleurs.
function comparer(resume: Resume, reference: Resume): boolean {
  process.stdout.write(
    `\nComparaison avec la reference (${reference.checkpoints.join(', ') || 'sans checkpoint'})\n`,
  )
  let recul = false
  for (const nom of COLONNES) {
    const avant = reference.champs[nom]
    const apres = resume.champs[nom]
    if (avant === undefined || apres === undefined) continue
    const perd = apres.juste < avant.juste || apres.faux > avant.faux
    recul ||= perd
    const signe = perd ? '✗' : apres.juste > avant.juste || apres.faux < avant.faux ? '↑' : '='
    process.stdout.write(
      `${signe} ${nom.padEnd(14)} juste ${avant.juste} → ${apres.juste}   faux ${avant.faux} → ${apres.faux}\n`,
    )
  }
  process.stdout.write(
    `  factures entierement justes ${reference.facturesJustes} → ${resume.facturesJustes} sur ${resume.photos}\n`,
  )
  if (reference.coherence !== undefined) {
    process.stdout.write(`  avant : ${texteCoherence(reference.coherence)}\n`)
  }
  if (resume.coherence !== undefined) {
    process.stdout.write(`  apres : ${texteCoherence(resume.coherence)}\n`)
  }

  for (const [photo, champs] of Object.entries(resume.verdicts)) {
    for (const [nom, verdict] of Object.entries(champs)) {
      const ancien = reference.verdicts[photo]?.[nom]
      if (ancien === undefined || ancien === verdict) continue
      if (estJuste(ancien) && !estJuste(verdict)) {
        process.stdout.write(`  recul ${photo} ${nom} : ${ancien} → ${verdict}\n`)
      }
    }
  }
  process.stdout.write(recul ? '\nRecul : au moins un champ perd.\n' : '\nAucun recul.\n')
  return recul
}

function estJuste(verdict: Verdict): boolean {
  return verdict === VERDICT.juste || verdict === VERDICT.vide
}

function noter(facture: Facture, attendu: Attendu): Map<string, Note> {
  const notes = new Map<string, Note>()
  const noterSi = <T>(nom: string, valeur: T | undefined, noteur: (valeur: T) => Note): void => {
    if (valeur !== undefined) notes.set(nom, noteur(valeur))
  }
  noterSi('marchand', attendu.marchand, (a) => noterMarchand(facture.marchand?.valeur ?? null, a))
  noterSi('date', attendu.date, (a) => noterTexte(facture.date?.valeur ?? null, a))
  noterSi('devise', attendu.devise, (a) => noterTexte(facture.devise?.valeur ?? null, a))
  noterSi('sousTotal', attendu.sousTotal, (a) => noterMontant(facture.sousTotal?.valeur ?? null, a))
  noterSi('total', attendu.total, (a) => noterMontant(facture.total?.valeur ?? null, a))
  noterSi('carte', attendu.carte, (a) => noterTexte(facture.carte?.valeur ?? null, a))
  noterSi('categorie', attendu.categorie, (a) => noterTexte(facture.categorie?.valeur ?? null, a))
  noterSi('sousCategorie', attendu.sousCategorie, (a) =>
    noterTexte(facture.sousCategorie?.valeur ?? null, a),
  )
  noterSi('taxes', attendu.taxes, (a) => noterTaxes(facture, a))
  noterSi('articles', attendu.articles, (a) => noterArticles(facture, a))
  return notes
}

function noterMontant(lu: number | null, attendu: number | null): Note {
  if (attendu === null) {
    return { verdict: lu === null ? VERDICT.vide : VERDICT.faux, lu: texte(lu), attendu: '—' }
  }
  if (lu === null) return { verdict: VERDICT.manquant, lu: '—', attendu: attendu.toFixed(2) }
  const verdict = Math.abs(lu - attendu) < TOLERANCE ? VERDICT.juste : VERDICT.faux
  return { verdict, lu: lu.toFixed(2), attendu: attendu.toFixed(2) }
}

// Les taxes se notent en ensemble : le recu en imprime deux, on veut les deux, sans doublon
// ni montant invente. L'ordre est libre, le nom ne se note pas (le contrat le rend tel que lu).
function noterTaxes(facture: Facture, attendues: readonly number[]): Note {
  const lus = facture.taxes.map((taxe) => taxe.montant)
  const lu = `${lus.map((montant) => montant.toFixed(2)).join(' ')}`
  const attenduTexte = attendues.map((montant) => montant.toFixed(2)).join(' ')

  if (attendues.length === 0) {
    return { verdict: lus.length === 0 ? VERDICT.vide : VERDICT.faux, lu: lu || '—', attendu: '—' }
  }
  if (lus.length === 0) return { verdict: VERDICT.manquant, lu: '—', attendu: attenduTexte }

  const restants = [...lus]
  const trouves = attendues.filter((cible) => {
    const rang = restants.findIndex((montant) => Math.abs(montant - cible) < TOLERANCE)
    if (rang === -1) return false
    restants.splice(rang, 1)
    return true
  })
  const complet = trouves.length === attendues.length && restants.length === 0
  return { verdict: complet ? VERDICT.juste : VERDICT.faux, lu, attendu: attenduTexte }
}

// Les articles se notent en nombre de lignes, pas au libelle : l'ocr abrege, coupe et fusionne
// les noms de produits, et exiger le texte exact noterait l'ocr plutot que la reconstruction.
function noterArticles(facture: Facture, attendus: number): Note {
  const lus = facture.articles.length
  const lu = String(lus)
  if (attendus === 0) {
    return { verdict: lus === 0 ? VERDICT.vide : VERDICT.faux, lu, attendu: '0' }
  }
  if (lus === 0) return { verdict: VERDICT.manquant, lu: '0', attendu: String(attendus) }
  return {
    verdict: lus === attendus ? VERDICT.juste : VERDICT.faux,
    lu,
    attendu: String(attendus),
  }
}

function afficher(notes: ReadonlyMap<string, ReadonlyMap<string, Note>>) {
  const largeurPhoto = Math.max(12, ...[...notes.keys()].map((nom) => nom.length))
  const enTete = [
    'photo'.padEnd(largeurPhoto),
    ...COLONNES.map((nom) => nom.slice(0, 8).padStart(9)),
  ]
  process.stdout.write(`\n${enTete.join(' ')}\n${'-'.repeat(enTete.join(' ').length)}\n`)

  for (const [photo, champs] of notes) {
    const cellules = [
      photo.padEnd(largeurPhoto),
      ...COLONNES.map((nom) => {
        const note = champs.get(nom)
        // Un champ que la verite ne note pas reste blanc.
        return (note === undefined ? '' : SIGNE[note.verdict]).padStart(9)
      }),
    ]
    process.stdout.write(`${cellules.join(' ')}\n`)
    for (const nom of COLONNES) {
      const note = champs.get(nom)
      if (note === undefined || note.verdict === VERDICT.juste || note.verdict === VERDICT.vide) {
        continue
      }
      const etat = note.verdict === VERDICT.faux ? 'faux' : 'manquant'
      process.stdout.write(
        `  ${' '.repeat(largeurPhoto)} ${nom} ${etat} : lu « ${note.lu} », attendu « ${note.attendu} »\n`,
      )
    }
  }

  process.stdout.write(`\n${EN_TETE_BILAN}\n`)
  let justesTotal = 0
  let comptablesTotal = 0
  for (const nom of COLONNES) {
    const verdicts = [...notes.values()].map((champs) => champs.get(nom)?.verdict)
    // Un champ que la verite ne note pas n'a pas de ligne au bilan et ne compte pas au total.
    if (verdicts.every((verdict) => verdict === undefined)) continue
    const { juste, faux, manquant } = compter(verdicts)
    justesTotal += juste
    comptablesTotal += juste + faux + manquant
    process.stdout.write(`${bilan(nom, verdicts)}\n`)
  }
  for (const nom of CHAMPS_CATEGORIE) {
    const lignes = confusions(
      new Map([...notes].map(([photo, champs]) => [photo, champs.get(nom)])),
    )
    if (lignes.length > 0) process.stdout.write(`\n${nom} confondu :\n  ${lignes.join('\n  ')}\n`)
  }
  const global = comptablesTotal === 0 ? 1 : justesTotal / comptablesTotal
  process.stdout.write(
    `\n${justesTotal}/${comptablesTotal} champs justes sur ${notes.size} photos — ${(global * 100).toFixed(1)} %\n`,
  )
}
