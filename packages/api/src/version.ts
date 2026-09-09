import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

// La version du service est celle du package.json de la racine : une seule source, deja
// versionnee avec le code, plutot qu'une constante a garder en phase a la main. Lu par chemin
// absolu et non depuis le cwd, pour la meme raison que le .env : npm workspaces execute les
// scripts avec cwd = packages/api.
const CHEMIN_MANIFESTE = fileURLToPath(new URL('../../../package.json', import.meta.url))

const ManifesteSchema = z.object({ version: z.string().min(1) })

const manifeste: unknown = JSON.parse(readFileSync(CHEMIN_MANIFESTE, 'utf8'))

export const VERSION = ManifesteSchema.parse(manifeste).version
