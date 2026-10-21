import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { montantDe } from './montant'

describe('montantDe', () => {
  it('lit les formats imprimes sur un recu', () => {
    assert.equal(montantDe('8,91'), 8.91)
    assert.equal(montantDe('$12.00'), 12)
    assert.equal(montantDe('$10.2'), 10.2)
    assert.equal(montantDe('RABAIS -2,50'), -2.5)
    assert.equal(montantDe('TOTAL 38, 23'), 38.23)
  })

  it('rend le dernier montant de la ligne', () => {
    assert.equal(montantDe('TPS 5% 0,39'), 0.39)
    assert.equal(montantDe('1.5 KG @ 4,39/KG 6,59'), 6.59)
  })

  it('lit les milliers separes par une espace', () => {
    assert.equal(montantDe('TOTAL 1 234,56'), 1234.56)
    assert.equal(montantDe('TOTAL 1 234.56'), 1234.56)
  })

  it('lit les milliers a l anglaise et a l europeenne', () => {
    assert.equal(montantDe('TOTAL 1,234.56'), 1234.56)
    assert.equal(montantDe('TOTAL 12,345.67'), 12345.67)
    assert.equal(montantDe('TOTAL 1.234,56'), 1234.56)
  })

  it('ignore ce qui n est pas un montant', () => {
    assert.equal(montantDe('TEL 418-527-9444'), null)
    assert.equal(montantDe('18:53:03'), null)
    assert.equal(montantDe('TVQ 9,975%'), null)
    assert.equal(montantDe('CARTE 4834-8741'), null)
    assert.equal(montantDe('TEL 418.527.9444'), null)
    assert.equal(montantDe('TOTAL 1,234'), null)
  })
})
