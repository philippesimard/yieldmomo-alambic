import { apercusDe } from './apercus'
import { BLANC, depuis, type Etat, enEtat, type Sortie } from './etat'

// L'image est binaire a ce stade : le fond vaut exactement 255 et la tolerance ne sert qu'a
// absorber les quelques pixels qu'un median a laisses en bordure.
const TOLERANCE = 10

// La marge n'est pas cosmetique : la plupart des moteurs ocr degradent sur du texte colle au
// bord, faute de contexte autour du premier et du dernier caractere.
const MARGE = 12

// En dessous, le rognage a mange le document au lieu de ses bordures. Le seuil peut rester haut
// parce que le gros du recadrage est deja fait : ici on ne retire qu'une marge blanche.
const AIRE_MINIMALE = 0.5

export async function finir(etat: Etat): Promise<Sortie<Etat>> {
  try {
    const recadre = await enEtat(
      depuis(etat).trim({ background: BLANC, threshold: TOLERANCE, margin: MARGE }),
    )

    const part = (recadre.largeur * recadre.hauteur) / (etat.largeur * etat.hauteur)
    if (part < AIRE_MINIMALE) {
      return {
        valeur: etat,
        motif: `Le rognage ne garderait que ${Math.round(part * 100)} % de l'image : ce ne sont pas des marges qui ont été détectées. L'image passe non recadrée.`,
        apercus: apercusDe(etat, { recadre: false }),
      }
    }

    return {
      valeur: recadre,
      apercus: apercusDe(recadre, {
        recadre: true,
        marge: MARGE,
        avant: [etat.largeur, etat.hauteur],
        apres: [recadre.largeur, recadre.hauteur],
      }),
    }
  } catch {
    // sharp refuse de rogner une image d'une seule teinte : il n'y a alors pas de bordure a
    // retirer, et laisser passer l'image est exactement ce qu'on veut.
    return {
      valeur: etat,
      motif:
        "Aucune bordure à retirer : l'image est d'une seule teinte. L'image passe non recadrée.",
      apercus: apercusDe(etat, { recadre: false }),
    }
  }
}
