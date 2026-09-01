// Un montant tel qu'il s'imprime sur un recu : « 8,91 », « 1 234,56 », « $12.00 », « -2,50 »
// pour un rabais, « $10.2 » quand l'ocr mange le dernier zero. La partie decimale (une ou
// deux) est EXIGEE : c'est ce qui distingue un montant d'un numero de telephone
// (418-527-9444), d'une heure (18:53:03), d'un numero de carte ou d'un taux (« 9,975% »,
// trois decimales, rejete aussi). Un total imprime sans cents est perdu — rarissime, et bien
// moins couteux que les montants fantomes qu'un filet plus lache laissait passer.
//
// Le signe moins ne compte que s'il n'est pas colle a un chiffre : celui de « 4834-8741 » est
// un trait d'union, celui de « -2,50 » un vrai signe. L'espace tolere apres le separateur :
// l'ocr lit souvent « 38, 23 » pour « 38,23 ».
const MONTANT = /(?<![\d-])-?\d{1,3}(?:\s?\d{3})*[.,]\s?\d{1,2}(?!\d)/g

// Le DERNIER nombre de la ligne, parce que c'est la que se trouve le montant sur un recu :
// « TPS 5% 0,39 » doit rendre 0,39 et non 5.
export function montantDe(texte: string): number | null {
  const dernier = texte.match(MONTANT)?.at(-1)
  if (dernier === undefined) return null

  const valeur = Number(dernier.replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(valeur) ? valeur : null
}
