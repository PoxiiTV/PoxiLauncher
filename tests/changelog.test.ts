import { describe, expect, it } from 'vitest'
import { changesFor, changesSince, majorChanges } from '../src/renderer/src/lib/changelog'
import { isNewer } from '../src/shared/version'

// Las novedades salen del CHANGELOG.md real (el que va dentro de la app)
describe('novedades dentro de la app', () => {
  it('lee la versión en el idioma pedido, con emoji, título y texto limpio', () => {
    expect(changesFor('0.1.0', 'es')[0]).toMatchObject({ emoji: '🟩', title: 'Punto de partida' })
    expect(changesFor('0.1.0', 'en')[0].title).toBe('Starting point')
    for (const lang of ['es', 'en'] as const) for (const c of changesFor('0.1.0', lang)) expect(c.text).toMatch(/^[A-ZÁÉÍÓÚÑ¿¡]/)
    expect(changesFor('9.9.9', 'es')).toEqual([])
  })

  it('desde una versión, solo lo nuevo; la ventana enseña toda la versión principal sin repetir', () => {
    expect(changesSince('0.0.0', '0.1.0', 'es').map((c) => c.title)).toEqual(['Punto de partida'])
    expect(changesSince('0.1.0', '0.1.0', 'es')).toEqual([])
    const all = majorChanges('0.1.0', 'en')
    expect(all.length).toBeGreaterThan(0)
    expect(new Set(all.map((c) => c.title)).size).toBe(all.length)
  })
})

describe('versiones', () => {
  it('compara número a número, no como texto', () => {
    expect(isNewer('0.10.0', '0.9.9')).toBe(true)
    expect(isNewer('1.0.0', '1.0.0')).toBe(false)
    expect(isNewer('0.1.0', '0.1.1')).toBe(false)
  })
})
