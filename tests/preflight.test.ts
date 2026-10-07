import { describe, expect, it } from 'vitest'
import type { McContent } from '../src/shared/types'
import { findIssues } from '../src/main/minecraft/preflight'
import type { MrVersion } from '../src/main/minecraft/modrinth'

const mod = (title: string, projectId: string, extra: Partial<McContent> = {}): McContent => ({
  kind: 'mod',
  file: `${title}.jar`,
  enabled: true,
  sha1: title,
  size: 1,
  title,
  projectId,
  versionId: `v-${projectId}`,
  ...extra
})
const ver = (projectId: string, game = ['1.21.8'], loaders = ['fabric'], incompatible: string[] = []): MrVersion =>
  ({
    id: `v-${projectId}`,
    project_id: projectId,
    game_versions: game,
    loaders,
    dependencies: incompatible.map((p) => ({ project_id: p, version_id: null, file_name: null, dependency_type: 'incompatible' as const }))
  }) as unknown as MrVersion
const fabric = { loader: 'fabric' as const, version: '1.21.8' }

describe('antes de jugar', () => {
  it('todo bien: sin avisos', () => {
    const items = [mod('Sodium', 'AANobbMI'), mod('Iris', 'YL57xq9U', { requires: ['AANobbMI'] })]
    expect(findIssues(items, new Map(items.map((c) => [c.versionId!, ver(c.projectId!)])), fabric)).toEqual([])
  })

  it('falta una dependencia (se instala) o está desactivada (se activa)', () => {
    const items = [mod('Iris', 'YL57xq9U', { requires: ['AANobbMI', 'P7dR8mSH'] }), mod('Fabric API', 'P7dR8mSH', { enabled: false })]
    const issues = findIssues(items, null, fabric)
    expect(issues).toContainEqual({ kind: 'missingDep', mod: 'Iris', other: 'AANobbMI', fix: 'install', projectId: 'AANobbMI' })
    expect(issues).toContainEqual({ kind: 'disabledDep', mod: 'Iris', other: 'Fabric API', fix: 'enable', files: ['Fabric API.jar'] })
  })

  it('el mismo mod dos veces: se desactiva el más viejo', () => {
    const items = [mod('Sodium', 'AANobbMI', { file: 'sodium-0.6.jar', version: '0.6.13' }), mod('Sodium', 'AANobbMI', { file: 'sodium-0.7.jar', version: '0.7.3' })]
    expect(findIssues(items, null, fabric)).toEqual([{ kind: 'duplicate', mod: 'Sodium', other: 'sodium-0.6.jar', fix: 'disable', files: ['sodium-0.6.jar'] }])
  })

  it('de otra versión o de otro loader; Quilt acepta mods de Fabric', () => {
    const items = [mod('Viejo', 'AAAA1111'), mod('Forge', 'BBBB2222'), mod('Bueno', 'CCCC3333')]
    const versions = new Map([
      ['v-AAAA1111', ver('AAAA1111', ['1.20.1'])],
      ['v-BBBB2222', ver('BBBB2222', ['1.21.8'], ['forge'])],
      ['v-CCCC3333', ver('CCCC3333')]
    ])
    expect(findIssues(items, versions, fabric).map((i) => [i.kind, i.mod])).toEqual([
      ['wrongVersion', 'Viejo'],
      ['wrongVersion', 'Forge']
    ])
    expect(findIssues([items[2]], versions, { loader: 'quilt', version: '1.21.8' })).toEqual([])
  })

  it('Quilt con su propia Fabric API no pide la de Fabric', () => {
    const items = [mod('Algo', 'DDDD4444', { requires: ['P7dR8mSH'] }), mod('QFAPI', 'qvIfYCYJ')]
    expect(findIssues(items, null, { loader: 'quilt', version: '1.21.8' })).toEqual([])
  })

  it('dos que chocan: un solo aviso por pareja', () => {
    const items = [mod('Sodium', 'AANobbMI'), mod('Embeddium', 'sk9rgfiA')]
    const versions = new Map([
      ['v-AANobbMI', ver('AANobbMI', ['1.21.8'], ['fabric'], ['sk9rgfiA'])],
      ['v-sk9rgfiA', ver('sk9rgfiA', ['1.21.8'], ['fabric'], ['AANobbMI'])]
    ])
    expect(findIssues(items, versions, fabric)).toEqual([{ kind: 'incompatible', mod: 'Sodium', other: 'Embeddium', fix: 'disable', files: ['Embeddium.jar'] }])
  })

  it('vanilla: nada (los mods ni se cargan)', () => {
    expect(findIssues([mod('Iris', 'YL57xq9U', { requires: ['AANobbMI'] })], null, { loader: 'vanilla', version: '1.21.8' })).toEqual([])
  })
})
