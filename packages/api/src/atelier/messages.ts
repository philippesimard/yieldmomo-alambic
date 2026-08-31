import type { CodeErreur, Distillation, EvenementTrace } from '@alambic/noyau'

// Les seuls messages qui traversent la frontiere entre le serveur et un ouvrier. Un ouvrier ne
// traite qu'une distillation a la fois, donc aucun identifiant de correlation n'est
// necessaire : les messages qui arrivent sont ceux de la tache en cours, forcement.

export const GENRE_MESSAGE = {
  trace: 'trace',
  fin: 'fin',
  echec: 'echec',
} as const

// `trace` absent ou faux : l'ouvrier ne construit aucun traceur, et la distillation ne paie pas
// une observation que personne n'ecoute.
export type DemandeOuvrier = {
  image: ArrayBuffer
  trace?: boolean
}

// Un flux et non une reponse unique : les traces arrivent au fil de l'execution, et seul le
// dernier message clot la tache.
//
// L'erreur voyage a plat et non en instance : structuredClone recopie les champs d'une Error
// mais perd sa classe, et le serveur et l'ouvrier chargent de toute facon deux exemplaires
// distincts du module. C'est l'atelier qui reconstruit une ErreurAlambic a l'arrivee.
export type EchecOuvrier = {
  genre: typeof GENRE_MESSAGE.echec
  code: CodeErreur
  statut: number
  message: string
}

export type MessageOuvrier =
  | { genre: typeof GENRE_MESSAGE.trace; evenement: EvenementTrace }
  | { genre: typeof GENRE_MESSAGE.fin; distillation: Distillation }
  | EchecOuvrier
