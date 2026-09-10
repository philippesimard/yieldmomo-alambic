// Compresse le checkpoint de la Collecte et le televerse sur un bucket compatible S3 (OVH
// Object Storage). C'est la seule facon de faire entrer le modele maison dans l'image : il
// pese plus d'un Go et ne se versionne pas.
//
//   npm run publier-modele -- --bucket alambic-modeles
//
// Rend une URL presignee, valable une semaine. C'est elle que l'image recoit au build (voir
// Dockerfile, MODELE_URL) : le build n'a alors besoin d'aucune clef S3 — beaucoup de
// plateformes, Dokploy comprise, ne savent pas monter de secret de build — et une URL expiree
// ne donne acces a rien. En production rien ne se telecharge et rien ne s'ecrit sur disque.
//
// --url-seulement represigne un objet deja publie, sans rien televerser : une URL dure sept
// jours, un modele bien plus longtemps.
//
// Les clefs se demandent au terminal : elles ne vivent alors ni dans un fichier du depot, ni
// dans l'historique du shell, et rien n'en subsiste apres la commande. Un environnement qui
// porte deja AWS_ACCESS_KEY_ID et AWS_SECRET_ACCESS_KEY court-circuite la saisie — c'est le
// seul moyen de publier sans terminal.

import { spawnSync } from 'node:child_process'
import { createReadStream, existsSync } from 'node:fs'
import { rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const RACINE = resolve(fileURLToPath(import.meta.url), '../..')

const MODELE_PAR_DEFAUT = join(RACINE, 'outils/entrainement/modeles/lilt-alambic')

// Beauharnois : le meme datacentre que les vps, donc un transfert interne a ovh.
const ENDPOINT_PAR_DEFAUT = 'https://s3.bhs.io.cloud.ovh.net'
const REGION_PAR_DEFAUT = 'bhs'

// Ce que from_pretrained exige cote sidecar. Verifie avant de compresser : deux minutes de
// gzip pour decouvrir ensuite qu'il manque les poids, ce serait deux minutes perdues.
const FICHIERS_EXIGES = ['config.json', 'model.safetensors', 'tokenizer.json']

// 1,1 Go ne passe pas en un seul PutObject. 64 Mo par part : assez gros pour que le nombre de
// parts reste bas, assez petit pour qu'un reessai ne recommence pas tout.
const TAILLE_PART = 64 * 1024 * 1024

// Sept jours, le maximum d'une signature v4. Au-dela, il faut represigner : --url-seulement.
const DUREE_URL_S = 7 * 24 * 60 * 60

// Touches lues en mode brut, ou plus rien n'est interprete pour nous.
const FIN_DE_LIGNE = ['\r', '\n']
const INTERRUPTION = '\u0003'
const EFFACEMENT = ['\u007f', '\b']

const dire = (ligne: string) => process.stdout.write(`${ligne}\n`)

const abandonner = (ligne: string): never => {
  dire(ligne)
  process.exit(1)
}

const exigerTerminal = () => {
  if (!process.stdin.isTTY) {
    abandonner(
      'Pas de terminal pour la saisie. Passer --bucket, et definir AWS_ACCESS_KEY_ID et AWS_SECRET_ACCESS_KEY.',
    )
  }
}

const demander = async (invite: string): Promise<string> => {
  exigerTerminal()
  const lecture = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await lecture.question(invite)).trim()
  } catch {
    // ctrl+d : readline rejette la question. Sans ca, un abandon se lirait comme un plantage.
    lecture.close()
    dire('')
    process.exit(130)
  } finally {
    lecture.close()
    // close() ne rend pas stdin : sans pause, le script ne rendrait pas la main a la fin.
    process.stdin.pause()
  }
}

// Meme chose sans echo. readline n'offre pas de masquage, d'ou le mode brut et la lecture
// touche par touche.
const demanderMasque = (invite: string): Promise<string> => {
  exigerTerminal()
  process.stdout.write(invite)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding('utf8')

  return new Promise((resoudre) => {
    let saisie = ''

    const rendreLeTerminal = () => {
      process.stdin.off('data', surDonnee)
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdout.write('\n')
    }

    const surDonnee = (morceau: string) => {
      // Touche par touche et non morceau par morceau : un collage arrive d'un bloc, et porte
      // souvent le retour a la ligne en dernier.
      for (const touche of morceau) {
        // ctrl+c : en mode brut le signal ne part pas tout seul, et le terminal resterait muet.
        if (touche === INTERRUPTION) {
          rendreLeTerminal()
          process.exit(130)
        }
        if (FIN_DE_LIGNE.includes(touche)) {
          rendreLeTerminal()
          resoudre(saisie.trim())
          return
        }
        if (EFFACEMENT.includes(touche)) {
          saisie = saisie.slice(0, -1)
          continue
        }
        saisie += touche
      }
    }

    process.stdin.on('data', surDonnee)
  })
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    modele: { type: 'string', default: MODELE_PAR_DEFAUT },
    bucket: { type: 'string' },
    endpoint: { type: 'string', default: ENDPOINT_PAR_DEFAUT },
    region: { type: 'string', default: REGION_PAR_DEFAUT },
    nom: { type: 'string' },
    ecraser: { type: 'boolean', default: false },
    'url-seulement': { type: 'boolean', default: false },
  },
})

// Un bucket ne porte que des minuscules, des chiffres, des tirets et des points, de 3 a 63
// caracteres. On le verifie avant HeadBucket : le sdk ne refuse que le '/', dans un message
// anglais qui parle de caracteres interdits plutot que du champ mal rempli.
const NOM_DE_BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/

const exigerNomDeBucket = (bucket: string) => {
  if (NOM_DE_BUCKET.test(bucket)) return
  if (bucket.includes('/')) {
    abandonner(
      `Nom de bucket attendu, pas une URL : ${bucket}. Donner le nom seul (ex. alambic-modeles) ; l'endpoint vaut deja ${values.endpoint} et se change avec --endpoint.`,
    )
  }
  abandonner(
    `Nom de bucket invalide : ${bucket}. Minuscules, chiffres, tirets et points, de 3 a 63 caracteres.`,
  )
}

const urlSeulement = values['url-seulement']

// En mode --url-seulement l'objet est deja sur le bucket : le checkpoint local n'a pas a
// exister, et --nom devient le seul moyen de designer lequel represigner.
const modele = resolve(values.modele)
if (!urlSeulement) {
  if (!existsSync(modele)) abandonner(`Checkpoint introuvable : ${modele}`)

  const manquants = FICHIERS_EXIGES.filter((fichier) => !existsSync(join(modele, fichier)))
  if (manquants.length > 0) {
    abandonner(
      `Checkpoint incomplet, il manque : ${manquants.join(', ')}. Entrainer d'abord avec npm run entrainer-modele.`,
    )
  }
}

// Le checkpoint d'abord : rien ne sert de reclamer des clefs pour decouvrir ensuite qu'il
// manque les poids.
const bucket = values.bucket ?? (await demander('Bucket S3 (nom seul, ex. alambic-modeles) : '))
if (!bucket) abandonner('Bucket manquant.')
exigerNomDeBucket(bucket)

const cleAcces = process.env.AWS_ACCESS_KEY_ID
const cleSecrete = process.env.AWS_SECRET_ACCESS_KEY

const identifiants =
  cleAcces && cleSecrete
    ? { accessKeyId: cleAcces, secretAccessKey: cleSecrete }
    : {
        accessKeyId: await demander("Clef d'acces S3 : "),
        secretAccessKey: await demanderMasque('Clef secrete S3 (invisible) : '),
      }

if (!identifiants.accessKeyId || !identifiants.secretAccessKey) abandonner('Clef vide.')

// Date et non `latest` : un rebuild de l'image doit redonner exactement les memes poids, ce
// qu'une clef mouvante interdirait.
const jour = new Date().toISOString().slice(0, 10)
const cle = values.nom ?? `${basename(modele)}-${jour}.tar.gz`

const client = new S3Client({
  endpoint: values.endpoint,
  region: values.region,
  credentials: identifiants,
  // ovh sert les buckets sur l'endpoint, pas sur <bucket>.<endpoint>.
  forcePathStyle: true,
})

// Une clef mal tapee ou un bucket absent doivent se voir maintenant : la compression qui suit
// dure plusieurs minutes, et HeadObject avale ses erreurs pour distinguer l'objet absent.
await client.send(new HeadBucketCommand({ Bucket: bucket })).catch((erreur: unknown) => {
  abandonner(
    `Bucket ${bucket} inaccessible : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
  )
})

// ListObjectsV2 plutot que HeadObject : un HEAD n'a pas de corps de reponse, donc le sdk n'a
// rien a parser et rend un « UnknownError » muet des que ca se passe mal. Un GET porte le vrai
// message, et la meme requete repond a la fois « l'objet est-il la » et « que contient le
// bucket ».
// Forme publique d'une erreur du sdk : le statut http y est meme quand le corps de la reponse
// ne dit rien.
const statutDe = (erreur: unknown) =>
  typeof erreur === 'object' && erreur !== null && '$metadata' in erreur
    ? (erreur as { $metadata: { httpStatusCode?: number } }).$metadata.httpStatusCode
    : undefined

const lister = async (prefixe?: string): Promise<string[]> => {
  const reponse = await client
    .send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefixe, MaxKeys: 20 }))
    .catch((erreur: unknown) =>
      abandonner(
        `Lecture de ${bucket} refusee (http ${statutDe(erreur) ?? '?'} : ${erreur instanceof Error ? erreur.message : String(erreur)}). Cette clef ouvre le bucket mais n'en lit pas le contenu : il lui faut le droit de lecture des objets.`,
      ),
    )
  return (reponse.Contents ?? []).flatMap((objet) => (objet.Key === undefined ? [] : [objet.Key]))
}

const existeDeja = (await lister(cle)).includes(cle)

if (urlSeulement && !existeDeja) {
  const objets = await lister()
  const inventaire =
    objets.length > 0
      ? `\nLe bucket contient :\n${objets.map((nom) => `  ${nom}`).join('\n')}`
      : '\nLe bucket est vide.'
  abandonner(`s3://${bucket}/${cle} n'existe pas.${inventaire}`)
}

// Un objet publie est peut-etre deja dans une image en production : on ne le remplace pas par
// megarde. Meme garde que l'entrainement, qui refuse d'ecraser un checkpoint.
if (existeDeja && !urlSeulement && !values.ecraser) {
  abandonner(`s3://${bucket}/${cle} existe deja. Choisir --nom, ou forcer avec --ecraser.`)
}

const publier = async () => {
  const archive = join(tmpdir(), `alambic-${basename(modele)}-${process.pid}.tar.gz`)

  dire(`Compression de ${modele} (quelques minutes)...`)
  // Le tar du systeme plutot qu'une bibliotheque : il est present sur macos comme sur linux, et
  // l'archive porte le dossier en tete — c'est ce que le --strip-components=1 de l'image attend.
  const compression = spawnSync('tar', ['-czf', archive, '-C', dirname(modele), basename(modele)], {
    stdio: 'inherit',
  })
  if (compression.status !== 0) abandonner('Compression echouee.')

  const octets = (await stat(archive)).size

  try {
    dire(`Televersement de ${(octets / 1024 ** 3).toFixed(2)} Go vers s3://${bucket}/${cle}...`)

    const televersement = new Upload({
      client,
      params: {
        Bucket: bucket,
        Key: cle,
        Body: createReadStream(archive),
        ContentType: 'application/gzip',
      },
      partSize: TAILLE_PART,
    })

    televersement.on('httpUploadProgress', ({ loaded }) => {
      if (loaded !== undefined) process.stdout.write(`\r  ${Math.round((loaded / octets) * 100)} %`)
    })

    await televersement.done()
    dire('\r  100 %')
  } finally {
    // Le fichier temporaire pese autant que le modele : il part meme si le televersement casse.
    await rm(archive, { force: true })
  }
}

if (!urlSeulement) {
  await publier()
}

const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: cle }), {
  expiresIn: DUREE_URL_S,
})

const expiration = new Date(Date.now() + DUREE_URL_S * 1000).toISOString().slice(0, 10)

dire('')
dire(`URL valable jusqu'au ${expiration}. A poser dans Dokploy, en argument de build :`)
dire(`  MODELE_URL=${url}`)
dire('')
dire("Passe cette date, l'image ne se reconstruira plus : represigner avec")
dire(`  npm run publier-modele -- --bucket ${bucket} --nom ${cle} --url-seulement`)
