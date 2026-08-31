import { type Apercu, CODE_ERREUR, ErreurAlambic } from '@alambic/noyau'
import sharp, { type Sharp } from 'sharp'

// L'image circule d'une sous-etape a l'autre en pixels bruts, un seul canal, jamais reencodee :
// un aller-retour png entre chaque passe couterait plus cher que tout le traitement reuni, et
// un aller-retour jpeg abimerait justement ce que la Chauffe essaie de preserver.
export type Etat = {
  pixels: Buffer
  largeur: number
  hauteur: number
}

// Ce qu'une sous-etape rend.
//
// `motif` present vaut degrade : la sous-etape n'a pas pu faire son travail mais laisse passer
// l'image plutot que de bloquer la distillation.
//
// `apercus` est une fonction et non un tableau : sans traceur elle n'est jamais appelee, donc
// le chemin de production ne fabrique aucune vignette.
//
// `note` est le sous-score de qualite, absent quand la sous-etape n'a rien a dire de la
// lisibilite du resultat.
export type Sortie<T> = {
  valeur: T
  motif?: string
  note?: number
  apercus?: () => Promise<Apercu[]>
}

// La meme image, mais en couleur. Elle ne sert qu'a UNE chose : trouver le document. Dans le
// contexte d'Alambic, ce qu'on cherche est toujours un objet clair et PEU SATURE dans un decor
// quelconque, et la saturation est le discriminant le plus sur entre du papier et une main, du
// bois, un ciel. Trois canaux entrelaces, srgb.
export type EtatCouleur = {
  pixels: Buffer
  largeur: number
  hauteur: number
}

export const BLANC = '#ffffff'

export const CANAUX_COULEUR = 3

export function depuis(etat: Etat): Sharp {
  return sharp(etat.pixels, {
    raw: { width: etat.largeur, height: etat.hauteur, channels: 1 },
  })
}

// `toColourspace` n'est pas decoratif : sur une entree raw a un canal, sharp rend par defaut
// trois canaux en sortie raw. Sans cette ligne, chaque sous-etape rendrait un tampon trois fois
// trop long que la suivante relirait decale, et l'image se desagregerait sans qu'aucune erreur
// ne soit levee.
export async function enEtat(source: Sharp): Promise<Etat> {
  const { data, info } = await source
    .toColourspace('b-w')
    .raw()
    .toBuffer({ resolveWithObject: true })

  if (info.channels !== 1) {
    throw new ErreurAlambic(
      CODE_ERREUR.erreurInterne,
      500,
      `La Chauffe attend un seul canal, sharp en a rendu ${info.channels}.`,
    )
  }

  return { pixels: data, largeur: info.width, hauteur: info.height }
}

export function couleurDepuis(etat: EtatCouleur): Sharp {
  return sharp(etat.pixels, {
    raw: { width: etat.largeur, height: etat.hauteur, channels: CANAUX_COULEUR },
  })
}

// Le pendant couleur de `enEtat`. `removeAlpha` avant `toColourspace` : sans lui, un png
// transparent rendrait quatre canaux la ou la segmentation en attend trois.
export async function enEtatCouleur(source: Sharp): Promise<EtatCouleur> {
  const { data, info } = await source
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })

  if (info.channels !== CANAUX_COULEUR) {
    throw new ErreurAlambic(
      CODE_ERREUR.erreurInterne,
      500,
      `La segmentation attend ${CANAUX_COULEUR} canaux, sharp en a rendu ${info.channels}.`,
    )
  }

  return { pixels: data, largeur: info.width, hauteur: info.height }
}

// Une copie reduite de l'etat, en pixels bruts. Les sous-etapes qui ne font que MESURER
// travaillent dessus : mesurer sur la pleine resolution couterait dix fois plus pour une
// reponse identique.
export function reduire(etat: Etat, largeur: number): Promise<Etat> {
  return enEtat(depuis(etat).resize({ width: largeur, withoutEnlargement: true }))
}

// `noUncheckedIndexedAccess` type tout acces indexe en `number | undefined`. Toutes les boucles
// de ce package sont bornees par les dimensions du tampon qu'elles parcourent : l'acces est
// toujours dans les bornes, et le `?? 0` n'existe que pour le compilateur. Passer par une
// fonction plutot que de repeter l'idiome garde les boucles de calcul lisibles.
export const lire = (tampon: Uint8Array, indice: number): number => tampon[indice] ?? 0
