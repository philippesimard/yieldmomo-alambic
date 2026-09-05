// Note les factures exportees par le banc de collecte contre la verite terrain du corpus.
// Le banc dit ce que le pipeline a trouve ; la mesure dit s'il avait raison. Sans elle, on
// bouge un seuil en croyant l'avoir ameliore.
//
//   npm run banc:collecte -- corpus   (produit les exports)
//   npm run mesure -- corpus          (les note)
//
// La verite terrain vit dans <dossier>/verite.json, relevee a l'oeil sur chaque photo.

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Facture } from '@alambic/noyau'

const FICHIER_VERITE = 'verite.json'
const DOSSIER_SORTIES = 'sorties'
const SUFFIXE_EXPORT = '--collecte.json'

// Les montants se comparent au cent : l'ocr rend le montant imprime, pas un arrondi.
const TOLERANCE = 0.005

const CHAMPS_SIMPLES = ['marchand', 'date', 'devise', 'sousTotal', 'total', 'carte'] as const

type Attendu = {
  marchand: string | null
  date: string | null
  devise: string | null
  sousTotal: number | null
  total: number | null
  carte: string | null
  taxes: number[]
  articles: number
}

// Un champ note : juste, faux (une valeur rendue qui n'est pas la bonne) ou manquant (rien
// rendu alors que le recu l'imprime). La distinction compte : un champ manquant degrade, un
// champ faux ment.
const VERDICT = { juste: 'juste', faux: 'faux', manquant: 'manquant', vide: 'vide' } as const

type Verdict = (typeof VERDICT)[keyof typeof VERDICT]

type Note = { verdict: Verdict; lu: string; attendu: string }

const SIGNE: Record<Verdict, string> = {
  [VERDICT.juste]: '✓',
  [VERDICT.faux]: '✗',
  [VERDICT.manquant]: '·',
  [VERDICT.vide]: '✓',
}

const DIACRITIQUES = /[̀-ͯ]/g

const dossier = process.argv[2] ?? 'corpus'
const sorties = join(dossier, DOSSIER_SORTIES)

const verite = JSON.parse(await readFile(join(dossier, FICHIER_VERITE), 'utf8')) as Record<
  string,
  Attendu
>

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
for (const fichier of exports_.sort()) {
  const contenu = JSON.parse(await readFile(join(sorties, fichier), 'utf8')) as {
    image: string
    facture: Facture
  }
  const attendu = verite[contenu.image]
  if (attendu === undefined) continue
  notes.set(contenu.image, noter(contenu.facture, attendu))
}

afficher(notes)

function noter(facture: Facture, attendu: Attendu): Map<string, Note> {
  const notes = new Map<string, Note>()
  notes.set('marchand', noterMarchand(facture.marchand?.valeur ?? null, attendu.marchand))
  notes.set('date', noterTexte(facture.date?.valeur ?? null, attendu.date))
  notes.set('devise', noterTexte(facture.devise?.valeur ?? null, attendu.devise))
  notes.set('sousTotal', noterMontant(facture.sousTotal?.valeur ?? null, attendu.sousTotal))
  notes.set('total', noterMontant(facture.total?.valeur ?? null, attendu.total))
  notes.set('carte', noterTexte(facture.carte?.valeur ?? null, attendu.carte))
  notes.set('taxes', noterTaxes(facture, attendu))
  notes.set('articles', noterArticles(facture, attendu))
  return notes
}

// Le marchand se juge sur l'enseigne, pas sur la ligne entiere : l'adresse et le numero de
// succursale collent souvent au nom, et les rendre n'est pas une erreur.
function noterMarchand(lu: string | null, attendu: string | null): Note {
  if (attendu === null)
    return { verdict: lu === null ? VERDICT.vide : VERDICT.faux, lu: texte(lu), attendu: '—' }
  if (lu === null) return { verdict: VERDICT.manquant, lu: '—', attendu }
  const verdict = aplatir(lu).includes(aplatir(attendu)) ? VERDICT.juste : VERDICT.faux
  return { verdict, lu, attendu }
}

function noterTexte(lu: string | null, attendu: string | null): Note {
  if (attendu === null) {
    return { verdict: lu === null ? VERDICT.vide : VERDICT.faux, lu: texte(lu), attendu: '—' }
  }
  if (lu === null) return { verdict: VERDICT.manquant, lu: '—', attendu }
  return { verdict: lu === attendu ? VERDICT.juste : VERDICT.faux, lu, attendu }
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
function noterTaxes(facture: Facture, attendu: Attendu): Note {
  const lus = facture.taxes.map((taxe) => taxe.montant)
  const lu = `${lus.map((montant) => montant.toFixed(2)).join(' ')}`
  const attenduTexte = attendu.taxes.map((montant) => montant.toFixed(2)).join(' ')

  if (attendu.taxes.length === 0) {
    return { verdict: lus.length === 0 ? VERDICT.vide : VERDICT.faux, lu: lu || '—', attendu: '—' }
  }
  if (lus.length === 0) return { verdict: VERDICT.manquant, lu: '—', attendu: attenduTexte }

  const restants = [...lus]
  const trouves = attendu.taxes.filter((cible) => {
    const rang = restants.findIndex((montant) => Math.abs(montant - cible) < TOLERANCE)
    if (rang === -1) return false
    restants.splice(rang, 1)
    return true
  })
  const complet = trouves.length === attendu.taxes.length && restants.length === 0
  return { verdict: complet ? VERDICT.juste : VERDICT.faux, lu, attendu: attenduTexte }
}

// Les articles se notent en nombre de lignes, pas au libelle : l'ocr abrege, coupe et fusionne
// les noms de produits, et exiger le texte exact noterait l'ocr plutot que la reconstruction.
function noterArticles(facture: Facture, attendu: Attendu): Note {
  const lus = facture.articles.length
  const lu = String(lus)
  if (attendu.articles === 0) {
    return { verdict: lus === 0 ? VERDICT.vide : VERDICT.faux, lu, attendu: '0' }
  }
  if (lus === 0) return { verdict: VERDICT.manquant, lu: '0', attendu: String(attendu.articles) }
  return {
    verdict: lus === attendu.articles ? VERDICT.juste : VERDICT.faux,
    lu,
    attendu: String(attendu.articles),
  }
}

function aplatir(valeur: string): string {
  return valeur.normalize('NFD').replace(DIACRITIQUES, '').toLowerCase().replace(/\s+/g, '')
}

function texte(valeur: unknown): string {
  return valeur === null ? '—' : String(valeur)
}

function afficher(notes: ReadonlyMap<string, ReadonlyMap<string, Note>>) {
  const colonnes = [...CHAMPS_SIMPLES, 'taxes', 'articles']
  const largeurPhoto = Math.max(12, ...[...notes.keys()].map((nom) => nom.length))
  const enTete = [
    'photo'.padEnd(largeurPhoto),
    ...colonnes.map((nom) => nom.slice(0, 8).padStart(9)),
  ]
  process.stdout.write(`\n${enTete.join(' ')}\n${'-'.repeat(enTete.join(' ').length)}\n`)

  for (const [photo, champs] of notes) {
    const cellules = [
      photo.padEnd(largeurPhoto),
      ...colonnes.map((nom) =>
        (SIGNE[champs.get(nom)?.verdict ?? VERDICT.manquant] ?? '?').padStart(9),
      ),
    ]
    process.stdout.write(`${cellules.join(' ')}\n`)
    for (const nom of colonnes) {
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

  process.stdout.write(`\n${'champ'.padEnd(12)} juste  faux  manquant   exactitude\n`)
  let justesTotal = 0
  let comptablesTotal = 0
  for (const nom of colonnes) {
    const verdicts = [...notes.values()].map((champs) => champs.get(nom)?.verdict)
    // Un champ que le recu n'imprime pas ne se note pas : le rendre nul est le comportement
    // attendu, pas une reussite a porter au credit du pipeline.
    const comptables = verdicts.filter((verdict) => verdict !== VERDICT.vide)
    const justes = comptables.filter((verdict) => verdict === VERDICT.juste).length
    const faux = comptables.filter((verdict) => verdict === VERDICT.faux).length
    const manquants = comptables.filter((verdict) => verdict === VERDICT.manquant).length
    justesTotal += justes
    comptablesTotal += comptables.length
    const part = comptables.length === 0 ? 1 : justes / comptables.length
    process.stdout.write(
      `${nom.padEnd(12)} ${String(justes).padStart(5)} ${String(faux).padStart(5)} ${String(manquants).padStart(9)}   ${(part * 100).toFixed(0).padStart(3)} %\n`,
    )
  }
  const global = comptablesTotal === 0 ? 1 : justesTotal / comptablesTotal
  process.stdout.write(
    `\n${justesTotal}/${comptablesTotal} champs justes sur ${notes.size} photos — ${(global * 100).toFixed(1)} %\n`,
  )
}
