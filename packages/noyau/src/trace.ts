import type { Cadre } from './condensat'

// Ce que le pipeline laisse voir de son travail. Legitime dans le noyau au meme titre que
// grouperEnLignes : un contrat dont les etapes ont besoin sans avoir le droit de se connaitre.
// Aucune logique d'etape n'y monte, et le lecteur de traces n'a le droit d'en connaitre aucune.

export const STATUT_ETAPE = {
  enAttente: 'en_attente',
  enCours: 'en_cours',
  reussi: 'reussi',
  degrade: 'degrade',
  enErreur: 'en_erreur',
} as const

export type StatutEtape = (typeof STATUT_ETAPE)[keyof typeof STATUT_ETAPE]

export const ETAPE = {
  chauffe: 'chauffe',
  condensation: 'condensation',
  collecte: 'collecte',
} as const

export type Etape = (typeof ETAPE)[keyof typeof ETAPE]

export const GENRE_APERCU = {
  image: 'image',
  cadres: 'cadres',
  donnees: 'donnees',
} as const

export type GenreApercu = (typeof GENRE_APERCU)[keyof typeof GENRE_APERCU]

// Un fragment lu, ce qu'on y a lu, et la confiance qu'on lui accorde. `Cadre` vient du
// condensat : deja un contrat du noyau.
export type CadreAnnote = {
  cadre: Cadre
  texte: string
  confiance: number
}

// Trois genres, et le lecteur sait rendre les trois sans savoir quelle etape parle. Une etape
// DECLARE qu'elle produit des zones a superposer ; c'est ce qui evite un lecteur qui testerait
// le nom d'une sous-etape, donc un lecteur a modifier au prochain moteur.
export type Apercu =
  | { genre: typeof GENRE_APERCU.image; png: Buffer; largeur: number; hauteur: number }
  | { genre: typeof GENRE_APERCU.cadres; cadres: CadreAnnote[]; largeur: number; hauteur: number }
  | { genre: typeof GENRE_APERCU.donnees; valeur: unknown }

// Le meme apercu une fois pret a voyager : json pur, du worker jusqu'a la page, sans retouche.
// Deux types et c'est voulu : une etape produit un Buffer (naturel avec sharp), un evenement
// voyage en json (naturel pour un flux). La conversion se fait a un seul endroit.
export type ApercuTransmis =
  | { genre: typeof GENRE_APERCU.image; base64: string; largeur: number; hauteur: number }
  | { genre: typeof GENRE_APERCU.cadres; cadres: CadreAnnote[]; largeur: number; hauteur: number }
  | { genre: typeof GENRE_APERCU.donnees; valeur: unknown }

export type EvenementTrace = {
  etape: Etape
  sousEtape: string
  statut: StatutEtape
  dureeMs: number
  motif?: string
  apercus: ApercuTransmis[]
}

// Tout ce qu'un lecteur a besoin de savoir du pipeline, et rien de plus : il dessine ce que le
// plan decrit, jamais ce qu'il suppose. `etape` est une chaine et non l'enumeration parce
// qu'une page n'a aucune raison de connaitre les etapes qui existent.
export type PlanPipeline = {
  fanions: string[]
  produit: { nom: string; schema: string }
  etapes: { etape: string; entree: string; sortie: string; sousEtapes: string[] }[]
}

// Ni `en_attente` ni `en_cours` : une sous-etape qui se cloture a forcement produit quelque
// chose. `en_erreur` non plus, parce qu'une etape qui echoue leve au lieu de se cloturer.
export type IssueSousEtape = {
  statut: typeof STATUT_ETAPE.reussi | typeof STATUT_ETAPE.degrade
  motif?: string
  apercus?: Apercu[]
}

// Une seule methode : le nom n'est ecrit qu'une fois, le chronometrage est interne, et on ne
// peut pas fermer la mauvaise sous-etape.
export type Traceur = {
  demarrer(sousEtape: string): (issue: IssueSousEtape) => void
}

// Ce que recoit l'enchaineur des etapes : de quoi donner a chacune un traceur qui porte deja
// son etape. Sans ca, `demarrer` devrait reclamer l'etape a chaque appel, et chaque etape
// devrait repeter la sienne a chacune de ses sous-etapes.
export type Tracage = (etape: Etape) => Traceur
