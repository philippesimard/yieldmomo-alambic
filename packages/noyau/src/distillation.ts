import type { Facture } from './facture'

// Ce qu'une distillation laisse derriere elle : le cout de chaque etape en millisecondes, le
// poids de l'entree, et ce que la Chauffe pense de la lisibilite de l'image. Journalisee, pas
// renvoyee au consommateur : elle sert a surveiller le service, et une etape qui derape doit se
// voir dans les logs avant de se voir dans les temps de reponse.
export type Mesures = {
  octets: number
  qualite: number
  chauffeMs: number
  condensationMs: number
  collecteMs: number
  totalMs: number
}

export type Distillation = {
  facture: Facture
  mesures: Mesures
}
