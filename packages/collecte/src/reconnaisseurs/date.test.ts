import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { BlocTexte } from '@alambic/noyau'
import { reconnaitreDate } from './date'

const ligne = (texte: string): BlocTexte[] => [
  { texte, cadre: { x: 0, y: 0, largeur: 100, hauteur: 10 }, confiance: 1 },
]

describe('reconnaitreDate', () => {
  it('lit une date ISO suivie de l heure', () => {
    assert.equal(reconnaitreDate([ligne('2026-08-27 22:04:07')])?.valeur, '2026-08-27')
  })

  it('lit une date ISO collee a l heure par l ocr', () => {
    assert.equal(reconnaitreDate([ligne('2026-08-2722:04:07')])?.valeur, '2026-08-27')
  })

  it('ne prend pas un nombre trop long pour une date', () => {
    assert.equal(reconnaitreDate([ligne('2026-08-2724')]), null)
  })
})
