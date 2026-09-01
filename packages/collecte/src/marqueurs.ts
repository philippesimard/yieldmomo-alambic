// Les mots qui annoncent les montants de pied de ticket. Partages entre le moteur factice
// (qui les etiquette) et la reconstruction (qui s'en sert en repli quand le modele n'a rien
// etiquete) : les deux chemins doivent reconnaitre les memes lignes.

// Ce qui designe le total. « total » d'abord, le plus sur ; les recus de terminal de paiement
// n'ecrivent pas « total » mais « MONTANT $17.00 », d'ou le second palier.
export const MARQUEURS_TOTAL = ['total'] as const
export const MARQUEURS_MONTANT = ['montant', 'amount'] as const

// Ecarte les lignes qui contiennent « total » sans etre LE total. Sans ce filtre, un
// sous-total imprime au-dessus ecraserait le vrai montant, puisqu'on garde la derniere
// correspondance.
export const MARQUEURS_ECARTES = ['sous', 'sub'] as const

// Ce qui designe le sous-total, dans toutes ses graphies imprimees.
export const MARQUEURS_SOUS_TOTAL = [
  'sous-total',
  'sous total',
  'soustotal',
  'subtotal',
  'sub-total',
  'sub total',
] as const
