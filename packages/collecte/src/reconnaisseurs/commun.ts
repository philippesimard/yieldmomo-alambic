import type { BlocTexte } from '@alambic/noyau'

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
