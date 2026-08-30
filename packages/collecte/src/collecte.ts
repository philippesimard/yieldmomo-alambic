import {
  type BlocTexte,
  type Condensat,
  FACTURE_VIDE,
  type Facture,
  grouperEnLignes,
} from '@alambic/noyau'
import { montantDe } from './montant'

// Ce qui designe le total sur un recu. Volontairement court : le squelette ne reconnait que ce
// champ, et l'elargir sans corpus de mesure serait deviner.
const MARQUEURS_TOTAL = ['total', 'montant du'] as const

// Ecarte les lignes qui contiennent « total » sans etre LE total. Sans ce filtre, un
// sous-total imprime au-dessus ecraserait le vrai montant, puisqu'on garde la derniere
// correspondance.
const MARQUEURS_ECARTES = ['sous', 'sub'] as const

// Interprete le condensat en facture. Fonction pure et synchrone : memes entrees, memes
// resultats, aucune entree-sortie. C'est ce qui la rendra verifiable isolement, sans image ni
// moteur ocr, le jour ou la reconnaissance sera ecrite pour de bon.
//
// Le squelette ne reconnait que le total. La date, le marchand, les taxes et les articles
// viendront a leur tour ; le contrat les prevoit deja, tous nullables.
export function collecter(condensat: Condensat): Facture {
  const lignes = grouperEnLignes(condensat.blocs)

  return { ...FACTURE_VIDE, total: totalDe(lignes) }
}

function totalDe(lignes: readonly BlocTexte[][]): Facture['total'] {
  // La derniere ligne qui porte un marqueur, pas la premiere : un recu imprime souvent un
  // rappel du total en tete, et c'est le pied de ticket qui fait foi.
  for (const ligne of [...lignes].reverse()) {
    const texte = ligne.map((bloc) => bloc.texte).join(' ')
    if (!estLigneDeTotal(texte)) continue

    const valeur = montantDe(texte)
    if (valeur === null) continue

    return { valeur, confiance: confianceDe(ligne) }
  }
  return null
}

function estLigneDeTotal(texte: string): boolean {
  const normalise = texte.toLowerCase()
  if (MARQUEURS_ECARTES.some((marqueur) => normalise.includes(marqueur))) return false
  return MARQUEURS_TOTAL.some((marqueur) => normalise.includes(marqueur))
}

// Le maillon faible, et non la moyenne : un total dont le libelle est net mais le montant
// douteux reste un total douteux, et c'est le montant qui compte.
function confianceDe(ligne: readonly BlocTexte[]): number {
  return Math.min(...ligne.map((bloc) => bloc.confiance))
}
