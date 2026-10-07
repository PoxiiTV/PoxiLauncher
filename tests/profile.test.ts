import { describe, expect, it } from 'vitest'
import { imageType, richParts, sanitizeProfile, shownName } from '../src/shared/profile'

describe('perfil personalizable', () => {
  it('solo se queda lo que se sabe pintar', () => {
    const p = sanitizeProfile({
      displayName: '  Poxi el Grande\n ',
      pronouns: 'él',
      about: 'Hola\n**mundo**\u0007',
      name: { colors: ['#ff0000', 'red', '#00ff00', '#0000ff'], effect: 'neon', font: 'papyrus' },
      banner: { kind: 'color', colors: ['#112233'] },
      theme: ['#000000', '#ffffff'],
      frame: 'gold',
      custom: { emoji: '🎮', text: 'Jugando a todo', until: null },
      extra: 'fuera'
    })
    expect(p).toEqual({
      displayName: 'Poxi el Grande',
      pronouns: 'él',
      about: 'Hola\n**mundo**',
      name: { colors: ['#ff0000', '#00ff00'], effect: 'neon', font: 'default' },
      banner: { kind: 'color', colors: ['#112233'] },
      theme: ['#000000', '#ffffff'],
      frame: 'gold',
      custom: { emoji: '🎮', text: 'Jugando a todo', until: null }
    })
  })

  it('nada raro pasa: CSS inyectado, tipos malos, estado caducado', () => {
    expect(sanitizeProfile({ name: { colors: ['red; background:url(x)'] } })).toEqual({})
    expect(sanitizeProfile({ banner: { kind: 'game', gameId: 42 } })).toEqual({})
    expect(sanitizeProfile({ theme: ['#000000'] })).toEqual({})
    expect(sanitizeProfile({ frame: 'none', status: 'dnd' })).toEqual({})
    expect(sanitizeProfile({ custom: { emoji: '', text: 'viejo', until: 1000 } }, 2000)).toEqual({})
    expect(sanitizeProfile(null)).toEqual({})
    expect(sanitizeProfile('x')).toEqual({})
  })

  it('nombre que se ve: apodo tuyo, luego el suyo, luego el usuario', () => {
    expect(shownName('poxi', { displayName: 'Poxi 👑' }, 'Mi colega')).toBe('Mi colega')
    expect(shownName('poxi', { displayName: 'Poxi 👑' })).toBe('Poxi 👑')
    expect(shownName('poxi')).toBe('poxi')
  })

  it('formato del «Sobre mí» sin HTML', () => {
    expect(richParts('Hola **fuerte** y *suave* con ||sorpresa|| <b>no</b>')).toEqual([
      { kind: 'text', text: 'Hola ' },
      { kind: 'bold', text: 'fuerte' },
      { kind: 'text', text: ' y ' },
      { kind: 'italic', text: 'suave' },
      { kind: 'text', text: ' con ' },
      { kind: 'spoiler', text: 'sorpresa' },
      { kind: 'text', text: ' <b>no</b>' }
    ])
  })
})

describe('banner de imagen o GIF', () => {
  it('encuadre dentro de los límites y tipo por la cabecera', () => {
    expect(sanitizeProfile({ banner: { kind: 'image', v: '0123456789abcdef', x: 150, y: -5, zoom: 9 } })).toEqual({ banner: { kind: 'image', v: '0123456789abcdef', x: 100, y: 0, zoom: 3 } })
    expect(sanitizeProfile({ banner: { kind: 'image', v: 'x' } })).toEqual({})
    const enc = (s: string): Uint8Array => new Uint8Array([...s].map((c) => c.charCodeAt(0)).concat(new Array(20).fill(0)))
    expect(imageType(enc('GIF89a'))).toBe('gif')
    expect(imageType(enc('<html><body>'))).toBeNull()
    expect(imageType(new Uint8Array([0xff, 0xd8, 0xff, ...new Array(20).fill(0)]))).toBe('jpg')
  })
})
