import { describe, expect, it } from 'vitest'
import { hexToHsv, hsvToHex, parseHex } from '../src/renderer/src/lib/color'

describe('selector de color', () => {
  it('hex ↔ HSV ida y vuelta', () => {
    for (const hex of ['#ffffff', '#000000', '#ff0000', '#22d3ee', '#8b5cf6', '#fbbf24', '#123456']) expect(hsvToHex(hexToHsv(hex))).toBe(hex)
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 })
    expect(hexToHsv('#00ff00').h).toBe(120)
    expect(hexToHsv('#808080').s).toBe(0)
  })

  it('lee lo que se escribe a mano', () => {
    expect(parseHex('#ABC')).toBe('#aabbcc')
    expect(parseHex(' 22d3ee ')).toBe('#22d3ee')
    expect(parseHex('#12345')).toBeNull()
    expect(parseHex('rojo')).toBeNull()
  })
})
