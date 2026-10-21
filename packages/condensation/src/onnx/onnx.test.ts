import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { boitesDepuisCarte, dimensionsDetection } from './detection'
import { redimensionner, tourner } from './pixels'
import { decoderCtc, largeursReconnaissance } from './reconnaissance'
import { coins, rectangleMinimal } from './rectangle'

const gris = (largeur: number, hauteur: number, valeurs: number[]) => ({
  pixels: Uint8Array.from(valeurs),
  largeur,
  hauteur,
})

describe('redimensionner', () => {
  it('reproduit cv2.INTER_LINEAR', () => {
    // Valeurs rendues par cv2.resize(np.array([[0, 255]], np.uint8), (4, 1)).
    assert.deepEqual([...redimensionner(gris(2, 1, [0, 255]), 4, 1).pixels], [0, 64, 191, 255])
  })

  it('rend la meme image a la meme taille', () => {
    const image = gris(2, 1, [3, 4])
    assert.equal(redimensionner(image, 2, 1), image)
  })
})

describe('tourner', () => {
  it('tourne d un quart de tour antihoraire, comme np.rot90', () => {
    const tournee = tourner(gris(2, 1, [1, 2]))
    assert.deepEqual([tournee.largeur, tournee.hauteur, ...tournee.pixels], [1, 2, 2, 1])
  })
})

describe('dimensionsDetection', () => {
  it('borne le plus long cote a 2016 et arrondit au multiple de 32', () => {
    assert.deepEqual(dimensionsDetection(2000, 6000), { largeur: 672, hauteur: 2016 })
    assert.deepEqual(dimensionsDetection(859, 1926), { largeur: 864, hauteur: 1920 })
  })

  it('arrondit les demis au pair, comme Python', () => {
    assert.deepEqual(dimensionsDetection(48, 80), { largeur: 64, hauteur: 64 })
  })
})

describe('boitesDepuisCarte', () => {
  const carte = (largeur: number, hauteur: number, zones: number[][]): Float32Array => {
    const valeurs = new Float32Array(largeur * hauteur)
    for (const [x0, y0, x1, y1, p] of zones as [number, number, number, number, number][]) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) valeurs[y * largeur + x] = p
    }
    return valeurs
  }

  it('elargit une ligne detectee comme Paddle', () => {
    const [boite] = boitesDepuisCarte(carte(40, 20, [[5, 8, 30, 12, 1]]), 40, 20, 40, 20)
    // Distance d'elargissement : 25 x 4 x 1,5 / (2 x 29) = 2,59 px de chaque cote.
    assert.deepEqual([boite?.x0, boite?.y0, boite?.x1, boite?.y1], [2, 5, 33, 15])
  })

  it('ecarte les regions trop fines et les regions peu sures', () => {
    const boites = boitesDepuisCarte(
      carte(40, 20, [
        [2, 2, 20, 3, 1],
        [5, 10, 30, 15, 0.5],
      ]),
      40,
      20,
      40,
      20,
    )
    assert.deepEqual(boites, [])
  })

  it('ramene les boites a la taille de l image source', () => {
    const [boite] = boitesDepuisCarte(carte(40, 20, [[5, 8, 30, 12, 1]]), 40, 20, 80, 40)
    // (5 - 2,59) x 2 = 4,83 et (30 + 2,59) x 2 = 65,17.
    assert.deepEqual([boite?.x0, boite?.x1], [5, 65])
  })
})

describe('rectangleMinimal', () => {
  it('suit l inclinaison d une ligne penchee', () => {
    // Une barre de 20 x 2 inclinee a 45 degres : son rectangle droit serait 16 fois plus grand.
    const points = [
      { x: 0, y: 0 },
      { x: 14, y: 14 },
      { x: -1.4, y: 1.4 },
      { x: 12.6, y: 15.4 },
    ]
    const rectangle = rectangleMinimal(points)
    const aire = (rectangle.u1 - rectangle.u0) * (rectangle.v1 - rectangle.v0)
    assert.ok(Math.abs(aire - 19.8 * 1.98) < 0.5)
  })

  it('ordonne les coins haut-gauche, haut-droit, bas-droit, bas-gauche', () => {
    const rectangle = rectangleMinimal([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
      { x: 0, y: 4 },
    ])
    assert.deepEqual(
      coins(rectangle).map(({ x, y }) => [Math.round(x), Math.round(y)]),
      [
        [0, 0],
        [10, 0],
        [10, 4],
        [0, 4],
      ],
    )
  })
})

describe('largeursReconnaissance', () => {
  it('lit au moins sur 320 px, et au plus sur 3200', () => {
    assert.deepEqual(largeursReconnaissance(100, 48), { redimensionnee: 100, totale: 320 })
    assert.deepEqual(largeursReconnaissance(1000, 48), { redimensionnee: 1000, totale: 1000 })
    assert.deepEqual(largeursReconnaissance(10000, 48), { redimensionnee: 3200, totale: 3200 })
  })
})

describe('decoderCtc', () => {
  it('fusionne les repetitions, retire les blancs et moyenne la confiance', () => {
    const caracteres = ['blank', 'a', 'b', ' ']
    // Cinq pas : a (0,9), a (0,7), blanc, a (0,8), b (0,6).
    const pas = [
      [0.1, 0.9, 0, 0],
      [0.3, 0.7, 0, 0],
      [0.8, 0.2, 0, 0],
      [0.2, 0.8, 0, 0],
      [0.4, 0, 0.6, 0],
    ]
    const lecture = decoderCtc(Float32Array.from(pas.flat()), 0, pas.length, caracteres)
    assert.equal(lecture.texte, 'aab')
    assert.ok(Math.abs(lecture.confiance - (0.9 + 0.8 + 0.6) / 3) < 1e-6)
  })
})
