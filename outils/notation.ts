// La notation d'un champ contre la verite terrain, partagee par la mesure du pipeline complet
// (mesure.ts) et par le rejeu de la categorie (rejeu-categorie.ts) : les deux doivent juger un
// champ de la meme facon, sinon leurs chiffres ne se comparent pas.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const FICHIER_VERITE = 'verite.json'

const DIACRITIQUES = /[̀-ͯ]/g

// Un champ ABSENT ne se note pas : un jeu synthetique ou public ne sait pas tout dire d'un recu,
// et le noter « vide » compterait faux tout ce que le pipeline y lirait. Un champ a `null`, lui,
// dit que le recu ne l'imprime pas.
export type Attendu = {
  marchand?: string | null
  date?: string | null
  devise?: string | null
  sousTotal?: number | null
  total?: number | null
  carte?: string | null
  // Nulles quand le recu ne dit rien du commerce — le verdict `vide` les sort alors du
  // denominateur, comme pour tout champ que le recu n'imprime pas.
  categorie?: string | null
  sousCategorie?: string | null
  taxes?: number[]
  articles?: number
}

// Un champ note : juste, faux (une valeur rendue qui n'est pas la bonne) ou manquant (rien
// rendu alors que le recu l'imprime). La distinction compte : un champ manquant degrade, un
// champ faux ment.
export const VERDICT = { juste: 'juste', faux: 'faux', manquant: 'manquant', vide: 'vide' } as const

export type Verdict = (typeof VERDICT)[keyof typeof VERDICT]

export type Note = { verdict: Verdict; lu: string; attendu: string }

// Les champs ou une valeur fausse se range dans une autre case : on en liste les confusions, qui
// disent quelle regle corriger.
export const CHAMPS_CATEGORIE = ['categorie', 'sousCategorie'] as const

// La verite terrain, indexee par nom de photo, ou null si le dossier n'en a pas : le corpus
// n'est pas versionne, un clone neuf ne l'a donc jamais. Les cles qui commencent par « _ » sont
// des notes pour le lecteur humain, pas des photos.
export async function lireVerite(dossier: string): Promise<Map<string, Attendu> | null> {
  if (!existsSync(join(dossier, FICHIER_VERITE))) return null
  // Sur : verite.json est ecrit a la main selon la forme Attendu, et seules ses cles de photo
  // sont gardees ci-dessous.
  const brut = JSON.parse(await readFile(join(dossier, FICHIER_VERITE), 'utf8')) as Record<
    string,
    Attendu
  >
  return new Map(Object.entries(brut).filter(([photo]) => !photo.startsWith('_')))
}

// Le marchand se juge sur l'enseigne, pas sur la ligne entiere : l'adresse et le numero de
// succursale collent souvent au nom, et les rendre n'est pas une erreur.
export function noterMarchand(lu: string | null, attendu: string | null): Note {
  if (attendu === null)
    return { verdict: lu === null ? VERDICT.vide : VERDICT.faux, lu: texte(lu), attendu: '—' }
  if (lu === null) return { verdict: VERDICT.manquant, lu: '—', attendu }
  const verdict = aplatir(lu).includes(aplatir(attendu)) ? VERDICT.juste : VERDICT.faux
  return { verdict, lu, attendu }
}

export function noterTexte(lu: string | null, attendu: string | null): Note {
  if (attendu === null) {
    return { verdict: lu === null ? VERDICT.vide : VERDICT.faux, lu: texte(lu), attendu: '—' }
  }
  if (lu === null) return { verdict: VERDICT.manquant, lu: '—', attendu }
  return { verdict: lu === attendu ? VERDICT.juste : VERDICT.faux, lu, attendu }
}

export function texte(valeur: unknown): string {
  return valeur === null ? '—' : String(valeur)
}

// Une ligne du bilan d'un champ. La precision (justes parmi les valeurs rendues) se lit a cote
// de l'exactitude (justes parmi les valeurs attendues) : un champ qui ment rarement mais se
// tait souvent n'a pas le meme defaut qu'un champ qui repond toujours et se trompe.
export function bilan(nom: string, verdicts: readonly (Verdict | undefined)[]): string {
  const { juste, faux, manquant } = compter(verdicts)
  const comptables = juste + faux + manquant
  const exactitude = comptables === 0 ? 1 : juste / comptables
  const precision = juste + faux === 0 ? 1 : juste / (juste + faux)
  return `${nom.padEnd(14)} ${String(juste).padStart(5)} ${String(faux).padStart(5)} ${String(manquant).padStart(9)}   ${pourcent(exactitude)}   ${pourcent(precision)}`
}

export type Compte = Record<Verdict, number>

// Un champ que le recu n'imprime pas (`vide`) se compte a part : le rendre nul est le
// comportement attendu, pas une reussite a porter au credit du pipeline.
export function compter(verdicts: readonly (Verdict | undefined)[]): Compte {
  const compte: Compte = { juste: 0, faux: 0, manquant: 0, vide: 0 }
  for (const verdict of verdicts) {
    if (verdict !== undefined) compte[verdict] += 1
  }
  return compte
}

export const EN_TETE_BILAN = `${'champ'.padEnd(14)} juste  faux  manquant   exact.   precis.`

// Les erreurs d'un champ regroupees par confusion (« restaurant → voyages [Image 21] ») : c'est
// la liste qui dit quelle regle corriger, la ou un simple compte ne dit que combien.
export function confusions(notes: ReadonlyMap<string, Note | undefined>): string[] {
  const groupes = new Map<string, string[]>()
  for (const [photo, note] of notes) {
    if (note === undefined || note.verdict !== VERDICT.faux) continue
    const cle = `${note.attendu} → ${note.lu}`
    groupes.set(cle, [...(groupes.get(cle) ?? []), photo])
  }
  return [...groupes].map(([cle, photos]) => `${cle} [${photos.join(', ')}]`)
}

function aplatir(valeur: string): string {
  return valeur.normalize('NFD').replace(DIACRITIQUES, '').toLowerCase().replace(/\s+/g, '')
}

function pourcent(part: number): string {
  return `${(part * 100).toFixed(0).padStart(3)} %`
}
