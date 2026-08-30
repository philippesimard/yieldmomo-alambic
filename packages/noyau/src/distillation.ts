import type { Facture } from './facture'

// Le cout de chaque etape, en millisecondes. Mesure a chaque distillation et journalisee, pas
// renvoyee au consommateur : elle sert a surveiller le service, et une etape qui derape doit
// se voir dans les logs avant de se voir dans les temps de reponse.
export type Mesures = {
  octets: number
  chauffeMs: number
  condensationMs: number
  collecteMs: number
  totalMs: number
}

export type Distillation = {
  facture: Facture
  mesures: Mesures
}
