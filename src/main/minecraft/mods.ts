import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import type { McContent, McContentKind, McError, McHit, McInstance, McPackItem, McProjectVersion, McSnapshot, McUpdate } from '@shared/types'
import { emit } from '../events'
import { downloadTo } from '../net'
import {
  listSnapshots,
  placeFile,
  removeFile,
  restoreSnapshot,
  safeFileName,
  scan,
  setEnabled,
  takeSnapshot,
  tempFile,
  writeManifest,
  diskPath,
  readModMeta,
  type ModMeta
} from './content'
import { modVersionFrom, satisfies } from './rules'
import {
  bestVersion,
  getProjects,
  getVersion,
  getVersions,
  identify,
  latestFor,
  loadersFor,
  primaryFile,
  projectVersions,
  search,
  type ContentKind,
  type MrProject,
  type MrVersion,
  type SearchSort
} from './modrinth'

// Mods, resource packs y shaders de una instancia: instalar desde Modrinth (con sus dependencias), actualizar, bajar
// de versión, bloquear, quitar, activar/desactivar, etiquetas y volver atrás. Cada cambio hace antes una foto.

export interface ContentCtx {
  inst: McInstance
  dir: string
  /** El juego de esta instancia está abierto (los archivos están en uso) */
  running: boolean
}

type Result = { ok: boolean; error?: McError; missing?: string[] }

// Una cola por instancia: dos cambios a la vez sobre la misma carpeta se pisarían
const queues = new Map<string, Promise<unknown>>()
function queued<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(id) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(fn)
  queues.set(id, next)
  return next
}

const push = (inst: McInstance, items: McContent[]): void => emit('minecraftContent', { instanceId: inst.id, items })
const progress = (inst: McInstance, done: number, total: number): void => emit('minecraftTask', { instanceId: inst.id, done, total })

/** Loaders con los que se filtra en Modrinth: los mods, por el de la instancia; lo demás vale en cualquiera */
const loadersOf = (inst: McInstance, kind: McContentKind): string[] | null => (kind === 'mod' ? loadersFor(inst.loader) : null)

const kindOf = (projectType: string): McContentKind => (projectType === 'resourcepack' ? 'resourcepack' : projectType === 'shader' ? 'shader' : 'mod')

function sha512File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha512')
    createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

/** Descarga el archivo de una versión y comprueba que es exactamente el que dice Modrinth */
async function download(dir: string, v: MrVersion): Promise<string> {
  const f = primaryFile(v)
  if (!f || !safeFileName(f.filename)) throw new Error('Archivo no válido')
  const tmp = tempFile(dir)
  try {
    await downloadTo(f.url, tmp, () => undefined)
    if ((await sha512File(tmp)) !== f.hashes.sha512) throw new Error('Hash distinto')
    return tmp
  } catch (e) {
    await rm(tmp, { force: true })
    throw e
  }
}

/** Datos de Modrinth de un elemento a partir de su versión y su proyecto */
function describe(v: MrVersion, p: MrProject | undefined, kind: McContentKind, extra: Partial<McContent> = {}): McContent {
  const f = primaryFile(v)!
  return {
    kind,
    file: f.filename,
    enabled: true,
    sha1: f.hashes.sha1,
    size: f.size,
    title: p?.title ?? f.filename,
    projectId: v.project_id,
    versionId: v.id,
    version: v.version_number,
    icon: p?.icon_url ?? null,
    requires: v.dependencies.filter((d) => d.dependency_type === 'required' && d.project_id).map((d) => d.project_id!),
    client: p?.client_side,
    server: p?.server_side,
    ...extra
  }
}

/** Lo que hay ahora, reconociendo en Modrinth lo que se haya puesto a mano (si no hay red, se queda sin reconocer) */
export async function listContent(ctx: ContentCtx): Promise<McContent[]> {
  return queued(ctx.inst.id, async () => {
    const { items } = await scan(ctx.dir)
    // Lo no reconocido (nuevo o de antes, si Modrinth no contestó aquella vez) se vuelve a consultar
    const unknown = items.filter((c) => !c.projectId).map((c) => c.sha1)
    if (unknown.length) {
      try {
        const found = await identify(unknown)
        const versions = Object.values(found)
        const projects = new Map((await getProjects([...new Set(versions.map((v) => v.project_id))])).map((p) => [p.id, p]))
        for (let i = 0; i < items.length; i++) {
          const v = found[items[i].sha1]
          if (!v) continue
          const d = describe(v, projects.get(v.project_id), items[i].kind)
          items[i] = { ...d, file: items[i].file, enabled: items[i].enabled, size: items[i].size, sha1: items[i].sha1 }
        }
      } catch {
        // Sin red: se quedan como "a mano"
      }
    }
    await writeManifest(ctx.dir, items)
    return items
  })
}

type ChangeListener = (inst: McInstance, before: McContent[], after: McContent[], key: string) => void
const changeListeners: ChangeListener[] = []
/** Después de cada cambio (para subirlo al pack compartido del grupo) */
export const onContentChange = (fn: ChangeListener): void => {
  changeListeners.push(fn)
}

/** Cambio con foto previa: `change` recibe la lista actual y devuelve la nueva (o un error) */
async function change(
  ctx: ContentCtx,
  key: string,
  params: (items: McContent[]) => Record<string, string>,
  fn: (items: McContent[]) => Promise<{ items: McContent[]; error?: McError; missing?: string[] }>
): Promise<Result> {
  if (ctx.running) return { ok: false, error: 'mc.running' }
  return queued(ctx.inst.id, async () => {
    const { items } = await scan(ctx.dir)
    // Cada foto es cómo quedó todo DESPUÉS de un cambio ("Instalar Iris" = con Iris puesto); la primera vez, además,
    // una del estado inicial (para poder volver a antes del primer cambio)
    if (!(await listSnapshots(ctx.dir)).length) await takeSnapshot(ctx.dir, items, 'mc.history.start')
    const label = params(items)
    const r = await fn(items)
    await writeManifest(ctx.dir, r.items)
    await takeSnapshot(ctx.dir, r.items, key, label)
    push(ctx.inst, r.items)
    for (const l of changeListeners) l(ctx.inst, items, r.items, key)
    return { ok: !r.error, error: r.error, missing: r.missing }
  })
}

/**
 * Lo que hay que instalar para tener este proyecto: su versión y las dependencias obligatorias que falten (y las de
 * ellas), sin repetir lo que ya está.
 */
async function plan(ctx: ContentCtx, first: MrVersion, installed: Set<string>): Promise<MrVersion[]> {
  const out: MrVersion[] = [first]
  const seen = new Set([...installed, first.project_id])
  const queue = [first]
  while (queue.length && out.length < 60) {
    const v = queue.shift()!
    for (const d of v.dependencies) {
      if (d.dependency_type !== 'required' || (d.project_id && seen.has(d.project_id))) continue
      let dep: MrVersion | undefined
      if (d.version_id) dep = await getVersion(d.version_id).catch(() => undefined)
      else if (d.project_id) dep = bestVersion(await projectVersions(d.project_id, ctx.inst.version, loadersFor(ctx.inst.loader)).catch(() => []))
      if (!dep || seen.has(dep.project_id)) continue
      seen.add(dep.project_id)
      out.push(dep)
      queue.push(dep)
    }
  }
  return out
}

/** Instala un proyecto de Modrinth (la versión dada o la mejor compatible) con sus dependencias */
export async function installProject(ctx: ContentCtx, projectId: string, kind: McContentKind, versionId?: string): Promise<Result> {
  let target: MrVersion | undefined
  try {
    target = versionId ? await getVersion(versionId) : bestVersion(await projectVersions(projectId, ctx.inst.version, loadersOf(ctx.inst, kind)))
  } catch {
    return { ok: false, error: 'mc.downloadFailed' }
  }
  if (!target || target.project_id !== projectId) return { ok: false, error: 'mc.noVersion' }
  const [p] = await getProjects([projectId]).catch(() => [] as MrProject[])
  return installVersions(ctx, [{ v: target, kind }], 'mc.history.install', { name: p?.title ?? projectId })
}

/**
 * Instala estas versiones de Modrinth y las dependencias obligatorias que falten, en un solo paso del historial (así
 * «Optimizar» se deshace de una vez). Cada una sustituye a la que hubiera del mismo proyecto.
 */
export function installVersions(ctx: ContentCtx, mains: { v: MrVersion; kind: McContentKind }[], key: string, label: Record<string, string>): Promise<Result> {
  return change(ctx, key, () => label, async (items) => {
    const have = new Set(items.map((c) => c.projectId).filter((x): x is string => !!x))
    // Reinstalar uno que ya estaba = cambiarlo por esta versión (sus dependencias se revisan igual)
    for (const m of mains) have.delete(m.v.project_id)
    const versions: { v: MrVersion; kind: McContentKind | null }[] = []
    for (const m of mains) {
      if (versions.some((x) => x.v.project_id === m.v.project_id)) continue
      const planned = await plan(ctx, m.v, new Set([...have, ...versions.map((x) => x.v.project_id)]))
      planned.forEach((v, i) => versions.push({ v, kind: i === 0 ? m.kind : null }))
    }
    const projects = new Map((await getProjects(versions.map((x) => x.v.project_id)).catch(() => [])).map((x) => [x.id, x]))
    let list = items
    for (let i = 0; i < versions.length; i++) {
      progress(ctx.inst, i, versions.length)
      const { v, kind } = versions[i]
      const pr = projects.get(v.project_id)
      let tmp: string
      try {
        tmp = await download(ctx.dir, v)
      } catch {
        progress(ctx.inst, versions.length, versions.length)
        return { items: list, error: 'mc.downloadFailed' }
      }
      const previous = list.find((c) => c.projectId === v.project_id)
      const item = describe(v, pr, kind ?? kindOf(pr?.project_type ?? 'mod'), { dependency: kind === null || undefined, tags: previous?.tags, locked: previous?.locked })
      await placeFile(ctx.dir, item, tmp, previous)
      list = [...list.filter((c) => c !== previous), item]
    }
    progress(ctx.inst, versions.length, versions.length)
    // Fabric/Quilt: que lo recién instalado encaje con lo que piden los mods (Iris 1.8.8 pide Sodium 0.6.x)
    if (ctx.inst.loader === 'fabric' || ctx.inst.loader === 'quilt') list = await fitVersions(ctx, list, new Set(versions.map((x) => x.v.project_id)))
    return { items: list.sort((a, b) => a.title.localeCompare(b.title)) }
  })
}

/**
 * Si un mod pide una versión concreta de otro recién instalado ("depends" de su fabric.mod.json) y la que se ha bajado
 * no la cumple, se cambia por la más nueva de Modrinth que sí. Solo se tocan los recién instalados.
 */
async function fitVersions(ctx: ContentCtx, items: McContent[], fresh: Set<string>): Promise<McContent[]> {
  const metas = new Map<string, { item: McContent; meta: ModMeta }>()
  for (const item of items.filter((c) => c.kind === 'mod' && c.enabled)) {
    const meta = await readModMeta(diskPath(ctx.dir, item))
    if (meta) metas.set(meta.id, { item, meta })
  }
  let list = items
  for (const { meta } of [...metas.values()]) {
    for (const [depId, want] of Object.entries(meta.depends)) {
      const dep = metas.get(depId)
      if (!dep?.item.projectId || !fresh.has(dep.item.projectId) || satisfies(dep.meta.version, want)) continue
      const id = await versionFor(ctx, dep.item.projectId, want)
      if (!id || id === dep.item.versionId) continue
      try {
        const v = await getVersion(id)
        const tmp = await download(ctx.dir, v)
        const [p] = await getProjects([v.project_id]).catch(() => [] as MrProject[])
        const item = describe(v, p, 'mod', { dependency: dep.item.dependency, tags: dep.item.tags, locked: dep.item.locked })
        await placeFile(ctx.dir, item, tmp, dep.item)
        list = list.map((c) => (c === dep.item ? item : c))
        metas.set(depId, { item, meta: { ...dep.meta, version: modVersionFrom(v.version_number, ctx.inst.version) } })
      } catch {
        // Sin red: se queda la que había (el explicador de crasheos lo arreglaría al jugar)
      }
    }
  }
  return list
}

/** Versiones de un proyecto que valen para la instancia (para elegir una más vieja o más nueva) */
export async function projectVersionList(ctx: ContentCtx, projectId: string, kind: McContentKind): Promise<McProjectVersion[]> {
  const list = await projectVersions(projectId, ctx.inst.version, loadersOf(ctx.inst, kind))
  return list.map((v) => ({ id: v.id, name: v.name, number: v.version_number, type: v.version_type, date: v.date_published, loaders: v.loaders }))
}

/** Actualizaciones disponibles (sin las bloqueadas) */
export async function checkUpdates(ctx: ContentCtx): Promise<McUpdate[]> {
  const { items } = await scan(ctx.dir)
  const out: McUpdate[] = []
  for (const kind of ['mod', 'resourcepack', 'shader'] as McContentKind[]) {
    const mine = items.filter((c) => c.kind === kind && c.projectId && !c.locked)
    const latest = await latestFor(mine.map((c) => c.sha1), ctx.inst.version, loadersOf(ctx.inst, kind))
    for (const c of mine) {
      let v = latest[c.sha1]
      if (!v || v.id === c.versionId || v.project_id !== c.projectId) continue
      // Con una versión estable, solo se ofrecen estables (una beta nueva no es una actualización para ti)
      if (v.version_type !== 'release' && !/alpha|beta|pre|rc/i.test(c.version ?? '')) {
        const list: MrVersion[] = await projectVersions(c.projectId!, ctx.inst.version, loadersOf(ctx.inst, kind)).catch(() => [])
        const best = bestVersion(list)
        const newer = best && best.version_type === 'release' && list.indexOf(best) < list.findIndex((x) => x.id === c.versionId)
        if (!best || !newer) continue
        v = best
      }
      out.push({ file: c.file, title: c.title, from: c.version ?? '', to: v.version_number, versionId: v.id })
    }
  }
  return out
}

/** Pone estas versiones (actualizar uno, todos o bajar de versión) */
export async function setVersions(ctx: ContentCtx, versionIds: string[], key = 'mc.history.update'): Promise<Result> {
  let versions: MrVersion[]
  try {
    versions = await getVersions(versionIds)
  } catch {
    return { ok: false, error: 'mc.downloadFailed' }
  }
  const params = (items: McContent[]): Record<string, string> =>
    versions.length === 1
      ? { name: items.find((c) => c.projectId === versions[0].project_id)?.title ?? '', v: versions[0].version_number, n: '1' }
      : { n: String(versions.length) }
  return change(ctx, key, params, async (items) => {
    let list = items
    for (let i = 0; i < versions.length; i++) {
      progress(ctx.inst, i, versions.length)
      const v = versions[i]
      const previous = list.find((c) => c.projectId === v.project_id)
      if (!previous) continue
      let tmp: string
      try {
        tmp = await download(ctx.dir, v)
      } catch {
        progress(ctx.inst, versions.length, versions.length)
        return { items: list, error: 'mc.downloadFailed' }
      }
      const item: McContent = {
        ...previous,
        file: primaryFile(v)!.filename,
        sha1: primaryFile(v)!.hashes.sha1,
        size: primaryFile(v)!.size,
        versionId: v.id,
        version: v.version_number,
        enabled: previous.enabled,
        requires: v.dependencies.filter((d) => d.dependency_type === 'required' && d.project_id).map((d) => d.project_id!)
      }
      await placeFile(ctx.dir, item, tmp, previous)
      list = list.map((c) => (c === previous ? item : c))
    }
    progress(ctx.inst, versions.length, versions.length)
    return { items: list }
  })
}

/** Nombre para el historial: el del elemento si es uno solo */
const nameOf = (items: McContent[], files: string[]): Record<string, string> => ({
  n: String(files.length),
  name: files.length === 1 ? (items.find((c) => c.file === files[0])?.title ?? files[0]) : ''
})

/** Quita elementos (y, si se pide, las dependencias que se quedan sin nadie que las necesite) */
export function removeContent(ctx: ContentCtx, files: string[], orphans: boolean): Promise<Result> {
  return change(ctx, 'mc.history.remove', (items) => nameOf(items, files), async (items) => {
    const gone = new Set(files)
    let removed = items.filter((c) => gone.has(c.file))
    let rest = items.filter((c) => !gone.has(c.file))
    if (orphans) {
      // Dependencias que ya nadie necesita (en cadena)
      for (;;) {
        const needed = new Set(rest.flatMap((c) => c.requires ?? []))
        const extra = rest.filter((c) => c.dependency && c.projectId && !needed.has(c.projectId))
        if (!extra.length) break
        removed = [...removed, ...extra]
        rest = rest.filter((c) => !extra.includes(c))
      }
    }
    for (const c of removed) await removeFile(ctx.dir, c)
    return { items: rest }
  })
}

/** Qué elementos necesitan a estos (para avisar antes de quitarlos) */
export function neededBy(items: McContent[], files: string[]): McContent[] {
  const ids = new Set(items.filter((c) => files.includes(c.file) && c.projectId).map((c) => c.projectId!))
  return items.filter((c) => !files.includes(c.file) && c.enabled && (c.requires ?? []).some((r) => ids.has(r)))
}

export function toggleContent(ctx: ContentCtx, files: string[], enabled: boolean, tag?: string): Promise<Result> {
  const key = tag ? (enabled ? 'mc.history.tagOn' : 'mc.history.tagOff') : enabled ? 'mc.history.enable' : 'mc.history.disable'
  return change(ctx, key, (items) => (tag ? { n: String(files.length), name: tag } : nameOf(items, files)), async (items) => {
    const out: McContent[] = []
    for (const c of items) out.push(files.includes(c.file) ? await setEnabled(ctx.dir, c, enabled) : c)
    return { items: out }
  })
}

/** Activa o desactiva todo lo que lleva una etiqueta */
export async function toggleTag(ctx: ContentCtx, tag: string, enabled: boolean): Promise<Result> {
  const { items } = await scan(ctx.dir)
  return toggleContent(ctx, items.filter((c) => c.tags?.includes(tag)).map((c) => c.file), enabled, tag)
}

/** Cambios que no tocan archivos (bloquear, etiquetas): sin foto */
export function editContent(ctx: ContentCtx, file: string, patch: Pick<McContent, 'locked' | 'tags'>): Promise<McContent[]> {
  return queued(ctx.inst.id, async () => {
    const { items } = await scan(ctx.dir)
    const list = items.map((c) => (c.file === file ? { ...c, ...patch } : c))
    await writeManifest(ctx.dir, list)
    push(ctx.inst, list)
    return list
  })
}

export const history = (ctx: ContentCtx): Promise<McSnapshot[]> => listSnapshots(ctx.dir)

/** Vuelve a una foto (antes hace otra, así también se puede deshacer) */
export function rollback(ctx: ContentCtx, at: number): Promise<Result> {
  return change(ctx, 'mc.history.rollback', () => ({ when: String(at) }), async (items) => {
    const r = await restoreSnapshot(ctx.dir, items, at, async (c) => (c.versionId ? download(ctx.dir, await getVersion(c.versionId)) : null))
    if (!r) return { items, error: 'mc.noVersion' }
    return { items: r.items.sort((a, b) => a.title.localeCompare(b.title)), missing: r.missing.map((c) => c.title) }
  })
}

/** Buscar en Modrinth lo que vale para esta instancia */
export async function searchContent(inst: McInstance | null, q: string, kind: ContentKind, sort: SearchSort, offset: number): Promise<{ hits: McHit[]; total: number }> {
  const r = await search(q, kind, inst?.version ?? null, inst?.loader ?? null, sort, offset)
  return {
    total: r.total,
    hits: r.hits.map((h) => ({
      id: h.project_id,
      slug: h.slug,
      title: h.title,
      description: h.description,
      icon: h.icon_url,
      downloads: h.downloads,
      author: h.author,
      categories: h.categories,
      updated: h.date_modified
    }))
  }
}

/**
 * Deja el contenido igual que la lista del grupo: baja lo que falta o tiene otra versión y quita lo que ya no está.
 * Lo puesto a mano no se toca (no se puede compartir).
 */
export function syncTo(ctx: ContentCtx, remote: McPackItem[], by: string): Promise<Result> {
  return change(ctx, 'mc.history.sync', () => ({ name: by }), async (items) => {
    const want = new Map(remote.map((x) => [x.projectId, x]))
    const toGet = remote.filter((x) => items.find((c) => c.projectId === x.projectId)?.versionId !== x.versionId)
    let versions: MrVersion[]
    try {
      versions = await getVersions(toGet.map((x) => x.versionId))
    } catch {
      return { items, error: 'mc.downloadFailed' }
    }
    const projects = new Map((await getProjects([...new Set(versions.map((v) => v.project_id))]).catch(() => [])).map((x) => [x.id, x]))
    let list = items
    // Fuera lo que el grupo ya no tiene
    for (const c of items.filter((c) => c.projectId && !want.has(c.projectId))) {
      await removeFile(ctx.dir, c)
      list = list.filter((x) => x !== c)
    }
    let done = 0
    let next = 0
    let failed = false
    const one = async (v: MrVersion): Promise<void> => {
      const tmp = await download(ctx.dir, v)
      const previous = list.find((c) => c.projectId === v.project_id)
      const item = describe(v, projects.get(v.project_id), want.get(v.project_id)?.kind ?? 'mod', {
        tags: previous?.tags,
        enabled: previous?.enabled ?? true
      })
      await placeFile(ctx.dir, item, tmp, previous)
      list = [...list.filter((c) => c !== previous), item]
      progress(ctx.inst, ++done, versions.length)
    }
    progress(ctx.inst, 0, versions.length)
    // 6 a la vez (como los modpacks)
    await Promise.all(
      Array.from({ length: Math.min(6, versions.length) }, async () => {
        while (!failed && next < versions.length) await one(versions[next++]).catch(() => void (failed = true))
      })
    )
    progress(ctx.inst, versions.length, versions.length)
    return { items: list.sort((a, b) => a.title.localeCompare(b.title)), error: failed ? 'mc.downloadFailed' : undefined }
  })
}

/** La versión más nueva de un proyecto que cumple lo que pide otro mod ("0.6.x", ">=1.2"…); null si ninguna */
export async function versionFor(ctx: ContentCtx, projectId: string, want: string | string[]): Promise<string | null> {
  const list = await projectVersions(projectId, ctx.inst.version, loadersFor(ctx.inst.loader)).catch(() => [] as MrVersion[])
  const ok = list.filter((v) => satisfies(modVersionFrom(v.version_number, ctx.inst.version), want))
  return (ok.find((v) => v.version_type === 'release') ?? ok[0])?.id ?? null
}
