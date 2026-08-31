import { fileURLToPath } from 'node:url'
import {
  CODE_ERREUR,
  ErreurAlambic,
  type EvenementTrace,
  type Mesures,
  type PlanPipeline,
} from '@alambic/noyau'
// Importe pour son type, pas pour son code : c'est l'HOTE qui enregistre @fastify/multipart
// (voir le README), le hublot ne fait que lire le fichier que ce plugin ajoute a la requete.
import type { MultipartFile } from '@fastify/multipart'
import statique from '@fastify/static'
import type { FastifyPluginAsync } from 'fastify'
import { ouvrirFlux } from './flux'

// Ce que rend une distillation, vu d'ici : un produit dont on ignore tout, et son cout. Le
// hublot affiche les cles de ce qu'il recoit ; savoir ce que c'est ne le regarde pas.
export type Issue = {
  produit: unknown
  mesures: Mesures
}

// Tout arrive par options : le hublot ne connait ni le serveur qui le monte, ni les etapes
// qu'il observe. C'est ce qui interdit le cycle de dependance, et ce qui permet d'ajouter une
// etape au pipeline sans toucher une ligne d'ici.
export type OptionsHublot = {
  plan: PlanPipeline
  distiller: (image: Buffer, surEvenement: (evenement: EvenementTrace) => void) => Promise<Issue>
}

const PREFIXE = '/hublot'
const RACINE_PUBLIQUE = fileURLToPath(new URL('../public', import.meta.url))

// Un seul genre d'evenement, discrimine par un champ du json : une seule branche de parsing de
// chaque cote, et pas de noms d'evenements a garder en phase entre serveur et page.
const GENRE = {
  trace: 'trace',
  fin: 'fin',
  echec: 'echec',
} as const

// Le hublot ne compte pas dans la limitation de debit : il tire son plan, ses vignettes et
// relance a volonte, et celui qui developpe une etape n'est pas un attaquant.
const SANS_LIMITE = { rateLimit: false }

export const routesHublot: FastifyPluginAsync<OptionsHublot> = async (app, options) => {
  await app.register(statique, {
    root: RACINE_PUBLIQUE,
    prefix: PREFIXE,
    redirect: true,
  })

  // La page dessine son squelette avant tout televersement : elle a besoin du plan d'abord.
  app.get(`${PREFIXE}/plan`, { config: SANS_LIMITE }, async () => options.plan)

  // POST et non EventSource : il faut televerser une image, et un EventSource ne fait que du
  // GET. Un POST qui rend un flux se lit tres bien cote page, et evite d'inventer un
  // identifiant de session — le service reste sans etat.
  app.post(`${PREFIXE}/distiller`, { config: SANS_LIMITE }, async (requete, reponse) => {
    // Aucun controle de type de fichier ici, contrairement a la route de production : deposer
    // un pdf pour voir OU et COMMENT le pipeline le refuse est un usage legitime du hublot.
    let fichier: MultipartFile | undefined
    try {
      fichier = await requete.file()
    } catch {
      fichier = undefined
    }

    if (fichier === undefined) {
      return reponse.code(400).send({
        code: CODE_ERREUR.requeteInvalide,
        message: 'Le corps doit etre un multipart contenant une image.',
      })
    }

    let image: Buffer
    try {
      image = await fichier.toBuffer()
    } catch {
      return reponse
        .code(413)
        .send({ code: CODE_ERREUR.imageTropLourde, message: 'Image trop lourde.' })
    }

    // Le flux ne s'ouvre qu'une fois la requete jugee recevable : un refus garde ainsi la meme
    // forme que partout ailleurs, et la page n'a pas a lire un echec dans deux formats.
    const flux = ouvrirFlux(reponse)

    try {
      const issue = await options.distiller(image, (evenement) => {
        flux.envoyer({ genre: GENRE.trace, ...evenement })
      })
      flux.envoyer({ genre: GENRE.fin, produit: issue.produit, mesures: issue.mesures })
    } catch (erreur) {
      requete.log.warn({ err: erreur }, 'Distillation observee en echec')
      flux.envoyer({ genre: GENRE.echec, ...aPlat(erreur) })
    }

    flux.fermer()
  })
}

// L'erreur telle que la page l'affichera. Le hublot ne masque rien, contrairement a la route
// de production : il n'est monte qu'en developpement, et le detail est precisement ce qu'on
// vient y chercher.
function aPlat(erreur: unknown): { code: string; statut: number; message: string } {
  const message = erreur instanceof Error ? erreur.message : String(erreur)
  if (erreur instanceof ErreurAlambic) {
    return { code: erreur.code, statut: erreur.statut, message }
  }
  return { code: CODE_ERREUR.erreurInterne, statut: 500, message }
}
