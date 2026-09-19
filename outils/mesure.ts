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
import {
  type Attendu,
  bilan,
  CHAMPS_CATEGORIE,
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

const dossier = process.argv[2] ?? 'corpus'
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
for (const fichier of exports_.sort()) {
  const contenu = JSON.parse(await readFile(join(sorties, fichier), 'utf8')) as {
    image: string
    facture: Facture
  }
  const attendu = verite.get(contenu.image)
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
  notes.set('categorie', noterTexte(facture.categorie?.valeur ?? null, attendu.categorie))
  notes.set(
    'sousCategorie',
    noterTexte(facture.sousCategorie?.valeur ?? null, attendu.sousCategorie),
  )
  notes.set('taxes', noterTaxes(facture, attendu))
  notes.set('articles', noterArticles(facture, attendu))
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

  process.stdout.write(`\n${EN_TETE_BILAN}\n`)
  let justesTotal = 0
  let comptablesTotal = 0
  for (const nom of colonnes) {
    const verdicts = [...notes.values()].map((champs) => champs.get(nom)?.verdict)
    const comptables = verdicts.filter((verdict) => verdict !== VERDICT.vide)
    justesTotal += comptables.filter((verdict) => verdict === VERDICT.juste).length
    comptablesTotal += comptables.length
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
