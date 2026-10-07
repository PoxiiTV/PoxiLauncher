import type { McContent, McInstance, McIssue } from '@shared/types'
import type { MrVersion } from './modrinth'

// Antes de jugar: lo que haría que el juego se cerrara al abrirse (falta una dependencia, un mod repetido, uno de otra
// versión o dos que chocan). Aquí solo se detecta (sin red ni disco); arreglarlo lo hace el servicio.

const FABRIC_API = 'P7dR8mSH'
/** Quilt usa su propia Fabric API (QFAPI), que cuenta como la de Fabric */
const QUILT_API = 'qvIfYCYJ'

const loaderOk = (loader: McInstance['loader'], loaders: string[]): boolean => loaders.includes(loader) || (loader === 'quilt' && loaders.includes('fabric'))
/** De dos copias, la de versión más alta */
const newest = (a: McContent, b: McContent): number => (b.version ?? '').localeCompare(a.version ?? '', undefined, { numeric: true })

/**
 * versions: lo que Modrinth dice de la versión instalada de cada mod (por versionId). null = sin conexión: entonces
 * solo se miran dependencias y repetidos.
 */
export function findIssues(items: McContent[], versions: Map<string, MrVersion> | null, inst: Pick<McInstance, 'loader' | 'version'>): McIssue[] {
  // En vanilla los mods ni se cargan
  if (inst.loader === 'vanilla') return []
  const mods = items.filter((c) => c.kind === 'mod')
  const on = mods.filter((c) => c.enabled)
  const byProject = new Map<string, McContent[]>()
  for (const c of mods) if (c.projectId) byProject.set(c.projectId, [...(byProject.get(c.projectId) ?? []), c])
  const enabled = (id: string): McContent | undefined => byProject.get(id)?.find((c) => c.enabled)
  const issues: McIssue[] = []

  // El mismo mod dos veces: se queda el más nuevo
  for (const list of byProject.values()) {
    const both = list.filter((c) => c.enabled).sort(newest)
    if (both.length > 1) issues.push({ kind: 'duplicate', mod: both[0].title, other: both.slice(1).map((c) => c.file).join(', '), fix: 'disable', files: both.slice(1).map((c) => c.file) })
  }

  // Dependencias: desactivada (se activa) o que falta (se instala). Una vez cada una
  const seen = new Set<string>()
  for (const c of on) {
    for (const req of c.requires ?? []) {
      if (seen.has(req) || enabled(req)) continue
      if (req === FABRIC_API && inst.loader === 'quilt' && enabled(QUILT_API)) continue
      seen.add(req)
      const off = byProject.get(req)?.[0]
      if (off) issues.push({ kind: 'disabledDep', mod: c.title, other: off.title, fix: 'enable', files: [off.file] })
      else issues.push({ kind: 'missingDep', mod: c.title, other: req, fix: 'install', projectId: req })
    }
  }

  if (!versions) return issues
  const pairs = new Set<string>()
  for (const c of on) {
    const v = c.versionId ? versions.get(c.versionId) : undefined
    if (!v) continue
    // Hecho para otra versión de Minecraft u otro loader
    if (!v.game_versions.includes(inst.version) || !loaderOk(inst.loader, v.loaders)) issues.push({ kind: 'wrongVersion', mod: c.title, fix: 'update', files: [c.file], projectId: c.projectId })
    // Modrinth dice que no puede ir con otro que tienes
    for (const d of v.dependencies) {
      const other = d.dependency_type === 'incompatible' && d.project_id ? enabled(d.project_id) : undefined
      if (!other || other === c) continue
      const key = [c.file, other.file].sort().join('|')
      if (pairs.has(key)) continue
      pairs.add(key)
      issues.push({ kind: 'incompatible', mod: c.title, other: other.title, fix: 'disable', files: [other.file] })
    }
  }
  return issues
}
