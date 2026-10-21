import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { BoiteNormalisee } from '../mots'
import { construireLot, premieresEtiquettes } from './fenetres'

const speciaux = { debut: 0, fin: 2, bourrage: 1 }

describe('construireLot', () => {
  it('encadre une facture courte de ses jetons speciaux, boites vides comprises', () => {
    const lot = construireLot(
      [[10, 11], [12]],
      [
        [1, 2, 3, 4],
        [5, 6, 7, 8],
      ],
      speciaux,
    )
    assert.equal(lot.fenetres, 1)
    assert.deepEqual([...lot.ids].map(Number), [0, 10, 11, 12, 2])
    assert.deepEqual([...lot.mots], [-1, 0, 0, 1, -1])
    assert.deepEqual([...lot.boites.slice(0, 8)].map(Number), [0, 0, 0, 0, 1, 2, 3, 4])
  })

  it('coupe une facture longue en fenetres qui reprennent 128 jetons', () => {
    // 600 mots d'un jeton : une fenetre de 510, puis une qui repart du 382e.
    const jetons = Array.from({ length: 600 }, (_, rang) => [100 + rang])
    const boites = jetons.map((): BoiteNormalisee => [0, 0, 1, 1])
    const lot = construireLot(jetons, boites, speciaux)
    assert.equal(lot.fenetres, 2)
    assert.equal(lot.longueur, 512)
    assert.equal(Number(lot.ids[512 + 1]), 100 + 382)
    // La seconde fenetre est plus courte (600 - 382 = 218 jetons) : bourree, et masquee au-dela.
    assert.equal(Number(lot.ids[512 + 218]), 100 + 599)
    assert.equal(Number(lot.ids[512 + 219]), speciaux.fin)
    assert.equal(Number(lot.ids[512 + 220]), speciaux.bourrage)
    assert.equal(Number(lot.masque[512 + 219]), 1)
    assert.equal(Number(lot.masque[512 + 220]), 0)
  })
})

describe('premieresEtiquettes', () => {
  it('prend le premier jeton de chaque mot et la probabilite de sa classe', () => {
    const lot = construireLot(
      [[10, 11], [12]],
      [
        [0, 0, 1, 1],
        [0, 0, 1, 1],
      ],
      speciaux,
    )
    // Deux classes ; logits par position : <s>, 10, 11, 12, </s>.
    const logits = Float32Array.from([0, 0, 0, 2, 9, 0, 1, 1, 0, 0])
    const etiquettes = premieresEtiquettes(logits, lot, 2, 3)
    assert.equal(etiquettes[0]?.classe, 1)
    assert.ok(Math.abs((etiquettes[0]?.score ?? 0) - 1 / (1 + Math.exp(-2))) < 1e-6)
    assert.equal(etiquettes[1]?.classe, 0)
    assert.equal(etiquettes[2], null)
  })
})
