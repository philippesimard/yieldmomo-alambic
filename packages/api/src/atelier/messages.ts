import type { CodeErreur, Distillation } from '@alambic/noyau'

// Les deux seuls messages qui traversent la frontiere entre le serveur et un ouvrier. Un
// ouvrier ne traite qu'une distillation a la fois, donc aucun identifiant de correlation n'est
// necessaire : la reponse qui arrive est celle de la tache en cours, forcement.

export type DemandeOuvrier = {
  image: ArrayBuffer
}

// L'erreur voyage a plat et non en instance : structuredClone recopie les champs d'une Error
// mais perd sa classe, et le serveur et l'ouvrier chargent de toute facon deux exemplaires
// distincts du module. C'est l'atelier qui reconstruit une ErreurAlambic a l'arrivee.
export type ReponseOuvrier =
  | { ok: true; distillation: Distillation }
  | { ok: false; code: CodeErreur; statut: number; message: string }
