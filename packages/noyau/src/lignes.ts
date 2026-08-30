import type { BlocTexte, Cadre } from './condensat'

// Part de la hauteur du plus petit fragment qu'il faut recouvrir pour etre juge sur la meme
// ligne. La moitie : assez tolerant pour un montant en gras a cote d'un libelle fin, assez
// strict pour ne pas fusionner deux lignes serrees d'un recu thermique.
const PART_RECOUVREMENT = 0.5

// Regroupe des fragments en lignes, de haut en bas, puis de gauche a droite dans chaque ligne.
//
// Cette geometrie vit dans le noyau et non dans une etape parce que DEUX etapes en ont besoin
// sans avoir le droit de se connaitre : la Condensation pour donner au condensat son ordre de
// lecture, la Collecte pour rapprocher un libelle de son montant. C'est une lecture du
// contrat, pas un traitement.
export function grouperEnLignes(blocs: readonly BlocTexte[]): BlocTexte[][] {
  const parHaut = [...blocs].sort((a, b) => a.cadre.y - b.cadre.y)
  const lignes: BlocTexte[][] = []

  for (const bloc of parHaut) {
    const courante = lignes.at(-1)
    const premier = courante?.[0]
    if (courante !== undefined && premier !== undefined && memeLigne(premier.cadre, bloc.cadre)) {
      courante.push(bloc)
    } else {
      lignes.push([bloc])
    }
  }

  return lignes.map((ligne) => ligne.sort((a, b) => a.cadre.x - b.cadre.x))
}

// Comparer les bandes verticales et non les seuls centres : un montant en gros caracteres et
// son libelle en petits n'ont pas le meme centre, mais se recouvrent largement.
function memeLigne(a: Cadre, b: Cadre): boolean {
  const recouvrement = Math.min(a.y + a.hauteur, b.y + b.hauteur) - Math.max(a.y, b.y)
  return recouvrement >= Math.min(a.hauteur, b.hauteur) * PART_RECOUVREMENT
}
