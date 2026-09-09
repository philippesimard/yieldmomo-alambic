// Compresse le checkpoint de la Collecte et le televerse sur un bucket compatible S3 (OVH
// Object Storage). C'est la seule facon de faire entrer le modele maison dans l'image : il
// pese plus d'un Go et ne se versionne pas.
//
//   npm run publier-modele -- --bucket alambic-modeles
//
// L'image le redescend AU BUILD (voir Dockerfile, MODELE_S3_URI) : en production rien ne se
// telecharge et rien ne s'ecrit sur disque.
//
// Les clefs ne sont pas lues ici : le client s3 suit sa chaine de resolution habituelle
// (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, ou ~/.aws/credentials).

import { spawnSync } from 'node:child_process'
import { createReadStream, existsSync } from 'node:fs'
import { rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'

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

const dire = (ligne: string) => process.stdout.write(`${ligne}\n`)

const abandonner = (ligne: string): never => {
  dire(ligne)
  process.exit(1)
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
  },
})

if (!values.bucket)
  abandonner('Bucket manquant. Exemple : npm run publier-modele -- --bucket alambic-modeles')

const modele = resolve(values.modele)
if (!existsSync(modele)) abandonner(`Checkpoint introuvable : ${modele}`)

const manquants = FICHIERS_EXIGES.filter((fichier) => !existsSync(join(modele, fichier)))
if (manquants.length > 0) {
  abandonner(
    `Checkpoint incomplet, il manque : ${manquants.join(', ')}. Entrainer d'abord avec npm run entrainer-modele.`,
  )
}

// Date et non `latest` : un rebuild de l'image doit redonner exactement les memes poids, ce
// qu'une clef mouvante interdirait.
const jour = new Date().toISOString().slice(0, 10)
const cle = values.nom ?? `${basename(modele)}-${jour}.tar.gz`

const client = new S3Client({
  endpoint: values.endpoint,
  region: values.region,
  // ovh sert les buckets sur l'endpoint, pas sur <bucket>.<endpoint>.
  forcePathStyle: true,
})

const existeDeja = await client
  .send(new HeadObjectCommand({ Bucket: values.bucket, Key: cle }))
  .then(
    () => true,
    () => false,
  )

// Un objet publie est peut-etre deja dans une image en production : on ne le remplace pas par
// megarde. Meme garde que l'entrainement, qui refuse d'ecraser un checkpoint.
if (existeDeja && !values.ecraser) {
  abandonner(`s3://${values.bucket}/${cle} existe deja. Choisir --nom, ou forcer avec --ecraser.`)
}

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
  dire(
    `Televersement de ${(octets / 1024 ** 3).toFixed(2)} Go vers s3://${values.bucket}/${cle}...`,
  )

  const televersement = new Upload({
    client,
    params: {
      Bucket: values.bucket,
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

dire('')
dire('Publie. A poser dans Dokploy, en argument de build :')
dire(`  MODELE_S3_URI=s3://${values.bucket}/${cle}`)
