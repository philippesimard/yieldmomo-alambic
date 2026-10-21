import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CODE_ERREUR, ErreurAlambic, type ImageChauffee } from '@alambic/noyau'
import { Tokenizer } from '@huggingface/tokenizers'
import { InferenceSession, Tensor } from 'onnxruntime-node'
import { z } from 'zod'
import { ETIQUETTE, interpreterEtiquette, type MotEtiquete } from '../etiquettes'
import type { MoteurEtiquetage } from '../moteur'
import { boiteNormalisee, type Mot } from '../mots'
import { construireLot, premieresEtiquettes, type Speciaux } from './fenetres'

const NOM_MOTEUR_ONNX = 'onnx'

// Ce que `npm run exporter-modele` ecrit dans le dossier du modele.
const FICHIERS = {
  modele: 'modele.onnx',
  tokenizer: 'tokenizer.json',
  reglages: 'tokenizer_config.json',
  etiquettes: 'etiquettes.json',
} as const

const SPECIAUX = { debut: '<s>', fin: '</s>', bourrage: '<pad>' } as const

// Seules les erreurs meritent les journaux d'ONNX Runtime.
const JOURNAL_ERREURS_SEULEMENT = 3

const JetonsAjoutesSchema = z.object({
  added_tokens: z.array(z.object({ id: z.number(), content: z.string() })),
})

export type OptionsMoteurLiltOnnx = {
  // Le dossier ecrit par l'exporteur.
  dossier: string
  // Threads de calcul de la session : chaque ouvrier a la sienne.
  fils: number
}

type Modele = {
  session: InferenceSession
  tokenizer: Tokenizer
  speciaux: Speciaux
  etiquettes: string[]
}

// Le modele de la Collecte tourne dans l'ouvrier qui lit : ni sidecar, ni http, ni Python. Il se
// charge a la premiere facture et sert ensuite a toutes les suivantes.
export function creerMoteurLiltOnnx(options: OptionsMoteurLiltOnnx): MoteurEtiquetage {
  let modele: Promise<Modele> | null = null
  return {
    nom: NOM_MOTEUR_ONNX,
    etiqueter: async (mots, image) => {
      if (mots.length === 0) return []
      modele ??= charger(options)
      try {
        return await etiqueter(mots, image, await modele)
      } catch (erreur) {
        if (erreur instanceof ErreurAlambic) throw erreur
        throw new ErreurAlambic(
          CODE_ERREUR.erreurInterne,
          500,
          "Le moteur d'etiquetage onnx n'a pas pu etiqueter la facture.",
          erreur,
        )
      }
    },
  }
}

async function charger(options: OptionsMoteurLiltOnnx): Promise<Modele> {
  const lire = (fichier: string) => readFile(join(options.dossier, fichier), 'utf8')
  const [session, tokenizerJson, reglages, etiquettes] = await Promise.all([
    InferenceSession.create(join(options.dossier, FICHIERS.modele), {
      intraOpNumThreads: options.fils,
      interOpNumThreads: 1,
      executionMode: 'sequential',
      graphOptimizationLevel: 'all',
      logSeverityLevel: JOURNAL_ERREURS_SEULEMENT,
      // Sans cela, les threads du calcul tournent a vide entre deux appels et volent le
      // processeur aux autres ouvriers.
      extra: { session: { intra_op: { allow_spinning: '0' } } },
    }),
    lire(FICHIERS.tokenizer),
    lire(FICHIERS.reglages),
    lire(FICHIERS.etiquettes),
  ])
  const brut: unknown = JSON.parse(tokenizerJson)
  const ajoutes = JetonsAjoutesSchema.parse(brut).added_tokens
  const idDe = (contenu: string): number => {
    const ajoute = ajoutes.find((jeton) => jeton.content === contenu)
    if (ajoute === undefined) {
      throw new ErreurAlambic(
        CODE_ERREUR.erreurInterne,
        500,
        `Le tokenizer du modele n'a pas de jeton ${contenu}.`,
      )
    }
    return ajoute.id
  }
  return {
    session,
    // Sur : les deux fichiers sont ecrits par transformers (save_pretrained) dans l'exporteur, et
    // la bibliotheque lit leur format tel quel.
    tokenizer: new Tokenizer(brut as object, JSON.parse(reglages) as object),
    speciaux: {
      debut: idDe(SPECIAUX.debut),
      fin: idDe(SPECIAUX.fin),
      bourrage: idDe(SPECIAUX.bourrage),
    },
    etiquettes: z.array(z.string()).parse(JSON.parse(etiquettes)),
  }
}

async function etiqueter(
  mots: readonly Mot[],
  image: ImageChauffee,
  modele: Modele,
): Promise<MotEtiquete[]> {
  // Chaque mot se decoupe seul, comme `is_split_into_words` de transformers : le tokenizer lui
  // prefixe l'espace de SentencePiece.
  const jetons = mots.map(
    (mot) => modele.tokenizer.encode(mot.texte, { add_special_tokens: false }).ids,
  )
  const boites = mots.map((mot) => boiteNormalisee(mot.cadre, image.largeur, image.hauteur))
  const lot = construireLot(jetons, boites, modele.speciaux)

  const forme = [lot.fenetres, lot.longueur]
  const sortie = await modele.session.run({
    input_ids: new Tensor('int64', lot.ids, forme),
    bbox: new Tensor('int64', lot.boites, [...forme, 4]),
    attention_mask: new Tensor('int64', lot.masque, forme),
  })
  const logits = sortie.logits
  const classes = Number(logits?.dims[2] ?? 0)
  if (!(logits?.data instanceof Float32Array) || classes !== modele.etiquettes.length) {
    throw new ErreurAlambic(
      CODE_ERREUR.erreurInterne,
      500,
      `Le modele rend ${classes} classes pour ${modele.etiquettes.length} etiquettes.`,
    )
  }

  const etiquetages = premieresEtiquettes(logits.data, lot, classes, mots.length)
  return mots.map((mot, rang) => {
    const etiquetage = etiquetages[rang]
    if (etiquetage === null || etiquetage === undefined)
      return { ...mot, etiquette: ETIQUETTE.exterieur, debut: false, score: 0 }
    const brute = modele.etiquettes[etiquetage.classe] ?? ETIQUETTE.exterieur
    const { etiquette, debut } = interpreterEtiquette(brute)
    return { ...mot, etiquette, debut, score: etiquetage.score }
  })
}
