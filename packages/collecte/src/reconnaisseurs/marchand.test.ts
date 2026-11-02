import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { BlocTexte } from '@alambic/noyau'
import { reconnaitreMarchand } from './marchand'

const recu = (...lignes: string[]): BlocTexte[][] =>
  lignes.map((texte) => [{ texte, cadre: { x: 0, y: 0, largeur: 100, hauteur: 10 }, confiance: 1 }])

describe('reconnaitreMarchand', () => {
  it('prefere une enseigne connue a un logo mal lu', () => {
    assert.equal(reconnaitreMarchand(recu('ESN', 'MYRAND', 'MAXI', 'TOTAL 12,50'))?.valeur, 'MAXI')
  })

  it('rend l enseigne seule quand l ocr l a fondue avec l adresse', () => {
    const lignes = recu('MAXI STE-FOY 3440, CH QUATRE BOURGEOIS, QUEBEC, 418-653-6241', '6,78')
    assert.equal(reconnaitreMarchand(lignes)?.valeur, 'MAXI')
  })

  it('ne prend pas un article pour le commerce', () => {
    // POUTINE est un mot-cle du catalogue, mais il suit le premier montant : c'est un article.
    const lignes = recu('Bienvenue', 'BURGER 12,50', 'POUTINE', '8,00')
    assert.equal(reconnaitreMarchand(lignes)?.valeur, 'Bienvenue')
  })

  it('retombe sur la premiere ligne qui ressemble a un nom', () => {
    assert.equal(reconnaitreMarchand(recu('Chez Rita', 'TOTAL 12,50'))?.valeur, 'Chez Rita')
  })
})
