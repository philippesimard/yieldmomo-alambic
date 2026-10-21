import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { COHERENCE } from '@alambic/noyau'
import { arbitrer, type MontantLu, type TaxeLue } from './coherence'

// Sans rang de ligne, aucune contrainte de position : chaque cas ne fixe que ce qu'il teste.
const lu = (valeur: number, ligne: number | null = null): MontantLu => ({
  valeur,
  confiance: 0.8,
  ligne,
})

const taxe = (
  montant: number,
  nom: string | null = null,
  taux: number | null = null,
  ligne: number | null = null,
): TaxeLue => ({ nom, taux, montant, confiance: 0.8, ligne })

describe('arbitrer', () => {
  it('dit coherent un bilan qui se ferme et y gagne en confiance', () => {
    const arbitrage = arbitrer({
      totaux: [lu(19.33)],
      sousTotaux: [lu(16.81)],
      taxes: [taxe(0.84, 'TPS'), taxe(1.68, 'TVQ')],
    })
    assert.equal(arbitrage.coherence, COHERENCE.coherente)
    assert.equal(arbitrage.total?.valeur, 19.33)
    assert.equal(arbitrage.taxes.length, 2)
    assert.ok((arbitrage.total?.confiance ?? 0) > 0.8)
  })

  it('ecarte une taxe qui vaut le total', () => {
    const arbitrage = arbitrer({ totaux: [lu(9)], sousTotaux: [], taxes: [taxe(9)] })
    assert.deepEqual(arbitrage.taxes, [])
    assert.equal(arbitrage.coherence, COHERENCE.indeterminee)
  })

  it('garde une taxe nulle et ferme le bilan sans la taxe impossible', () => {
    const arbitrage = arbitrer({
      totaux: [lu(65.01, 9)],
      sousTotaux: [lu(65.01, 6)],
      taxes: [taxe(0), taxe(65.01)],
    })
    assert.deepEqual(
      arbitrage.taxes.map((t) => t.montant),
      [0],
    )
    assert.equal(arbitrage.coherence, COHERENCE.coherente)
  })

  it('ecarte une taxe superieure a 15 % du sous-total', () => {
    const arbitrage = arbitrer({ totaux: [], sousTotaux: [lu(20)], taxes: [taxe(5), taxe(1)] })
    assert.deepEqual(
      arbitrage.taxes.map((t) => t.montant),
      [1],
    )
  })

  it('prefere le total que le bilan confirme', () => {
    const arbitrage = arbitrer({
      totaux: [lu(0.5), lu(19.33)],
      sousTotaux: [lu(16.81)],
      taxes: [taxe(0.84, 'TPS'), taxe(1.68, 'TVQ')],
    })
    assert.equal(arbitrage.total?.valeur, 19.33)
    assert.equal(arbitrage.coherence, COHERENCE.coherente)
  })

  it('garde la lecture par defaut quand rien ne tranche, et le dit', () => {
    const arbitrage = arbitrer({ totaux: [lu(10), lu(12)], sousTotaux: [lu(5)], taxes: [] })
    assert.equal(arbitrage.total?.valeur, 10)
    assert.equal(arbitrage.coherence, COHERENCE.incoherente)
    assert.ok((arbitrage.total?.confiance ?? 1) < 0.8)
  })

  it('ne prend jamais le sous-total sur la ligne du total', () => {
    const arbitrage = arbitrer({
      totaux: [lu(19.33, 12)],
      sousTotaux: [lu(19.33, 12), lu(16.81, 9)],
      taxes: [taxe(0.84, 'TPS'), taxe(1.68, 'TVQ')],
    })
    assert.equal(arbitrage.sousTotal?.valeur, 16.81)
  })

  it('departage les sous-totaux par le taux de la TPS', () => {
    const arbitrage = arbitrer({
      totaux: [lu(49.1)],
      sousTotaux: [lu(44), lu(42.7)],
      taxes: [taxe(2.14, 'TPS')],
    })
    assert.equal(arbitrage.sousTotal?.valeur, 42.7)
  })

  it('reconnait la TPS a son taux quand le libelle manque', () => {
    const arbitrage = arbitrer({
      totaux: [lu(49.1)],
      sousTotaux: [lu(44), lu(42.7)],
      taxes: [taxe(2.14, null, 0.05)],
    })
    assert.equal(arbitrage.sousTotal?.valeur, 42.7)
  })

  it('ecarte un pourboire etiquete taxe sous le total', () => {
    // Le montant final, pourboire compris, fermerait aussi le bilan avec ce pourboire pris pour
    // une taxe : c'est le vrai total, au-dessus, qui doit l'emporter.
    const arbitrage = arbitrer({
      totaux: [lu(81.1, 12), lu(91.68, 15)],
      sousTotaux: [lu(70.53, 9)],
      taxes: [
        taxe(3.53, 'TPS', null, 10),
        taxe(7.04, 'TVQ', null, 11),
        taxe(10.58, null, null, 14),
      ],
    })
    assert.equal(arbitrage.total?.valeur, 81.1)
    assert.deepEqual(
      arbitrage.taxes.map((t) => t.montant),
      [3.53, 7.04],
    )
    assert.equal(arbitrage.coherence, COHERENCE.coherente)
  })

  it('rend les taxes sans leur rang de ligne', () => {
    const arbitrage = arbitrer({ totaux: [], sousTotaux: [], taxes: [taxe(0.84, 'TPS', null, 3)] })
    assert.deepEqual(Object.keys(arbitrage.taxes[0] ?? {}).sort(), [
      'confiance',
      'montant',
      'nom',
      'taux',
    ])
  })

  it('ne retire jamais une vraie taxe pour fermer le bilan', () => {
    // Le sous-total imprime repete le total, taxes comprises : retirer les taxes fermerait le
    // bilan, a tort.
    const arbitrage = arbitrer({
      totaux: [lu(2.16, 8)],
      sousTotaux: [lu(2.16, 9)],
      taxes: [taxe(0.09, 'TPS'), taxe(0.18, 'TVQ')],
    })
    assert.equal(arbitrage.taxes.length, 2)
    assert.equal(arbitrage.coherence, COHERENCE.incoherente)
  })
})
