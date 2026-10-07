// window.api (el renderer): en tsconfig.node el index.d.ts del preload queda tapado por su index.ts
/// <reference path="../src/preload/index.d.ts" />
import { describe, it, expect, vi, beforeEach } from 'vitest'

const st = vi.hoisted(() => ({ s: { mc: null as { running: string | null } | null, update: null as unknown }, server: { available: true, version: '5.7.2' }, calls: 0 }))
vi.mock('../src/renderer/src/api', () => ({ invoke: vi.fn(async () => (st.calls++, st.server)) }))
vi.mock('../src/renderer/src/store', () => ({
  getState: () => st.s,
  setState: (p: Record<string, unknown>) => Object.assign(st.s, p)
}))

import { offerUpdate } from '../src/renderer/src/lib/update'

describe('aviso de versión nueva con la app abierta', () => {
  beforeEach(() => {
    st.s = { mc: null, update: null }
    st.calls = 0
  })

  it('jugando a Minecraft no sale (ni pregunta); al cerrar el juego, sí', async () => {
    st.s.mc = { running: 'a1b2c3d4' }
    await offerUpdate()
    expect(st.s.update).toBeNull()
    expect(st.calls).toBe(0)
    st.s.mc = { running: null }
    await offerUpdate()
    expect(st.s.update).toEqual({ state: 'available', version: '5.7.2', progress: 0 })
  })

  it('«Más tarde»: no vuelve a salir para esa versión, sí para la siguiente', async () => {
    await offerUpdate() // ya se enseñó la 5.7.2 en la prueba anterior
    expect(st.s.update).toBeNull()
    st.server = { available: true, version: '5.7.3' }
    await offerUpdate()
    expect(st.s.update).toMatchObject({ version: '5.7.3' })
  })

  it('con el aviso ya abierto (o descargando) no se toca', async () => {
    const open = { state: 'downloading', version: '5.7.3', progress: 0.4 }
    st.s.update = open
    st.server = { available: true, version: '5.7.4' }
    await offerUpdate()
    expect(st.s.update).toBe(open)
  })

  it('sin versión nueva, nada', async () => {
    st.server = { available: false } as never
    await offerUpdate()
    expect(st.s.update).toBeNull()
  })
})
