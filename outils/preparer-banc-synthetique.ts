// Prepare un banc synthetique : les n premiers recus d'un split du jeu engendre, ranges comme le
// corpus (photos + verite.json) pour que banc:collecte et mesure les lisent sans le savoir.
//
//   npm run generer-recus                                    (ecrit outils/jeu/)
//   npm run preparer-banc-synthetique -- --split test --n 200
//   npm run banc:collecte -- outils/jeu/banc-test
//   npm run mesure -- outils/jeu/banc-test
//
// La verite ne note que ce que le generateur sait sans ambiguite : marchand, date, devise,
// montants, taxes imprimees, carte, nombre d'articles. La categorie n'y est pas : les types de
// commerce du generateur ne se rangent pas un a un dans les sous-categories de YieldMomo, et
// une correspondance devinee noterait la table plutot que le pipeline.

import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { TYPE_CARTE, type TypeCarte } from '@alambic/noyau'
import type { Attendu } from './notation'

const JEU = fileURLToPath(new URL('jeu', import.meta.url))

// Les modes de paiement du generateur (catalogue.MODES_PAIEMENT). Le comptant n'imprime aucune
// carte ; un debit sans reseau nomme se lit comme Interac, comme le fait reconnaitreCarte.
const CARTE_DU_MODE: Record<string, TypeCarte | null> = {
  INTERAC: TYPE_CARTE.interac,
  DEBIT: TYPE_CARTE.interac,
  VISA: TYPE_CARTE.visa,
  MASTERCARD: TYPE_CARTE.mastercard,
  AMEX: TYPE_CARTE.amex,
  COMPTANT: null,
}

// Le generateur n'engendre que des recus quebecois, en dollars canadiens.
const DEVISE_DU_JEU = 'CAD'

// Etiquettes que le generateur pose sur le MONTANT de chaque taxe (pas sur son libelle). Un
// petit fournisseur n'imprime souvent pas ses taxes nulles : la verite ne peut attendre que ce
// qui est sur le papier.
const ETIQUETTE_TPS = 'tps'
const ETIQUETTE_TVQ = 'tvq'

type Metadonnee = { file_name: string; ground_truth: string }

type VeriteGenerateur = {
  gt_parse: {
    info: { marchand: string; date: string }
    menu: unknown[]
    sub_total: { subtotal_price: string; tps: string; tvq: string }
    total: { total_price: string; paiement: string }
  }
}

type Boites = { mots: { etiquette: string }[] }

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    split: { type: 'string', default: 'test' },
    n: { type: 'string', default: '200' },
  },
})

const source = join(JEU, values.split)
const cible = join(JEU, `banc-${values.split}`)
const nombre = Number(values.n)

if (!existsSync(join(source, 'metadata.jsonl'))) {
  process.stdout.write(`Aucun jeu dans ${source}/. Lancer d'abord : npm run generer-recus\n`)
  process.exit(1)
}

// Repart de zero : un banc garde d'une preparation precedente melangerait deux tirages.
await rm(cible, { recursive: true, force: true })
await mkdir(cible, { recursive: true })

const lignes = (await readFile(join(source, 'metadata.jsonl'), 'utf8')).split('\n').filter(Boolean)
const verite: Record<string, Attendu> = {}

for (const ligne of lignes.slice(0, nombre)) {
  // Sur : metadata.jsonl est ecrit par outils/recus/generateur/export.py, au format decrit dans
  // outils/recus/README.md.
  const metadonnee = JSON.parse(ligne) as Metadonnee
  const { gt_parse: gt } = JSON.parse(metadonnee.ground_truth) as VeriteGenerateur
  const photo = basename(metadonnee.file_name)
  const image = join(source, metadonnee.file_name)
  const boites = JSON.parse(
    await readFile(join(source, 'boxes', photo.replace(/\.[^.]+$/, '.json')), 'utf8'),
  ) as Boites
  const imprimees = new Set(boites.mots.map((mot) => mot.etiquette))

  // Un lien et non une copie : le jeu pese deja plus d'un Go.
  await symlink(relative(cible, image), join(cible, photo))
  verite[photo] = {
    marchand: gt.info.marchand,
    date: gt.info.date,
    devise: DEVISE_DU_JEU,
    sousTotal: Number(gt.sub_total.subtotal_price),
    total: Number(gt.total.total_price),
    carte: CARTE_DU_MODE[gt.total.paiement] ?? null,
    taxes: [
      ...(imprimees.has(ETIQUETTE_TPS) ? [Number(gt.sub_total.tps)] : []),
      ...(imprimees.has(ETIQUETTE_TVQ) ? [Number(gt.sub_total.tvq)] : []),
    ],
    articles: gt.menu.length,
  }
}

await writeFile(join(cible, 'verite.json'), `${JSON.stringify(verite, null, 2)}\n`)
process.stdout.write(
  `${Object.keys(verite).length} recus prepares dans ${relative(process.cwd(), cible)}/\n`,
)
