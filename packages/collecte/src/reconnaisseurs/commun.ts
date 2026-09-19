import type { BlocTexte } from '@alambic/noyau'

// La plage des signes combinants (U+0300 a U+036F), retires apres decomposition NFD.
const DIACRITIQUES = /[̀-ͯ]/g

export function texteDe(ligne: readonly BlocTexte[]): string {
  return ligne
    .map((bloc) => bloc.texte)
    .join(' ')
    .trim()
}

// Le maillon faible et non la moyenne : un champ dont un fragment est douteux reste douteux.
export function confianceDe(ligne: readonly BlocTexte[]): number {
  return ligne.reduce((minimum, bloc) => Math.min(minimum, bloc.confiance), 1)
}

// Minuscules et sans accents : la forme dans laquelle les lexiques des reconnaisseurs sont
// ecrits, et donc celle dans laquelle on leur presente le texte du recu.
export function normaliser(texte: string): string {
  return texte.normalize('NFD').replace(DIACRITIQUES, '').toLowerCase()
}
