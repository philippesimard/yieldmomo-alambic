import { z } from 'zod'

// La sortie du systeme, et la seule forme qu'Alambic publie. Schema Zod et non type simple,
// contrairement aux frontieres internes : celle-ci part sur le reseau, donc fastify la
// serialise et la contraint.

export const ConfianceSchema = z.number().min(0).max(1)

// Montants bruts, jamais arrondis ici : l'arrondi au cent appartient a l'affichage, chez le
// consommateur. Negatif accepte, un remboursement en est un.
export const MontantSchema = z.number().finite()

// Un champ tire de l'image, avec la confiance qu'on lui accorde. Sans confiance par champ, le
// consommateur devrait faire confirmer toute la facture a l'utilisateur, ou tout croire.
function extrait<T extends z.ZodType>(valeur: T) {
  return z.object({ valeur, confiance: ConfianceSchema })
}

// Une ligne porte sa confiance en bloc plutot que champ par champ : le moteur la lit d'un
// seul tenant, et une confiance par cellule serait une precision qu'aucun ocr ne fournit.
export const ArticleSchema = z.object({
  libelle: z.string(),
  quantite: z.number().positive().nullable(),
  prixUnitaire: MontantSchema.nullable(),
  montant: MontantSchema,
  confiance: ConfianceSchema,
})

export const TaxeSchema = z.object({
  // Tel que lu sur le recu (« TPS », « TVQ », « HST »), sans normalisation : c'est au
  // consommateur de rapprocher ces libelles de son propre referentiel.
  nom: z.string().nullable(),
  // 0.05 pour 5 %. Souvent absent du recu, qui n'imprime que le montant.
  taux: z.number().min(0).max(1).nullable(),
  montant: MontantSchema,
  confiance: ConfianceSchema,
})

// Tous les champs sont nullables, et c'est le choix central de ce contrat : une photo froissee
// peut ne livrer qu'un total. Rendre une facture partielle vaut mieux que refuser la requete,
// le consommateur sait completer ce qui manque.
export const FactureSchema = z.object({
  marchand: extrait(z.string()).nullable(),
  date: extrait(z.iso.date()).nullable(),
  // Code ISO 4217 en majuscules (« CAD », « USD »).
  devise: extrait(z.string().length(3)).nullable(),
  sousTotal: extrait(MontantSchema).nullable(),
  taxes: z.array(TaxeSchema),
  total: extrait(MontantSchema).nullable(),
  articles: z.array(ArticleSchema),
})

export type Article = z.infer<typeof ArticleSchema>
export type Taxe = z.infer<typeof TaxeSchema>
export type Facture = z.infer<typeof FactureSchema>

// La facture qu'on rend quand rien n'a pu etre reconnu. Nommee ici plutot que reconstruite a
// chaque endroit qui en a besoin : elle est la forme de reference du contrat.
export const FACTURE_VIDE: Facture = {
  marchand: null,
  date: null,
  devise: null,
  sousTotal: null,
  taxes: [],
  total: null,
  articles: [],
}
