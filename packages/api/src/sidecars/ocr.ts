import { SIDECAR_PADDLE } from '@alambic/condensation'
import { env, MOTEUR_OCR } from '../config/env'
import { creerSuperviseur } from './superviseur'

const superviseur = creerSuperviseur({
  nom: 'sidecar-ocr',
  actif: env.MOTEUR_OCR === MOTEUR_OCR.paddleocr,
  commande: env.CHEMIN_PYTHON_OCR,
  arguments: [
    SIDECAR_PADDLE.chemin,
    '--port',
    String(env.PORT_SIDECAR_OCR),
    '--detection',
    env.DETECTION_OCR,
  ],
  urlSante: `http://127.0.0.1:${env.PORT_SIDECAR_OCR}${SIDECAR_PADDLE.routeSante}`,
})

export const demarrerSidecarOcr = superviseur.demarrer
export const sidecarOcrPret = superviseur.pret
export const arreterSidecarOcr = superviseur.arreter
