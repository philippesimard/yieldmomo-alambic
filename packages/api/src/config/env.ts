import { existsSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'
import { ENVIRONNEMENT } from '@alambic/noyau'
import { config } from 'dotenv'
import { z } from 'zod'

// Le .env vit a la racine du mono-repo, mais npm workspaces execute les scripts avec
// cwd = packages/api : on le charge donc par chemin absolu, pas depuis le cwd.
config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true })

export const MOTEUR_OCR = {
  factice: 'factice',
  paddleocr: 'paddleocr',
} as const

export type MoteurOcrConfigure = (typeof MOTEUR_OCR)[keyof typeof MOTEUR_OCR]

export const DETECTION_OCR = {
  mobile: 'mobile',
  server: 'server',
} as const

export type DetectionOcr = (typeof DETECTION_OCR)[keyof typeof DETECTION_OCR]

export const MOTEUR_COLLECTE = {
  factice: 'factice',
  lilt: 'lilt',
} as const

export type MoteurCollecteConfigure = (typeof MOTEUR_COLLECTE)[keyof typeof MOTEUR_COLLECTE]

// Le venv du sidecar en developpement. En production, le Dockerfile installe le sidecar dans
// /opt/ocr et renseigne la variable lui-meme.
const CHEMIN_PYTHON_PAR_DEFAUT = fileURLToPath(
  new URL('../../../condensation/sidecar/.venv/bin/python', import.meta.url),
)

// Meme logique pour le sidecar d'etiquetage : venv du depot en developpement, /opt/collecte
// dans l'image docker.
const CHEMIN_PYTHON_COLLECTE_PAR_DEFAUT = fileURLToPath(
  new URL('../../../collecte/sidecar/.venv/bin/python', import.meta.url),
)

// Checkpoint LiLT (licence MIT) fine-tune sur CORD, des recus anglais et indonesiens : il
// travaille donc en zero-shot sur un recu quebecois. Defaut de developpement seulement — en
// production le modele maison est exige, voir le controle plus bas.
const MODELE_COLLECTE_PAR_DEFAUT = 'doc2txt/tst_lilt_cord_xlm_ft'

// Un ouvrier de moins que de coeurs : le thread principal doit garder de quoi accepter les
// requetes et rendre les reponses, sinon la latence grimpe alors meme que le debit plafonne.
const OUVRIERS_PAR_DEFAUT = Math.max(1, availableParallelism() - 1)

// 15 Mo. Plus large que la limite de photo de profil de YieldMomo (10 Mo) : une photo prise au
// grand-angle d'un iPhone recent depasse regulierement les 10 Mo, et couper la requete a la
// reception rendrait le service inutilisable sur exactement les appareils qu'on vise.
const TAILLE_MAX_PAR_DEFAUT = 15_728_640

// Config validee et typee au demarrage. On n'accede jamais a process.env ailleurs.
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(ENVIRONNEMENT).default(ENVIRONNEMENT.development),
    HOST: z.string().default('0.0.0.0'),
    // 3100 et non 3000 : l'api de YieldMomo occupe deja 3000 en developpement local, et les
    // deux tournent ensemble sur le poste.
    PORT: z.coerce.number().int().positive().default(3100),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    // Arret volontaire du service. Les sondes l'annoncent et /distiller refuse, mais le process
    // reste debout : c'est ce qui distingue une maintenance d'une panne, et ce qui evite que
    // l'orchestrateur redemarre en boucle un conteneur qu'on a justement mis de cote.
    MODE_MAINTENANCE: z.stringbool().default(false),
    // Le secret partage avec l'api de YieldMomo. Optionnelle en developpement, ou l'exiger
    // ferait echouer un `npm run dev` sur un clone frais ; exigee en production plus bas, ou
    // son absence laisserait le service ouvert a qui sait l'adresse.
    ALAMBIC_CLE: z.string().min(32).optional(),
    // Nombre de proxys de confiance devant le service. Sert a lire la vraie ip du client dans
    // X-Forwarded-For : sans ca, la limitation de debit compte toutes les requetes sur l'ip du
    // proxy. Ne jamais faire confiance a l'en-tete sans savoir combien de sauts sont les
    // notres : il est falsifiable.
    SAUTS_PROXY: z.coerce.number().int().min(0).default(0),
    TAILLE_MAX_IMAGE: z.coerce.number().int().positive().default(TAILLE_MAX_PAR_DEFAUT),
    OUVRIERS: z.coerce.number().int().positive().default(OUVRIERS_PAR_DEFAUT),
    // Plafond par distillation. Sans lui, un ouvrier bloque sur une image pathologique est
    // perdu pour toujours, et l'atelier se vide en silence sous la charge.
    DELAI_DISTILLATION_MS: z.coerce.number().int().positive().default(30_000),
    // Optionnelle en developpement (defaut factice, applique plus bas) pour qu'un clone frais
    // demarre sans python ; exigee en production, ou un service tournant en silence au moteur
    // factice rendrait des factures inventees.
    MOTEUR_OCR: z.enum(MOTEUR_OCR).optional(),
    // 3101 : 3100 est deja l'api, 3000 l'api de YieldMomo sur le meme poste.
    PORT_SIDECAR_OCR: z.coerce.number().int().positive().default(3101),
    DELAI_OCR_MS: z.coerce.number().int().positive().default(20_000),
    CHEMIN_PYTHON_OCR: z.string().default(CHEMIN_PYTHON_PAR_DEFAUT),
    DETECTION_OCR: z.enum(DETECTION_OCR).default(DETECTION_OCR.mobile),
    // Optionnelle en developpement (defaut factice, applique plus bas) pour qu'un clone frais
    // demarre sans python ; exigee en production, ou un service tournant en silence au moteur
    // factice rendrait des factures inventees.
    MOTEUR_COLLECTE: z.enum(MOTEUR_COLLECTE).optional(),
    // 3103 : 3100 est l'api, 3101 le sidecar ocr, 3102 celui du banc de condensation.
    PORT_SIDECAR_COLLECTE: z.coerce.number().int().positive().default(3103),
    DELAI_COLLECTE_MS: z.coerce.number().int().positive().default(6_000),
    CHEMIN_PYTHON_COLLECTE: z.string().default(CHEMIN_PYTHON_COLLECTE_PAR_DEFAUT),
    // Optionnelle en developpement (defaut public, applique plus bas) ; exigee en production,
    // ou le checkpoint public rendrait des factures moins bien lues sans que rien ne le dise.
    MODELE_COLLECTE: z.string().optional(),
  })
  .superRefine((valeurs, contexte) => {
    // Chaque moteur doit abandonner avant que l'atelier tue l'ouvrier qui l'attend : sinon
    // chaque appel trop long couterait un ouvrier au lieu d'un simple 504. La somme des deux
    // plafonds laisse a la chauffe le reste du budget de la distillation.
    if (valeurs.DELAI_OCR_MS + valeurs.DELAI_COLLECTE_MS >= valeurs.DELAI_DISTILLATION_MS) {
      contexte.addIssue({
        code: 'custom',
        path: ['DELAI_OCR_MS'],
        message:
          'DELAI_OCR_MS + DELAI_COLLECTE_MS doit rester strictement sous DELAI_DISTILLATION_MS.',
      })
    }

    // La clef se verifie PARTOUT sauf en developpement, et non en production seulement : sans
    // clef configuree, exigerCle laisse tout passer, et `test` est un environnement deployable
    // comme un autre. Une instance lancee par megarde en NODE_ENV=test tournerait alors en
    // service de traitement d'images ouvert. Le confort du developpement est intact.
    if (valeurs.NODE_ENV !== ENVIRONNEMENT.development && valeurs.ALAMBIC_CLE === undefined) {
      contexte.addIssue({
        code: 'custom',
        path: ['ALAMBIC_CLE'],
        message:
          'ALAMBIC_CLE est requise hors developpement : sans elle, le service accepte des images de nimporte qui. Generer avec `openssl rand -base64 32`.',
      })
    }

    // Les moteurs, eux, restent une exigence de production seule : hors production le transform
    // retombe volontairement sur le moteur factice, dont un banc ou un test a besoin.
    if (valeurs.NODE_ENV !== ENVIRONNEMENT.production) return

    if (valeurs.MOTEUR_OCR === undefined) {
      contexte.addIssue({
        code: 'custom',
        path: ['MOTEUR_OCR'],
        message:
          'MOTEUR_OCR est requise en production : sans elle, le service pourrait tourner au moteur factice et rendre des factures inventees. Choisir `paddleocr`.',
      })
    }

    if (valeurs.MOTEUR_COLLECTE === undefined) {
      contexte.addIssue({
        code: 'custom',
        path: ['MOTEUR_COLLECTE'],
        message:
          'MOTEUR_COLLECTE est requise en production : sans elle, le service pourrait tourner au moteur factice et rendre des factures inventees. Choisir `lilt`.',
      })
    }

    // Le seul echec silencieux du lot : le checkpoint public CHARGE, il est dans l'image, et
    // rend des factures — simplement moins bien lues, en zero-shot sur un recu quebecois.
    // Aucune sonde ne le verrait. L'image renseigne cette cle quand elle est construite avec
    // MODELE_S3_URI ; la definir dans le tableau de bord ecraserait cette valeur.
    if (valeurs.MODELE_COLLECTE === undefined) {
      contexte.addIssue({
        code: 'custom',
        path: ['MODELE_COLLECTE'],
        message:
          'MODELE_COLLECTE est requise en production : sans elle, le service lirait les recus avec le checkpoint public, en zero-shot, sans rien signaler. Construire avec MODELE_S3_URI, et laisser cette cle absente du tableau de bord.',
      })
    }
  })
  // Bloc separe : celui du dessus sort tot hors production, alors qu'un chemin fautif se
  // signale partout — c'est en developpement qu'on se trompe de dossier.
  .superRefine((valeurs, contexte) => {
    // Un checkpoint peut etre un identifiant hugging face ou un dossier local ; seul le second
    // se verifie. Sans ce controle, un chemin fautif coute cinq redemarrages du sidecar puis un
    // /ready bloque en 503, sans que rien ne dise pourquoi.
    if (valeurs.MODELE_COLLECTE?.startsWith('/') && !existsSync(valeurs.MODELE_COLLECTE)) {
      contexte.addIssue({
        code: 'custom',
        path: ['MODELE_COLLECTE'],
        message: `Dossier de checkpoint introuvable : ${valeurs.MODELE_COLLECTE}`,
      })
    }
  })
  .transform((valeurs) => ({
    // Les defauts ne s'appliquent qu'en developpement : en production, l'absence a deja refuse
    // le demarrage juste au-dessus.
    ...valeurs,
    MOTEUR_OCR: valeurs.MOTEUR_OCR ?? MOTEUR_OCR.factice,
    MOTEUR_COLLECTE: valeurs.MOTEUR_COLLECTE ?? MOTEUR_COLLECTE.factice,
    MODELE_COLLECTE: valeurs.MODELE_COLLECTE ?? MODELE_COLLECTE_PAR_DEFAUT,
  }))

// Une cle laissee vide dans un gabarit ou dans le tableau de bord de deploiement vaut « non
// definie », pas « invalide » : sans ce nettoyage, ALAMBIC_CLE= ferait echouer le min(32)
// plutot que de tomber sur le controle de production, dont le message est le bon.
function sansValeursVides(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([, valeur]) => valeur !== ''))
}

const resultat = EnvSchema.safeParse(sansValeursVides(process.env))
if (!resultat.success) {
  // Message lisible plutot qu'une ZodError brute : c'est la premiere chose que voit quelqu'un
  // dont le deploiement refuse de demarrer.
  const details = resultat.error.issues
    .map((probleme) => `  - ${probleme.path.join('.')} : ${probleme.message}`)
    .join('\n')
  throw new Error(`Configuration invalide, demarrage refuse :\n${details}`)
}

export const env = resultat.data
