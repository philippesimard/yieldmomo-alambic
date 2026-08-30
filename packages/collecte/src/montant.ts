// Un montant tel qu'il s'imprime sur un recu : « 8,91 », « 1 234,56 », « 12.00 ». Le separateur
// de milliers peut etre une espace ordinaire ou insecable, le separateur decimal une virgule
// (Quebec, Europe) ou un point.
const MONTANT = /-?\d[\d\s ]*(?:[.,]\d{1,2})?/g

// Le DERNIER nombre de la ligne, parce que c'est la que se trouve le montant sur un recu :
// « TPS 5% 0,39 » doit rendre 0,39 et non 5.
export function montantDe(texte: string): number | null {
  const dernier = texte.match(MONTANT)?.at(-1)
  if (dernier === undefined) return null

  const valeur = Number(dernier.replace(/[\s ]/g, '').replace(',', '.'))
  return Number.isFinite(valeur) ? valeur : null
}
