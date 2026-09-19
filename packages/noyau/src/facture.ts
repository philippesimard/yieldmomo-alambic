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

// Reseau de carte normalise, et non le libelle imprime : le consommateur est un programme, il
// teste un code stable. `autre` couvre un contexte carte reconnu sans marque identifiee ;
// comptant ou illisible vaut null.
export const TYPE_CARTE = {
  visa: 'visa',
  mastercard: 'mastercard',
  amex: 'amex',
  interac: 'interac',
  autre: 'autre',
} as const

export type TypeCarte = (typeof TYPE_CARTE)[keyof typeof TYPE_CARTE]

// Nature de la depense. Les valeurs sont exactement les `GroupeCategorie` du catalogue de
// YieldMomo, et les sous-categories ses `CategorieTransaction` : le consommateur rapproche les
// cles telles quelles, sans table de correspondance. Le groupe `revenus` du catalogue est
// absent — une photo de recu est une depense, et garder les categories de revenu ne ferait
// qu'ouvrir la porte aux faux positifs (« VISA » imprime par un terminal deviendrait un
// remboursement de dette).
export const CATEGORIE = {
  logement: 'logement',
  telecom: 'telecom',
  alimentation: 'alimentation',
  transport: 'transport',
  sante: 'sante',
  personnel: 'personnel',
  loisirs: 'loisirs',
  famille: 'famille',
  education: 'education',
  finances: 'finances',
  divers: 'divers',
} as const

export type Categorie = (typeof CATEGORIE)[keyof typeof CATEGORIE]

// Chaque sous-categorie et le groupe dont elle releve. Une seule table plutot que deux enums
// cote a cote : le groupe se deduit de la sous-categorie, jamais l'inverse, et les deux ne
// peuvent donc pas diverger.
export const SOUS_CATEGORIES = {
  loyer: CATEGORIE.logement,
  hypotheque: CATEGORIE.logement,
  'assurance-habitation': CATEGORIE.logement,
  electricite: CATEGORIE.logement,
  chauffage: CATEGORIE.logement,
  'entretien-maison': CATEGORIE.logement,
  'meubles-deco': CATEGORIE.logement,

  internet: CATEGORIE.telecom,
  cellulaire: CATEGORIE.telecom,

  epicerie: CATEGORIE.alimentation,
  restaurant: CATEGORIE.alimentation,
  'livraison-repas': CATEGORIE.alimentation,
  cafe: CATEGORIE.alimentation,
  alcool: CATEGORIE.alimentation,

  vehicule: CATEGORIE.transport,
  essence: CATEGORIE.transport,
  'assurance-auto': CATEGORIE.transport,
  'entretien-vehicule': CATEGORIE.transport,
  stationnement: CATEGORIE.transport,
  'transport-commun': CATEGORIE.transport,
  taxi: CATEGORIE.transport,

  medicaments: CATEGORIE.sante,
  'soins-medicaux': CATEGORIE.sante,
  dentiste: CATEGORIE.sante,
  sport: CATEGORIE.sante,

  vetements: CATEGORIE.personnel,
  'soins-personnels': CATEGORIE.personnel,

  streaming: CATEGORIE.loisirs,
  'jeux-video': CATEGORIE.loisirs,
  sorties: CATEGORIE.loisirs,
  lecture: CATEGORIE.loisirs,
  voyages: CATEGORIE.loisirs,

  'garde-enfants': CATEGORIE.famille,
  animaux: CATEGORIE.famille,
  'cadeaux-offerts': CATEGORIE.famille,
  dons: CATEGORIE.famille,

  scolarite: CATEGORIE.education,
  formation: CATEGORIE.education,

  epargne: CATEGORIE.finances,
  'remboursement-dette': CATEGORIE.finances,
  'frais-bancaires': CATEGORIE.finances,
  impots: CATEGORIE.finances,

  'autre-depense': CATEGORIE.divers,
} as const satisfies Record<string, Categorie>

export type SousCategorie = keyof typeof SOUS_CATEGORIES

// Chaque sous-categorie nommee par elle-meme, pour qu'un reconnaisseur ecrive
// `SOUS_CATEGORIE.restaurant` et non le litteral : une cle renommee casse alors la compilation
// au lieu de ne plus rien reconnaitre. Le type exige toutes les cles, et chacune egale a son nom.
export const SOUS_CATEGORIE = {
  loyer: 'loyer',
  hypotheque: 'hypotheque',
  'assurance-habitation': 'assurance-habitation',
  electricite: 'electricite',
  chauffage: 'chauffage',
  'entretien-maison': 'entretien-maison',
  'meubles-deco': 'meubles-deco',
  internet: 'internet',
  cellulaire: 'cellulaire',
  epicerie: 'epicerie',
  restaurant: 'restaurant',
  'livraison-repas': 'livraison-repas',
  cafe: 'cafe',
  alcool: 'alcool',
  vehicule: 'vehicule',
  essence: 'essence',
  'assurance-auto': 'assurance-auto',
  'entretien-vehicule': 'entretien-vehicule',
  stationnement: 'stationnement',
  'transport-commun': 'transport-commun',
  taxi: 'taxi',
  medicaments: 'medicaments',
  'soins-medicaux': 'soins-medicaux',
  dentiste: 'dentiste',
  sport: 'sport',
  vetements: 'vetements',
  'soins-personnels': 'soins-personnels',
  streaming: 'streaming',
  'jeux-video': 'jeux-video',
  sorties: 'sorties',
  lecture: 'lecture',
  voyages: 'voyages',
  'garde-enfants': 'garde-enfants',
  animaux: 'animaux',
  'cadeaux-offerts': 'cadeaux-offerts',
  dons: 'dons',
  scolarite: 'scolarite',
  formation: 'formation',
  epargne: 'epargne',
  'remboursement-dette': 'remboursement-dette',
  'frais-bancaires': 'frais-bancaires',
  impots: 'impots',
  'autre-depense': 'autre-depense',
} as const satisfies { [Cle in SousCategorie]: Cle }

export const SousCategorieSchema = z.enum(SOUS_CATEGORIE)

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
  carte: extrait(z.enum(TYPE_CARTE)).nullable(),
  articles: z.array(ArticleSchema),
  // Les deux champs sont nullables separement, et l'invariant ne va que dans un sens : une
  // sousCategorie implique sa categorie (SOUS_CATEGORIES[sousCategorie] === categorie.valeur),
  // la reciproque est fausse. Un recu peut designer son groupe sans lever l'ambiguite en
  // dessous — « TIM HORTONS » est de l'alimentation, sans qu'on sache dire restaurant ou cafe.
  // Rendre le groupe seul vaut mieux que tout perdre.
  categorie: extrait(z.enum(CATEGORIE)).nullable(),
  sousCategorie: extrait(SousCategorieSchema).nullable(),
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
  carte: null,
  articles: [],
  categorie: null,
  sousCategorie: null,
}
