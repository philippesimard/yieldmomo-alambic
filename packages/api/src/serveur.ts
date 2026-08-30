import { CODE_ERREUR, ErreurAlambic } from '@alambic/noyau'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import limiteDebit from '@fastify/rate-limit'
import Fastify, { type FastifyError } from 'fastify'
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { env } from './config/env'
import { journal } from './journal'
import { routeDistiller } from './routes/distiller'
import { routeSante } from './routes/sante'

// Filet global contre le martelage. La route de distillation resserre la maille par-dessus.
const LIMITE_GLOBALE = { max: 100, timeWindow: '1 minute' }

export function construireServeur() {
  const app = Fastify({
    // L'instance pino partagee (voir journal.ts) : le meme pipeline sert aussi l'atelier.
    loggerInstance: journal,
    // Anti-slowloris. 60 s et non 15 : ce delai couvre la RECEPTION de la requete, et une
    // photo de plusieurs megaoctets televersee depuis un lien mobile lent depasse 15 s, donc
    // serait coupee avant meme d'atteindre le gestionnaire.
    requestTimeout: 60_000,
    // Jamais `true` : X-Forwarded-For est falsifiable, et une confiance aveugle laisserait
    // n'importe qui se donner une ip neuve a chaque requete, donc contourner la limitation de
    // debit. Une fonction plutot que le nombre de sauts, que fastify accepte a l'execution mais
    // que ses types ne declarent pas : `saut` compte a partir de la connexion directe, donc on
    // fait confiance aux SAUTS_PROXY plus proches et a aucun autre.
    trustProxy:
      env.SAUTS_PROXY === 0 ? false : (_adresse: string, saut: number) => saut < env.SAUTS_PROXY,
  }).withTypeProvider<ZodTypeProvider>()

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  // Pas de CORS, et c'est deliberé : aucun navigateur n'appelle Alambic, l'image lui parvient
  // par l'api de YieldMomo. Ne pas installer @fastify/cors est une propriete de securite, pas
  // un oubli — sans en-tete d'origine, aucune page web ne peut lire ce service. Pas de
  // controle anti-CSRF non plus : il protege un cookie de session, et il n'y en a aucun ici.

  app.setErrorHandler<FastifyError>((erreur, requete, reponse) => {
    if (erreur instanceof ErreurAlambic) {
      // Un refus attendu (image illisible, surcharge) n'est pas une panne : il se journalise
      // en avertissement, sinon le vrai bruit se noie dans le bruit ordinaire.
      const panne = erreur.statut >= 500
      requete.log[panne ? 'error' : 'warn'](
        { err: erreur, code: erreur.code },
        'Distillation refusee',
      )
      return reponse.code(erreur.statut).send({
        code: erreur.code,
        // Le detail d'une panne interne n'a rien a faire chez l'appelant : il part dans les logs.
        message: panne ? 'Une erreur interne est survenue.' : erreur.message,
      })
    }

    if (hasZodFastifySchemaValidationErrors(erreur)) {
      requete.log.warn({ err: erreur }, 'Requete invalide')
      return reponse
        .code(400)
        .send({ code: CODE_ERREUR.requeteInvalide, message: 'La requete est invalide.' })
    }

    if (isResponseSerializationError(erreur)) {
      requete.log.error({ err: erreur }, 'Reponse non conforme au schema')
      return reponse
        .code(500)
        .send({ code: CODE_ERREUR.erreurInterne, message: 'Une erreur interne est survenue.' })
    }

    const statut = erreur.statusCode ?? 500
    requete.log.error({ err: erreur }, 'Erreur non geree')
    return reponse.code(statut).send({
      code: statut >= 500 ? CODE_ERREUR.erreurInterne : CODE_ERREUR.requeteInvalide,
      message: statut >= 500 ? 'Une erreur interne est survenue.' : erreur.message,
    })
  })

  // En-tetes de securite. Pas de CSP : le service ne rend que du json, aucune page a proteger.
  app.register(helmet, { contentSecurityPolicy: false })

  app.register(limiteDebit, {
    ...LIMITE_GLOBALE,
    // Une ErreurAlambic et non un objet nu : @fastify/rate-limit LEVE ce que cette fabrique
    // rend, et un objet nu arrive au gestionnaire d'erreurs sans statut, donc en sort en 500.
    // Le refus prend ainsi la meme forme et le meme chemin que tous les autres.
    errorResponseBuilder: (_requete, contexte) =>
      new ErreurAlambic(
        CODE_ERREUR.surcharge,
        // 403 quand la limite mene a un bannissement, 429 dans le cas courant.
        contexte.statusCode ?? 429,
        'Trop de requetes, reessayez dans un instant.',
      ),
  })

  // La limite serveur est le vrai garde-fou : un pre-controle cote appelant se contourne.
  // `files: 1` : une image par requete, une distillation par requete.
  app.register(multipart, {
    limits: { fileSize: env.TAILLE_MAX_IMAGE, files: 1 },
  })

  app.register(routeSante)
  app.register(routeDistiller)

  return app
}
