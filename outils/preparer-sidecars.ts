// Prepare les venvs python du depot, en postinstall de `npm install` : une seule commande
// suffit alors a rendre le depot executable, sidecars et outillage compris.
//
// Le travail se fait une fois. Tant que le requirements.txt d'un venv ne change pas, le venv
// existant est repris tel quel et la preparation ne coute rien.
//
// Elle ne s'execute jamais quand un interpreteur est deja fourni (CHEMIN_PYTHON_OCR,
// CHEMIN_PYTHON_COLLECTE) : c'est le cas de l'image docker, qui construit ses propres venvs.
// ALAMBIC_SANS_SIDECARS=1 la coupe entierement, pour un poste qui se contente des moteurs
// factices.
//
// Ce fichier est le seul de outils/ que le Dockerfile copie, parce que npm ci doit pouvoir
// executer le postinstall. Il ne doit donc JAMAIS importer un autre module du depot.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = resolve(fileURLToPath(import.meta.url), '../..')

// La version de python est celle des deux requirements : paddlepaddle comme torch publient
// leurs roues pour 3.11, pas au-dela.
const VERSION_PYTHON = '3.11'

type Venv = {
  readonly nom: string
  readonly dossier: string
  // Absente pour le venv d'outils : rien ne fournit cet interpreteur, c'est la presence du
  // requirements.txt qui decide.
  readonly variablePython?: string
}

const VENVS: readonly Venv[] = [
  {
    nom: 'sidecar condensation',
    dossier: 'packages/condensation/sidecar',
    variablePython: 'CHEMIN_PYTHON_OCR',
  },
  {
    nom: 'sidecar collecte',
    dossier: 'packages/collecte/sidecar',
    variablePython: 'CHEMIN_PYTHON_COLLECTE',
  },
  { nom: 'outils', dossier: 'outils' },
]

const dire = (ligne: string) => process.stdout.write(`${ligne}\n`)

const empreinteDe = (chemin: string) =>
  createHash('sha256').update(readFileSync(chemin)).digest('hex')

const executer = (commande: string, arguments_: readonly string[], dossier: string) => {
  const resultat = spawnSync(commande, [...arguments_], { cwd: dossier, stdio: 'inherit' })
  return resultat.status === 0
}

const disponible = (commande: string) =>
  spawnSync(commande, ['--version'], { stdio: 'ignore' }).status === 0

// uv et non python3 -m venv : il installe lui-meme l'interpreteur 3.11 s'il manque, ce qui
// evite de dependre de ce que le poste a deja (le python d'apple, lui, exige xcode).
const trouverUv = () => {
  if (disponible('uv')) return 'uv'

  const local = join(homedir(), '.local', 'bin', 'uv')
  if (existsSync(local)) return local

  dire('Installation de uv (gestionnaire python)...')
  const installe = spawnSync('sh', ['-c', 'curl -LsSf https://astral.sh/uv/install.sh | sh'], {
    stdio: 'inherit',
  })
  return installe.status === 0 && existsSync(local) ? local : null
}

const preparer = (uv: string, venv: Venv) => {
  const dossier = join(RACINE, venv.dossier)
  const requirements = join(dossier, 'requirements.txt')
  const python = join(dossier, '.venv', 'bin', 'python')
  const empreinte = join(dossier, '.venv', '.empreinte')

  const attendue = empreinteDe(requirements)
  if (existsSync(python) && existsSync(empreinte) && readFileSync(empreinte, 'utf8') === attendue) {
    dire(`Venv ${venv.nom} : a jour.`)
    return true
  }

  dire(`Venv ${venv.nom} : preparation (peut prendre plusieurs minutes)...`)
  // --clear : on n'arrive ici que si le requirements a change ou si le venv est incomplet, et
  // uv refuse d'ecrire dans un dossier .venv deja present. Sans lui, un venv existant ne peut
  // plus etre mis a jour du tout.
  const fait =
    executer(uv, ['venv', '--clear', '--python', VERSION_PYTHON], dossier) &&
    executer(uv, ['pip', 'install', '-r', 'requirements.txt'], dossier)

  if (fait) writeFileSync(empreinte, attendue)
  return fait
}

const principal = () => {
  if (process.env.ALAMBIC_SANS_SIDECARS) return

  // Le chemin des venvs est en dur (`.venv/bin/python`) : windows placerait son interpreteur
  // ailleurs, et aucun poste du projet ne tourne dessus.
  if (process.platform === 'win32') {
    dire('Sidecars ignores : preparation non supportee sur windows.')
    return
  }

  // L'existence du requirements.txt fait partie du filtre et non de preparer() : l'image
  // docker ne copie que ce script, et trouverUv() irait sinon installer uv par curl avant de
  // se casser sur le fichier absent.
  const aPreparer = VENVS.filter(
    ({ dossier, variablePython }) =>
      !(variablePython && process.env[variablePython]) &&
      existsSync(join(RACINE, dossier, 'requirements.txt')),
  )
  if (aPreparer.length === 0) return

  const uv = trouverUv()
  if (!uv) {
    dire('uv introuvable : sidecars non prepares, les moteurs factices restent utilisables.')
    return
  }

  // Un venv qui echoue ne fait pas echouer l'installation : le reste du depot fonctionne, et
  // les moteurs factices prennent le relais le temps de regler le probleme.
  const echecs = aPreparer.filter((venv) => !preparer(uv, venv)).map(({ nom }) => nom)
  if (echecs.length > 0) {
    dire(`Venvs non prepares : ${echecs.join(', ')}. Moteurs factices utilisables en attendant.`)
  }
}

principal()
