import { z } from 'zod'

// Alambic est appele par un programme, jamais par un humain : pas de dictionnaire de
// traductions ici, contrairement a une api destinee a un navigateur. On rend un CODE stable,
// que l'appelant teste, et un message francais qui ne sert qu'aux logs. C'est au consommateur
// de dire a l'utilisateur ce qui s'est passe, dans sa langue a lui.
export const CODE_ERREUR = {
  cleInvalide: 'cle_invalide',
  requeteInvalide: 'requete_invalide',
  formatNonSupporte: 'format_non_supporte',
  imageIllisible: 'image_illisible',
  imageTropLourde: 'image_trop_lourde',
  imageTropFloue: 'image_trop_floue',
  aucunTexte: 'aucun_texte',
  delaiDepasse: 'delai_depasse',
  surcharge: 'surcharge',
  erreurInterne: 'erreur_interne',
} as const

export type CodeErreur = (typeof CODE_ERREUR)[keyof typeof CODE_ERREUR]

export const ReponseErreurSchema = z.object({
  code: z.enum(CODE_ERREUR),
  message: z.string(),
})

export type ReponseErreur = z.infer<typeof ReponseErreurSchema>

// La seule erreur que les etapes ont le droit de lever. Elle porte son code et son statut, ce
// qui permet au gestionnaire d'erreurs du serveur de la traduire sans rien savoir de l'etape
// qui l'a levee : sans ca, chaque etape devrait connaitre le protocole http.
export class ErreurAlambic extends Error {
  readonly code: CodeErreur
  readonly statut: number

  constructor(code: CodeErreur, statut: number, message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'ErreurAlambic'
    this.code = code
    this.statut = statut
  }
}
