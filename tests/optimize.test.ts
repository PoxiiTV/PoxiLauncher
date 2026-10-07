import { describe, expect, it } from 'vitest'
import type { McContent } from '../src/shared/types'
import { decideOptimize, PERF_MODS } from '../src/main/minecraft/optimize'
import type { MrVersion } from '../src/main/minecraft/modrinth'

const ver = (id: string, incompatible: string[] = []): MrVersion =>
  ({
    id: `v-${id}`,
    project_id: id,
    name: id,
    version_number: '1.0',
    version_type: 'release',
    date_published: '',
    loaders: ['fabric'],
    game_versions: ['1.21.8'],
    files: [],
    dependencies: incompatible.map((p) => ({ project_id: p, version_id: null, file_name: null, dependency_type: 'incompatible' as const }))
  }) as MrVersion
const mod = (title: string, projectId?: string, file = `${title}.jar`): McContent => ({ kind: 'mod', file, enabled: true, sha1: 'x', size: 1, title, projectId })
const all = (except: string[] = []): Map<string, MrVersion | undefined> => new Map(PERF_MODS.map((m) => [m.id, except.includes(m.id) ? undefined : ver(m.id)]))
const byKey = (items: ReturnType<typeof decideOptimize>): Record<string, string> => Object.fromEntries(items.map((i) => [i.key, i.status]))

describe('optimizar', () => {
  it('instancia sin nada: todo lo que existe, y de Sodium/Embeddium solo Sodium', () => {
    const r = byKey(decideOptimize(all(), [], new Map()))
    expect(r.sodium).toBe('add')
    expect(r.embeddium).toBeUndefined()
    expect(r.lithium).toBe('add')
  })

  it('sin Sodium para esa versión: Embeddium en su lugar', () => {
    const r = byKey(decideOptimize(all(['AANobbMI']), [], new Map()))
    expect(r.sodium).toBeUndefined()
    expect(r.embeddium).toBe('add')
  })

  it('lo que ya tienes sale como instalado; con Embeddium puesto no se propone Sodium', () => {
    const r = byKey(decideOptimize(all(), [mod('Embeddium', 'sk9rgfiA'), mod('Lithium', 'gvQqBUqZ')], new Map()))
    expect(r.embeddium).toBe('have')
    expect(r.sodium).toBeUndefined()
    expect(r.lithium).toBe('have')
  })

  it('OptiFine puesto a mano choca con el motor de dibujo, pero no con lo demás', () => {
    const items = decideOptimize(all(), [mod('OptiFine_1.21.8_HD_U_J6', undefined, 'OptiFine_1.21.8_HD_U_J6.jar')], new Map())
    const sodium = items.find((i) => i.key === 'sodium')!
    expect(sodium.status).toBe('conflict')
    expect(sodium.with).toMatch(/OptiFine/)
    expect(byKey(items).ferritecore).toBe('add')
  })

  it('lo que Modrinth marca como incompatible con algo tuyo, no se instala', () => {
    const best = all()
    best.set('nmDcB62a', ver('nmDcB62a', ['XYZ12345']))
    const items = decideOptimize(best, [mod('Otro mod', 'XYZ12345')], new Map())
    expect(items.find((i) => i.key === 'modernfix')).toMatchObject({ status: 'conflict', with: 'Otro mod' })
  })

  it('ningún motor de dibujo para esta versión: se dice', () => {
    const r = byKey(decideOptimize(all(['AANobbMI', 'sk9rgfiA', 'LQ3K71Q1']), [], new Map()))
    expect(r.sodium).toBe('none')
    expect(r.dynamicfps).toBe('none')
  })
})
