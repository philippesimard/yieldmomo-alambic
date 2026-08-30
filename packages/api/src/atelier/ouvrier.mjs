// Point d'entree du thread, en .mjs et non en .ts : un worker n'herite pas du chargeur de
// modules de son parent, donc il ne saurait pas lire le TypeScript de ouvrier.ts. Node, lui,
// charge un .mjs nativement. Ce fichier installe le chargeur dans le thread, puis passe la
// main.
//
// Pourquoi pas l'option execArgv du Worker, qui ferait la meme chose en une ligne : elle
// fonctionne sous `node --import tsx` mais pas sous `tsx watch`, qui la remplace par la
// sienne. Le lanceur de developpement et celui de production doivent se comporter pareil.
import { register } from 'tsx/esm/api'

register()

await import('./ouvrier.ts')
