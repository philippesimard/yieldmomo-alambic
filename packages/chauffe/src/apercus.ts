import { type Apercu, GENRE_APERCU } from '@alambic/noyau'
import { depuis, type Etat } from './etat'

// Assez grand pour juger un seuillage a l'oeil, assez petit pour qu'une dizaine de vignettes
// voyagent en base64 sans alourdir le flux.
const LARGEUR_VIGNETTE = 800

// La vignette est reduite, mais l'apercu porte les dimensions REELLES de l'image a ce stade :
// c'est d'elles qu'un lecteur a besoin pour poser des cadres en pourcentage.
export async function vignette(etat: Etat): Promise<Apercu> {
  const png = await depuis(etat)
    .resize({ width: LARGEUR_VIGNETTE, withoutEnlargement: true })
    .png()
    .toBuffer()
  return { genre: GENRE_APERCU.image, png, largeur: etat.largeur, hauteur: etat.hauteur }
}

export function donnees(valeur: unknown): Apercu {
  return { genre: GENRE_APERCU.donnees, valeur }
}

// Le duo que rend presque toute sous-etape : l'image obtenue, et de quoi comprendre comment.
export function apercusDe(etat: Etat, valeur: unknown): () => Promise<Apercu[]> {
  return async () => [await vignette(etat), donnees(valeur)]
}
