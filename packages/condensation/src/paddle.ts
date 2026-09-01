import { type BlocTexte, CODE_ERREUR, ErreurAlambic, type ImageChauffee } from '@alambic/noyau'
import { z } from 'zod'
import type { MoteurOcr } from './moteur'
import { SIDECAR_PADDLE } from './sidecar'

// La reponse du sidecar traverse une frontiere http : on la valide comme telle au lieu de lui
// faire confiance sur sa forme.
const ReponseLectureSchema = z.object({
  blocs: z.array(
    z.object({
      texte: z.string(),
      cadre: z.object({
        x: z.number(),
        y: z.number(),
        largeur: z.number(),
        hauteur: z.number(),
      }),
      confiance: z.number(),
    }),
  ),
})

const NOM_MOTEUR_PADDLE = 'paddleocr'

export type OptionsMoteurPaddle = {
  url: string
  delaiMs: number
}

// Fabrique et non singleton : l'url et le delai viennent de la configuration, que seule l'api
// a le droit de lire. Construire le moteur n'ouvre aucune connexion.
export function creerMoteurPaddle(options: OptionsMoteurPaddle): MoteurOcr {
  return {
    nom: NOM_MOTEUR_PADDLE,
    lire: (image) => lire(image, options),
  }
}

async function lire(image: ImageChauffee, options: OptionsMoteurPaddle): Promise<BlocTexte[]> {
  let reponse: Response
  try {
    reponse = await fetch(`${options.url}${SIDECAR_PADDLE.routeLecture}`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: new Uint8Array(
        image.contenu.buffer,
        image.contenu.byteOffset,
        image.contenu.byteLength,
      ),
      signal: AbortSignal.timeout(options.delaiMs),
    })
  } catch (erreur) {
    // `condenser` n'a pas de filet : rien ne doit sortir d'ici sans etre une ErreurAlambic.
    if (
      erreur instanceof Error &&
      (erreur.name === 'TimeoutError' || erreur.name === 'AbortError')
    ) {
      throw new ErreurAlambic(
        CODE_ERREUR.delaiDepasse,
        504,
        "Le moteur ocr n'a pas repondu a temps.",
        erreur,
      )
    }
    throw new ErreurAlambic(
      CODE_ERREUR.moteurIndisponible,
      503,
      'Le moteur ocr est indisponible.',
      erreur,
    )
  }

  if (!reponse.ok) {
    throw new ErreurAlambic(
      CODE_ERREUR.erreurInterne,
      500,
      `Le moteur ocr a repondu avec le statut ${reponse.status}.`,
    )
  }

  let corps: unknown
  try {
    corps = await reponse.json()
  } catch (erreur) {
    throw new ErreurAlambic(
      CODE_ERREUR.erreurInterne,
      500,
      "La reponse du moteur ocr n'est pas du json.",
      erreur,
    )
  }

  const resultat = ReponseLectureSchema.safeParse(corps)
  if (!resultat.success) {
    throw new ErreurAlambic(
      CODE_ERREUR.erreurInterne,
      500,
      "La reponse du moteur ocr n'a pas la forme attendue.",
      resultat.error,
    )
  }

  return resultat.data.blocs.map(normaliser)
}

// Le contrat des blocs confie la normalisation a l'adaptateur du moteur : confiance ramenee
// dans [0,1], cadre en pixels entiers de l'image chauffee.
function normaliser(bloc: z.infer<typeof ReponseLectureSchema>['blocs'][number]): BlocTexte {
  return {
    texte: bloc.texte,
    cadre: {
      x: Math.round(bloc.cadre.x),
      y: Math.round(bloc.cadre.y),
      largeur: Math.round(bloc.cadre.largeur),
      hauteur: Math.round(bloc.cadre.hauteur),
    },
    confiance: Math.min(1, Math.max(0, bloc.confiance)),
  }
}
