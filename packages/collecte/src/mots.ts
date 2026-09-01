import type { BlocTexte, Cadre } from '@alambic/noyau'

// Un mot decoupe d'un bloc ocr. Structurellement un BlocTexte : grouperEnLignes et tout ce qui
// lit la geometrie s'appliquent sans conversion. `indexBloc` garde le lien vers le bloc
// d'origine, dont la confiance ocr pondere celle des entites reconstruites.
export type Mot = BlocTexte & { indexBloc: number }

// L'echelle de LayoutLM : le modele quantifie chaque boite sur une grille de 0 a 1000, quelle
// que soit la taille de l'image.
const ECHELLE_BOITE = 1000

export type BoiteNormalisee = [number, number, number, number]

const MOT = /\S+/g

// Le modele attend un mot par boite, mais PaddleOCR rend des lignes : chaque bloc est scinde
// sur les espaces et son cadre reparti au prorata des caracteres. Approximatif (police non
// monospace), mais le modele quantifie deja les positions : la precision au pixel ne compte
// pas.
export function decouperEnMots(blocs: readonly BlocTexte[]): Mot[] {
  const mots: Mot[] = []
  for (const [indexBloc, bloc] of blocs.entries()) {
    const caracteres = bloc.texte.length
    if (caracteres === 0) continue
    for (const correspondance of bloc.texte.matchAll(MOT)) {
      mots.push({
        texte: correspondance[0],
        cadre: {
          x: Math.round(bloc.cadre.x + (bloc.cadre.largeur * correspondance.index) / caracteres),
          y: bloc.cadre.y,
          largeur: Math.max(
            1,
            Math.round((bloc.cadre.largeur * correspondance[0].length) / caracteres),
          ),
          hauteur: bloc.cadre.hauteur,
        },
        confiance: bloc.confiance,
        indexBloc,
      })
    }
  }
  return mots
}

// Le processor exige des boites croissantes dans [0, 1000] : un cadre au bord de l'image ou
// degenere est ramene dans la grille puis etire d'un cran.
export function boiteNormalisee(cadre: Cadre, largeur: number, hauteur: number): BoiteNormalisee {
  const x0 = Math.min(borner((cadre.x * ECHELLE_BOITE) / largeur), ECHELLE_BOITE - 1)
  const y0 = Math.min(borner((cadre.y * ECHELLE_BOITE) / hauteur), ECHELLE_BOITE - 1)
  const x1 = Math.max(borner(((cadre.x + cadre.largeur) * ECHELLE_BOITE) / largeur), x0 + 1)
  const y1 = Math.max(borner(((cadre.y + cadre.hauteur) * ECHELLE_BOITE) / hauteur), y0 + 1)
  return [x0, y0, x1, y1]
}

function borner(valeur: number): number {
  return Math.min(ECHELLE_BOITE, Math.max(0, Math.round(valeur)))
}
