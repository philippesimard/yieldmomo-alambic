import { CODE_ERREUR, ErreurAlambic, type ImageChauffee } from '@alambic/noyau'
import { z } from 'zod'
import { interpreterEtiquette, type MotEtiquete } from './etiquettes'
import type { MoteurEtiquetage } from './moteur'
import { boiteNormalisee, type Mot } from './mots'
import { SIDECAR_LAYOUTLM } from './sidecar'

// La reponse du sidecar traverse une frontiere http : on la valide comme telle au lieu de lui
// faire confiance sur sa forme.
const ReponseEtiquetageSchema = z.object({
  etiquettes: z.array(z.object({ etiquette: z.string(), score: z.number() })),
})

type EtiquetteBrute = z.infer<typeof ReponseEtiquetageSchema>['etiquettes'][number]

const NOM_MOTEUR_LAYOUTLM = 'layoutlmv3'

export type OptionsMoteurLayoutlm = {
  url: string
  delaiMs: number
}

// Fabrique et non singleton : l'url et le delai viennent de la configuration, que seule l'api
// a le droit de lire. Construire le moteur n'ouvre aucune connexion.
export function creerMoteurLayoutlm(options: OptionsMoteurLayoutlm): MoteurEtiquetage {
  return {
    nom: NOM_MOTEUR_LAYOUTLM,
    etiqueter: (mots, image) => etiqueter(mots, image, options),
  }
}

async function etiqueter(
  mots: readonly Mot[],
  image: ImageChauffee,
  options: OptionsMoteurLayoutlm,
): Promise<MotEtiquete[]> {
  if (mots.length === 0) return []

  const corps = JSON.stringify({
    image: image.contenu.toString('base64'),
    mots: mots.map((mot) => ({
      texte: mot.texte,
      boite: boiteNormalisee(mot.cadre, image.largeur, image.hauteur),
    })),
  })

  let reponse: Response
  try {
    reponse = await fetch(`${options.url}${SIDECAR_LAYOUTLM.routeEtiquetage}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: corps,
      signal: AbortSignal.timeout(options.delaiMs),
    })
  } catch (erreur) {
    // `collecter` n'a pas de filet : rien ne doit sortir d'ici sans etre une ErreurAlambic.
    if (
      erreur instanceof Error &&
      (erreur.name === 'TimeoutError' || erreur.name === 'AbortError')
    ) {
      throw new ErreurAlambic(
        CODE_ERREUR.delaiDepasse,
        504,
        "Le moteur d'etiquetage n'a pas repondu a temps.",
        erreur,
      )
    }
    throw new ErreurAlambic(
      CODE_ERREUR.moteurIndisponible,
      503,
      "Le moteur d'etiquetage est indisponible.",
      erreur,
    )
  }

  if (!reponse.ok) {
    throw new ErreurAlambic(
      CODE_ERREUR.erreurInterne,
      500,
      `Le moteur d'etiquetage a repondu avec le statut ${reponse.status}.`,
    )
  }

  let json: unknown
  try {
    json = await reponse.json()
  } catch (erreur) {
    throw new ErreurAlambic(
      CODE_ERREUR.erreurInterne,
      500,
      "La reponse du moteur d'etiquetage n'est pas du json.",
      erreur,
    )
  }

  const resultat = ReponseEtiquetageSchema.safeParse(json)
  if (!resultat.success) {
    throw new ErreurAlambic(
      CODE_ERREUR.erreurInterne,
      500,
      "La reponse du moteur d'etiquetage n'a pas la forme attendue.",
      resultat.error,
    )
  }

  // L'alignement du protocole est par indice : une longueur differente signifie que le sidecar
  // a perdu ou invente des mots, et plus rien n'est fiable.
  if (resultat.data.etiquettes.length !== mots.length) {
    throw new ErreurAlambic(
      CODE_ERREUR.erreurInterne,
      500,
      "Le moteur d'etiquetage n'a pas rendu une etiquette par mot.",
    )
  }

  return mots.map((mot, indice) => normaliser(mot, resultat.data.etiquettes[indice]))
}

function normaliser(mot: Mot, brute: EtiquetteBrute | undefined): MotEtiquete {
  if (brute === undefined) {
    // Jamais atteint : les longueurs sont verifiees en amont. Le garde satisfait l'acces
    // indexe strict sans assertion.
    throw new ErreurAlambic(
      CODE_ERREUR.erreurInterne,
      500,
      "Etiquette manquante dans la reponse du moteur d'etiquetage.",
    )
  }
  const { etiquette, debut } = interpreterEtiquette(brute.etiquette)
  return { ...mot, etiquette, debut, score: Math.min(1, Math.max(0, brute.score)) }
}
