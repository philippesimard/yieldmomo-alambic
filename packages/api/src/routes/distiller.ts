import { CODE_ERREUR, FactureSchema, ReponseErreurSchema } from '@alambic/noyau'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { distillerDansAtelier } from '../atelier/atelier'
import { exigerCle } from '../cle'

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

export const routeDistiller: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/distiller',
    {
      preHandler: exigerCle,
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
      if (!fichier.mimetype.startsWith('image/')) {
        return reponse
          .code(400)
          .send({ code: CODE_ERREUR.formatNonSupporte, message: 'Le fichier doit etre une image.' })
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
      requete.log.info(mesures, 'Distillation')

      return reponse.send(facture)
    },
  )
}
