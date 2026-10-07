import type { McContent, McOptimizeItem } from '@shared/types'
import type { MrVersion } from './modrinth'

// «Optimizar»: los mods de rendimiento de Modrinth que valen para una instancia. Aquí solo la decisión (sin red ni
// disco, para poder probarla); buscar las versiones e instalar lo hace el servicio.

/** Por orden de preferencia. Del grupo «renderer» solo puede ir uno (Sodium y Embeddium hacen lo mismo y chocan) */
export const PERF_MODS: { id: string; key: string; renderer?: boolean }[] = [
  { id: 'AANobbMI', key: 'sodium', renderer: true },
  { id: 'sk9rgfiA', key: 'embeddium', renderer: true },
  { id: 'gvQqBUqZ', key: 'lithium' },
  { id: 'uXXizFIs', key: 'ferritecore' },
  { id: 'nmDcB62a', key: 'modernfix' },
  { id: '5ZwdcRci', key: 'immediatelyfast' },
  { id: 'NNAgCjsB', key: 'entityculling' },
  { id: 'LQ3K71Q1', key: 'dynamicfps' }
]

/** Mods que cambian el motor de dibujo como Sodium (puestos a mano o de fuera de Modrinth) */
const OTHER_RENDERER = /optifine|optifabric|rubidium|canvas-|vulkanmod/i

/**
 * Qué hacer con cada mod de rendimiento.
 * best: la versión de Modrinth que vale para la instancia (undefined = no hay). installed: lo que ya tiene.
 */
export function decideOptimize(best: Map<string, MrVersion | undefined>, installed: McContent[], titles: Map<string, string>): McOptimizeItem[] {
  const have = new Map(installed.filter((c) => c.projectId).map((c) => [c.projectId!, c]))
  const name = (id: string): string => titles.get(id) ?? id
  // Un motor de dibujo que ya está (de la lista o de fuera): los demás de ese grupo, fuera
  const rendererHave = PERF_MODS.find((m) => m.renderer && have.has(m.id))
  const rendererOther = installed.find((c) => c.enabled && OTHER_RENDERER.test(`${c.title} ${c.file}`))
  let rendererPicked = rendererHave?.id ?? null
  const out: McOptimizeItem[] = []
  for (const m of PERF_MODS) {
    const base = { projectId: m.id, key: m.key, title: name(m.id) }
    if (have.has(m.id)) {
      out.push({ ...base, status: 'have' })
      continue
    }
    const v = best.get(m.id)
    if (m.renderer) {
      // Del grupo solo se enseña uno: el que ya está o el primero que existe para esta versión
      if (rendererPicked && rendererPicked !== m.id) continue
      if (rendererOther) {
        out.push({ ...base, status: 'conflict', with: rendererOther.title })
        rendererPicked = m.id
        continue
      }
      if (!v) continue
      rendererPicked = m.id
    }
    if (!v) {
      out.push({ ...base, status: 'none' })
      continue
    }
    // Lo que Modrinth dice que no puede ir con él
    const clash = v.dependencies.find((d) => d.dependency_type === 'incompatible' && d.project_id && have.has(d.project_id))
    if (clash) out.push({ ...base, status: 'conflict', with: have.get(clash.project_id!)!.title })
    else out.push({ ...base, status: 'add', versionId: v.id })
  }
  // Ningún motor de dibujo existe para esta versión: se dice con el primero
  if (!rendererPicked) out.unshift({ projectId: PERF_MODS[0].id, key: PERF_MODS[0].key, title: name(PERF_MODS[0].id), status: 'none' })
  return out
}
