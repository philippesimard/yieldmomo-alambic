import type { Facture } from './facture'

// Ce qu'une distillation laisse derriere elle : le cout de chaque etape en millisecondes, le
// poids de l'entree, ce que la Chauffe pense de la lisibilite de l'image et ce que la
// Condensation pense de sa propre lecture. Journalisee, pas renvoyee au consommateur : elle
// sert a surveiller le service, et une etape qui derape doit se voir dans les logs avant de se
// voir dans les temps de reponse.
//
// La qualite de lecture y tient sa place au meme titre que les durees : le hublot ne tourne
// qu'en developpement, et une lecture douteuse qui ne sortirait que la ne se verrait jamais en
// production — c'est-a-dire la ou elle compte.
export type Mesures = {
  octets: number
  qualite: number
  plancher: number
  muets: number
  bordure: number
  chauffeMs: number
  condensationMs: number
  collecteMs: number
  totalMs: number
}

export type Distillation = {
  facture: Facture
  mesures: Mesures
}
