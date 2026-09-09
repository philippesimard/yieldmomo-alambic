// Lance un script python dans le venv des outils, pour qu'aucune commande npm n'exige de
// connaitre le chemin de l'interpreteur.
//
//   npm run generer-recus -- --n 2000
//   npm run entrainer-modele -- --epoques 5
//
// Les arguments sont transmis tels quels et le cwd n'est pas touche : un chemin tape dans le
// terminal se resout donc depuis le terminal, et non depuis outils/.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PYTHON = fileURLToPath(new URL('.venv/bin/python', import.meta.url))

if (!existsSync(PYTHON)) {
  process.stderr.write(
    `Venv des outils absent : ${PYTHON}\nLance "npm install" — le postinstall le prepare.\n`,
  )
  process.exit(1)
}

const resultat = spawnSync(PYTHON, process.argv.slice(2), { stdio: 'inherit' })

// Sans cette ligne, un pytest en echec rendrait 0 et npm annoncerait un succes.
process.exitCode = resultat.status ?? 1
