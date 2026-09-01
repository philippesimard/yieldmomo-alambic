import { fileURLToPath } from 'node:url'

// Ce que l'exterieur doit connaitre du sidecar pour le lancer et lui parler, sans dependre de
// l'arborescence interne du package : le chemin du serveur python et ses deux routes.
export const SIDECAR_PADDLE = {
  chemin: fileURLToPath(new URL('../sidecar/serveur.py', import.meta.url)),
  routeLecture: '/lire',
  routeSante: '/sante',
} as const
