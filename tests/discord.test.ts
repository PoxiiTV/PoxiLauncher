import { describe, expect, it } from 'vitest'
import { frame, toDiscord } from '../src/main/system/discord'

describe('presencia en Discord', () => {
  it('mensaje con su cabecera (tipo y longitud) y el JSON', () => {
    const b = frame(1, { cmd: 'SET_ACTIVITY' })
    expect(b.readInt32LE(0)).toBe(1)
    expect(b.readInt32LE(4)).toBe(b.length - 8)
    expect(JSON.parse(b.subarray(8).toString())).toEqual({ cmd: 'SET_ACTIVITY' })
  })

  it('jugando: juego, tiempo desde que empezó y su carátula con el logo pequeño', () => {
    const a = toDiscord({ details: 'Lethal Company', state: 'Jugando', startedAt: 1_700_000_000_500, largeImage: 'https://x/c.jpg' })
    expect(a).toMatchObject({
      details: 'Lethal Company',
      state: 'Jugando',
      timestamps: { start: 1_700_000_000 },
      assets: { large_image: 'https://x/c.jpg', small_image: 'poxilauncher' }
    })
  })

  it('sin jugar: solo el logo de PoxiLauncher', () => {
    const a = toDiscord({ details: 'Buscando a qué jugar' })
    expect(a.assets).toEqual({ large_image: 'poxilauncher', large_text: 'PoxiLauncher' })
    expect(a).not.toHaveProperty('timestamps')
  })
})
