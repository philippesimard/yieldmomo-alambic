import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { BlocTexte } from '@alambic/noyau'
import { reconnaitreDevise } from './devise'

const recu = (...lignes: string[]): BlocTexte[][] =>
  lignes.map((texte) => [{ texte, cadre: { x: 0, y: 0, largeur: 100, hauteur: 10 }, confiance: 1 }])

describe('reconnaitreDevise', () => {
  it('lit un code imprime', () => {
    assert.equal(reconnaitreDevise(recu('TOTAL 12,50 USD'))?.valeur, 'USD')
  })

  it('deduit le dollar canadien d un recu quebecois sans symbole', () => {
    const devise = reconnaitreDevise(
      recu('SOUS-TOTAL 33,25', 'TPS 1,66', 'TVQ 3,32', 'TOTAL 38,23'),
    )
    assert.equal(devise?.valeur, 'CAD')
    assert.ok((devise?.confiance ?? 1) < 1)
  })

  it('deduit le dollar canadien d un code postal', () => {
    assert.equal(reconnaitreDevise(recu('Quebec QC G1V 3V7', 'TOTAL 12,50'))?.valeur, 'CAD')
  })

  it('prefere un symbole lu a une deduction', () => {
    assert.equal(reconnaitreDevise(recu('TPS 0,50', 'TOTAL 12,50 €'))?.valeur, 'EUR')
  })

  it('ne devine rien sans indice', () => {
    assert.equal(reconnaitreDevise(recu('MERCI', 'TOTAL 12,50')), null)
  })
})
