import { CODE_ERREUR, ErreurAlambic } from '@alambic/noyau'
import { apercusDe } from './apercus'
import { depuis, type Etat, enEtat, lire, type Sortie } from './etat'

// On refloute l'image et on regarde ce qu'elle perd. Une image nette perd beaucoup de ses
// variations locales ; une image deja floue n'en perd presque rien, parce qu'il n'y reste rien
// a perdre.
//
// Pourquoi pas la variance du laplacien, la mesure habituelle : elle est dominee par le bruit
// de capteur. Mesure sur un texte rendu illisible par un flou, elle donne 6 sur une image
// propre et 580 avec un bruit d'ecart-type 6 — soit vingt-neuf fois le seuil de refus, et un
// meilleur score qu'une image nette. Sur de vraies photos d'interieur, elle mesure le bruit et
// non la nettete.
//
// Le pre-lissage est ce qui rend celle-ci robuste : il coupe la bande de frequences ou vit le
// bruit sans toucher a un trait de caractere. Avec lui, l'ecart entre une meme image avec et
// sans bruit tombe sous 0,04.
const PRE_LISSAGE = 2
const REFLOU = 2

// Cales sur le corpus de vraies photos, et non sur de la synthese : les treize photos lisibles
// s'etalent de 0,148 a 0,292, la seule franchement bougee tombe a 0,055. Le refus se place
// entre les deux, plus pres du bas : a 0,17 il rejetterait un recu froisse parfaitement net
// dont le score est bas parce qu'il porte surtout un QR code et de larges aplats de papier.
//
// La lecon vaut d'etre retenue : sur des images synthetiques, ce meme seuil semblait devoir
// etre place a 0,17. Les vraies photos ont une plage de scores bien plus resserree.
const SCORE_REFUSE = 0.1
const SCORE_NET = 0.25

export async function mesurerNettete(etat: Etat): Promise<Sortie<Etat>> {
  const score = await scoreNettete(etat)

  if (score < SCORE_REFUSE) {
    throw new ErreurAlambic(
      CODE_ERREUR.imageTropFloue,
      422,
      "L'image est trop floue pour être lue, reprendre la photo.",
    )
  }

  return {
    valeur: etat,
    note: Math.min(1, score / SCORE_NET),
    apercus: apercusDe(etat, {
      score: Math.round(score * 1000) / 1000,
      seuilRefus: SCORE_REFUSE,
      seuilNet: SCORE_NET,
      mesureSur: [etat.largeur, etat.hauteur],
    }),
  }
}

// La mesure porte sur l'image telle que l'ocr la recevra : deja reduite, deja cadree. C'est la
// bonne echelle et la seule qui compte — un flou de quatre pixels sur une photo de 4000 px n'en
// fait plus que deux une fois ramenee a 2000, et c'est ce flou-la que l'ocr subira.
async function scoreNettete(etat: Etat): Promise<number> {
  const lisse = await enEtat(depuis(etat).blur(PRE_LISSAGE))
  const reflou = await enEtat(depuis(lisse).blur(REFLOU))

  let variationsAvant = 0
  let variationsApres = 0

  for (let y = 1; y < etat.hauteur; y += 1) {
    const ligne = y * etat.largeur
    for (let x = 1; x < etat.largeur; x += 1) {
      const i = ligne + x
      variationsAvant +=
        Math.abs(lire(lisse.pixels, i) - lire(lisse.pixels, i - 1)) +
        Math.abs(lire(lisse.pixels, i) - lire(lisse.pixels, i - etat.largeur))
      variationsApres +=
        Math.abs(lire(reflou.pixels, i) - lire(reflou.pixels, i - 1)) +
        Math.abs(lire(reflou.pixels, i) - lire(reflou.pixels, i - etat.largeur))
    }
  }

  // Un rapport et non une difference : le score ne depend alors ni du contraste de la photo ni
  // de sa taille, seulement de la franchise de ses transitions.
  return variationsAvant === 0 ? 0 : (variationsAvant - variationsApres) / variationsAvant
}
