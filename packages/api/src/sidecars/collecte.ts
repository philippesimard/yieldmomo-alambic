import { SIDECAR_LAYOUTLM } from '@alambic/collecte'
import { env, MOTEUR_COLLECTE } from '../config/env'
import { creerSuperviseur } from './superviseur'

const superviseur = creerSuperviseur({
  nom: 'sidecar-collecte',
  actif: env.MOTEUR_COLLECTE === MOTEUR_COLLECTE.layoutlmv3,
  commande: env.CHEMIN_PYTHON_COLLECTE,
  arguments: [
    SIDECAR_LAYOUTLM.chemin,
    '--port',
    String(env.PORT_SIDECAR_COLLECTE),
    '--modele',
    env.MODELE_COLLECTE,
  ],
  urlSante: `http://127.0.0.1:${env.PORT_SIDECAR_COLLECTE}${SIDECAR_LAYOUTLM.routeSante}`,
})

export const demarrerSidecarCollecte = superviseur.demarrer
export const sidecarCollectePret = superviseur.pret
export const arreterSidecarCollecte = superviseur.arreter
