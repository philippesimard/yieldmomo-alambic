import { CODE_ERREUR, FactureSchema, ReponseErreurSchema } from '@alambic/noyau'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { distillerDansAtelier, refusAtelier } from '../atelier/atelier'
import { exigerCle } from '../cle'
import { env } from '../config/env'
import { EVENEMENT } from '../journal'

// Toutes les issues de la route, declarees une fois. Fastify serialise selon le statut, et un
// statut absent de cette table sortirait en json non contraint.
const REPONSES_ERREUR = {
  400: ReponseErreurSchema,
  401: ReponseErreurSchema,
  413: ReponseErreurSchema,
  422: ReponseErreurSchema,
  429: ReponseErreurSchema,
  500: ReponseErreurSchema,
  503: ReponseErreurSchema,
  504: ReponseErreurSchema,
}

// Plus serre que le plafond global : une distillation occupe un ouvrier entier, la ou une
// requete ordinaire ne coute qu'un aller-retour.
const LIMITE_DEBIT = { max: 30, timeWindow: '1 minute' }

// Une liste blanche, et non un prefixe `image/` : les binaires precompiles de sharp embarquent
// librsvg, donc un image/svg+xml n'est pas refuse mais RENDU — une surface de rendu entiere, et
// le vecteur classique d'amplification memoire par <use> imbriques. Ce que la liste laisse
// entrer, c'est ce qu'un appareil photo ou une capture d'ecran produit.
//
// busboy rend deja le type en minuscules et sans parametres (parseParams), la comparaison peut
// donc rester une simple appartenance. `image/jpg` n'est pas standard mais reste courant chez
// certains clients mobiles : le refuser rendrait un 400 incomprehensible.
const TYPES_IMAGE_ACCEPTES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/avif',
  'image/tiff',
])

// Avant l'authentification : verifier un secret pour un service ferme est du travail pour rien,
// et l'etat de maintenance est de toute facon public sur les sondes. Les sondes, elles,
// continuent de repondre — c'est par elles qu'on voit que la maintenance est bien en place.
async function refuserEnMaintenance(_requete: FastifyRequest, reponse: FastifyReply) {
  if (!env.MODE_MAINTENANCE) return

  return reponse.code(503).send({
    code: CODE_ERREUR.maintenance,
    message: 'Le service est en maintenance, reessayez plus tard.',
  })
}

// Apres l'authentification : l'etat de charge de l'atelier ne se divulgue pas a un appelant qui
// n'a pas montre sa cle. Le controle qui fait foi reste dans distillerDansAtelier — celui-ci
// n'existe que pour refuser AVANT d'avoir lu le televersement, la ou l'ancien ordre payait
// quinze megaoctets de corps pour decouvrir ensuite que la file etait pleine.
async function refuserSiSature(_requete: FastifyRequest, reponse: FastifyReply) {
  const refus = refusAtelier()
  if (refus === null) return

  // Le corps n'a pas ete consomme : sans cet en-tete, node draine le televersement entier avant
  // de fermer la socket, ce qui annulerait tout le gain du refus precoce.
  reponse.header('connection', 'close')
  throw refus
}

export const routeDistiller: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/distiller',
    {
      preHandler: [refuserEnMaintenance, exigerCle, refuserSiSature],
      config: { rateLimit: LIMITE_DEBIT },
      // Aucun schema d'entree : le corps est un multipart binaire, que zod ne doit pas voir.
      schema: { response: { 200: FactureSchema, ...REPONSES_ERREUR } },
    },
    async (requete, reponse) => {
      // @fastify/multipart leve un 406 au message anglais quand le corps n'est pas un
      // multipart. Sans ce filet, ce message partirait tel quel chez l'appelant, avec un statut
      // que le schema de reponse ne declare meme pas.
      let fichier: Awaited<ReturnType<typeof requete.file>>
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

      // Avant toute lecture : refuser un pdf ou une archive coute une comparaison de chaine,
      // la laisser entrer coute un ouvrier et une decompression.
      if (!TYPES_IMAGE_ACCEPTES.has(fichier.mimetype)) {
        return reponse.code(400).send({
          code: CODE_ERREUR.formatNonSupporte,
          message: "Le format du fichier n'est pas accepte.",
        })
      }

      let image: Buffer
      try {
        image = await fichier.toBuffer()
      } catch {
        // toBuffer leve au-dela de la limite multipart. Sans ce filet, la reponse serait une
        // erreur non geree en anglais plutot qu'un 413 de la meme forme que les autres.
        return reponse
          .code(413)
          .send({ code: CODE_ERREUR.imageTropLourde, message: 'Image trop lourde.' })
      }

      const { facture, mesures } = await distillerDansAtelier(image)

      // Les mesures vont dans les logs et non dans la reponse : elles servent a surveiller le
      // service, et une etape qui derape doit se voir avant que les temps de reponse ne
      // bougent. Le consommateur, lui, n'en fait rien.
      requete.log.info({ ...mesures, evenement: EVENEMENT.distillation }, 'Distillation')

      return reponse.send(facture)
    },
  )
}
