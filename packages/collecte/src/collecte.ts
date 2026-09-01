import {
  type Condensat,
  type Facture,
  GENRE_APERCU,
  grouperEnLignes,
  type ImageChauffee,
  STATUT_ETAPE,
  type Traceur,
} from '@alambic/noyau'
import { ETIQUETTE, epurer, type MotEtiquete } from './etiquettes'
import type { MoteurEtiquetage } from './moteur'
import { decouperEnMots } from './mots'
import { reconnaitreCarte } from './reconnaisseurs/carte'
import { reconnaitreDate } from './reconnaisseurs/date'
import { reconnaitreDevise } from './reconnaisseurs/devise'
import { reconnaitreMarchand } from './reconnaisseurs/marchand'
import { extraireEntites, reconstruire } from './reconstruction'

const SOUS_ETAPE = {
  decoupageMots: 'decoupage_mots',
  etiquetage: 'etiquetage',
  reconstruction: 'reconstruction',
  reconnaisseurs: 'reconnaisseurs',
} as const

export const SOUS_ETAPES_COLLECTE = [
  SOUS_ETAPE.decoupageMots,
  SOUS_ETAPE.etiquetage,
  SOUS_ETAPE.reconstruction,
  SOUS_ETAPE.reconnaisseurs,
] as const

// Interprete le condensat en facture. Le moteur d'etiquetage est injecte et jamais choisi
// ici ; la reconstruction et les reconnaisseurs restent purs et deterministes, exerces a
// l'identique par tous les moteurs. L'image accompagne le condensat parce que le modele lit
// aussi les pixels — et c'est elle qui porte les dimensions que la normalisation des boites
// demande.
export async function collecter(
  condensat: Condensat,
  image: ImageChauffee,
  moteur: MoteurEtiquetage,
  traceur?: Traceur,
): Promise<Facture> {
  const finDecoupage = traceur?.demarrer(SOUS_ETAPE.decoupageMots)
  const mots = decouperEnMots(condensat.blocs)
  finDecoupage?.({
    statut: STATUT_ETAPE.reussi,
    apercus: [
      { genre: GENRE_APERCU.donnees, valeur: { blocs: condensat.blocs.length, mots: mots.length } },
    ],
  })

  const finEtiquetage = traceur?.demarrer(SOUS_ETAPE.etiquetage)
  const etiquetes = epurer(await moteur.etiqueter(mots, image))
  const reconnus = etiquetes.filter((mot) => mot.etiquette !== ETIQUETTE.exterieur)
  finEtiquetage?.({
    statut: STATUT_ETAPE.reussi,
    apercus: [
      {
        genre: GENRE_APERCU.cadres,
        cadres: reconnus.map((mot) => ({
          cadre: mot.cadre,
          texte: `${mot.texte} → ${mot.etiquette}`,
          confiance: mot.score,
        })),
        largeur: image.largeur,
        hauteur: image.hauteur,
      },
      {
        genre: GENRE_APERCU.donnees,
        valeur: { moteur: moteur.nom, etiquetes: repartition(reconnus) },
      },
    ],
  })

  const finReconstruction = traceur?.demarrer(SOUS_ETAPE.reconstruction)
  const lignesMots = grouperEnLignes(etiquetes)
  const entites = extraireEntites(etiquetes)
  const montants = reconstruire(entites, lignesMots)
  finReconstruction?.({
    statut: STATUT_ETAPE.reussi,
    apercus: [
      {
        genre: GENRE_APERCU.donnees,
        // Les tableaux entiers, pas leurs comptes : c'est dans cet apercu qu'on juge une
        // reconstruction, article par article.
        valeur: {
          entites: entites.map((entite) => `${entite.etiquette} : ${entite.texte}`),
          sousTotal: montants.sousTotal?.valeur ?? null,
          total: montants.total?.valeur ?? null,
          taxes: montants.taxes,
          articles: montants.articles,
        },
      },
    ],
  })

  const finReconnaisseurs = traceur?.demarrer(SOUS_ETAPE.reconnaisseurs)
  const lignesBlocs = grouperEnLignes(condensat.blocs)
  const facture: Facture = {
    marchand: reconnaitreMarchand(lignesBlocs),
    date: reconnaitreDate(lignesBlocs),
    devise: reconnaitreDevise(lignesBlocs),
    sousTotal: montants.sousTotal,
    taxes: montants.taxes,
    total: montants.total,
    carte: reconnaitreCarte(lignesBlocs),
    articles: montants.articles,
  }
  const nuls = champsNuls(facture)
  finReconnaisseurs?.({
    statut: nuls.length === 0 ? STATUT_ETAPE.reussi : STATUT_ETAPE.degrade,
    motif:
      nuls.length === 0
        ? undefined
        : `Champs non reconnus : ${nuls.join(', ')}. Le contrat les prévoit nullables, la facture rendue reste partielle.`,
    apercus: [
      {
        genre: GENRE_APERCU.donnees,
        valeur: {
          marchand: facture.marchand?.valeur ?? null,
          date: facture.date?.valeur ?? null,
          devise: facture.devise?.valeur ?? null,
          carte: facture.carte?.valeur ?? null,
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

function repartition(mots: readonly MotEtiquete[]): Record<string, number> {
  const comptes: Record<string, number> = {}
  for (const mot of mots) {
    comptes[mot.etiquette] = (comptes[mot.etiquette] ?? 0) + 1
  }
  return comptes
}
