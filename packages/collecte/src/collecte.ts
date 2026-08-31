import {
  type BlocTexte,
  type Condensat,
  FACTURE_VIDE,
  type Facture,
  GENRE_APERCU,
  grouperEnLignes,
  STATUT_ETAPE,
  type Traceur,
} from '@alambic/noyau'
import { montantDe } from './montant'

// Ce qui designe le total sur un recu. Volontairement court : le squelette ne reconnait que ce
// champ, et l'elargir sans corpus de mesure serait deviner.
const MARQUEURS_TOTAL = ['total', 'montant du'] as const

// Ecarte les lignes qui contiennent « total » sans etre LE total. Sans ce filtre, un
// sous-total imprime au-dessus ecraserait le vrai montant, puisqu'on garde la derniere
// correspondance.
const MARQUEURS_ECARTES = ['sous', 'sub'] as const

const SOUS_ETAPE = {
  groupementLignes: 'groupement_lignes',
  reconnaissanceTotal: 'reconnaissance_total',
} as const

export const SOUS_ETAPES_COLLECTE = [
  SOUS_ETAPE.groupementLignes,
  SOUS_ETAPE.reconnaissanceTotal,
] as const

type Reconnaissance = {
  total: Facture['total']
  ligneRetenue: string | null
  marqueur: string | null
}

// Interprete le condensat en facture. Fonction pure et synchrone : memes entrees, memes
// resultats, aucune entree-sortie. C'est ce qui la rendra verifiable isolement, sans image ni
// moteur ocr, le jour ou la reconnaissance sera ecrite pour de bon.
//
// Le squelette ne reconnait que le total. La date, le marchand, les taxes et les articles
// viendront a leur tour ; le contrat les prevoit deja, tous nullables.
export function collecter(condensat: Condensat, traceur?: Traceur): Facture {
  const finGroupement = traceur?.demarrer(SOUS_ETAPE.groupementLignes)
  const lignes = grouperEnLignes(condensat.blocs)
  finGroupement?.({
    statut: STATUT_ETAPE.reussi,
    apercus: [
      {
        genre: GENRE_APERCU.donnees,
        valeur: {
          lignes: lignes.length,
          blocs: condensat.blocs.length,
          contenu: lignes.map((ligne) => ligne.map((bloc) => bloc.texte).join('  ')),
        },
      },
    ],
  })

  const finTotal = traceur?.demarrer(SOUS_ETAPE.reconnaissanceTotal)
  const reconnaissance = reconnaitreTotal(lignes)
  const facture: Facture = { ...FACTURE_VIDE, total: reconnaissance.total }

  const nuls = champsNuls(facture)
  finTotal?.({
    statut: nuls.length === 0 ? STATUT_ETAPE.reussi : STATUT_ETAPE.degrade,
    motif:
      nuls.length === 0
        ? undefined
        : `Champs non reconnus : ${nuls.join(', ')}. Le contrat les prévoit nullables, la facture rendue reste partielle.`,
    apercus: [
      {
        genre: GENRE_APERCU.donnees,
        valeur: {
          ligneRetenue: reconnaissance.ligneRetenue,
          marqueur: reconnaissance.marqueur,
          montant: reconnaissance.total?.valeur ?? null,
          confiance: reconnaissance.total?.confiance ?? null,
          marqueursCherches: MARQUEURS_TOTAL,
          champsNuls: nuls,
        },
      },
    ],
  })

  return facture
}

// Les champs qu'on n'a pas su remplir, lus sur la facture elle-meme plutot qu'enumeres a la
// main : le jour ou le contrat gagne un champ, ce decompte le suit sans etre touche.
function champsNuls(facture: Facture): string[] {
  return Object.entries(facture)
    .filter(([, valeur]) => valeur === null || (Array.isArray(valeur) && valeur.length === 0))
    .map(([nom]) => nom)
}

function reconnaitreTotal(lignes: readonly BlocTexte[][]): Reconnaissance {
  // La derniere ligne qui porte un marqueur, pas la premiere : un recu imprime souvent un
  // rappel du total en tete, et c'est le pied de ticket qui fait foi.
  for (const ligne of [...lignes].reverse()) {
    const texte = ligne.map((bloc) => bloc.texte).join(' ')
    const marqueur = marqueurDe(texte)
    if (marqueur === null) continue

    const valeur = montantDe(texte)
    if (valeur === null) continue

    return {
      total: { valeur, confiance: confianceDe(ligne) },
      ligneRetenue: texte,
      marqueur,
    }
  }
  return { total: null, ligneRetenue: null, marqueur: null }
}

function marqueurDe(texte: string): string | null {
  const normalise = texte.toLowerCase()
  if (MARQUEURS_ECARTES.some((marqueur) => normalise.includes(marqueur))) return null
  return MARQUEURS_TOTAL.find((marqueur) => normalise.includes(marqueur)) ?? null
}

// Le maillon faible, et non la moyenne : un total dont le libelle est net mais le montant
// douteux reste un total douteux, et c'est le montant qui compte.
function confianceDe(ligne: readonly BlocTexte[]): number {
  return Math.min(...ligne.map((bloc) => bloc.confiance))
}
