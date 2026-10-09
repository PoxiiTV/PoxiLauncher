import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { copyFile, rename, rm, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { McContent, McContentKind, McSnapshot } from '@shared/types'
import { filterEntries, open as openZip, readEntry } from '@xmcl/unzip'

// Contenido de una instancia en disco: mods, resource packs y shaders, su lista (con lo que sabemos de Modrinth),
// las fotos de antes de cada cambio y la caché de archivos quitados (para poder volver atrás sin descargar nada).
// Sin Electron ni red: todo lo de Modrinth lo hace quien llama.

export const FOLDERS: Record<McContentKind, string> = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' }
/** Carpetas de la instancia que van en un modpack (configuración), además de mods, resource packs y shaders */
export const CONFIG_DIRS = ['config', 'defaultconfigs', 'kubejs', 'global_packs']
const EXT: Record<McContentKind, RegExp> = { mod: /\.jar$/i, resourcepack: /\.zip$/i, shader: /\.zip$/i }
const DISABLED = '.disabled'
/** Fotos que se guardan por instancia */
export const MAX_SNAPSHOTS = 30

const meta = (dir: string, ...p: string[]): string => join(dir, '.poxigames', ...p)
const manifestFile = (dir: string): string => meta(dir, 'content.json')
const cacheDir = (dir: string): string => meta(dir, 'cache')
const historyDir = (dir: string): string => meta(dir, 'history')

/** Ruta en disco de un elemento (desactivado: con ".disabled") */
export const diskPath = (dir: string, c: Pick<McContent, 'kind' | 'file' | 'enabled'>): string =>
  join(dir, FOLDERS[c.kind], c.enabled ? c.file : c.file + DISABLED)

/** Un nombre de archivo que viene de fuera (Modrinth, un .mrpack) no puede salirse de su carpeta */
export const safeFileName = (name: string): boolean => name === basename(name) && !/[<>:"|?*\\/]/.test(name) && name !== '.' && name !== '..' && name.length <= 200

export function sha1File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha1')
    createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

export async function readManifest(dir: string): Promise<McContent[]> {
  try {
    return JSON.parse(await readFile(manifestFile(dir), 'utf8')) as McContent[]
  } catch {
    return []
  }
}

export async function writeManifest(dir: string, items: McContent[]): Promise<void> {
  mkdirSync(meta(dir), { recursive: true })
  const tmp = manifestFile(dir) + '.tmp'
  await writeFile(tmp, JSON.stringify(items))
  await rename(tmp, manifestFile(dir))
}

/**
 * La lista al día con lo que hay de verdad en las carpetas: lo que se borró a mano desaparece, lo que se puso a
 * mano aparece (sin datos de Modrinth: `unknown` son sus sha1, para reconocerlo) y se respeta si está activado.
 */
export async function scan(dir: string): Promise<{ items: McContent[]; unknown: string[] }> {
  const saved = await readManifest(dir)
  const byKey = new Map(saved.map((c) => [`${c.kind}/${c.file}`, c]))
  const items: McContent[] = []
  const unknown: string[] = []
  for (const kind of Object.keys(FOLDERS) as McContentKind[]) {
    const folder = join(dir, FOLDERS[kind])
    if (!existsSync(folder)) continue
    for (const name of readdirSync(folder)) {
      const enabled = !name.endsWith(DISABLED)
      const file = enabled ? name : name.slice(0, -DISABLED.length)
      if (!EXT[kind].test(file)) continue
      const path = join(folder, name)
      let st
      try {
        st = statSync(path)
      } catch {
        continue
      }
      if (!st.isFile()) continue
      const known = byKey.get(`${kind}/${file}`)
      if (known && known.size === st.size) {
        items.push({ ...known, enabled })
        continue
      }
      const sha1 = await sha1File(path)
      // Mismo archivo con otro tamaño (lo cambiaron a mano): se vuelve a reconocer
      if (known && known.sha1 === sha1) items.push({ ...known, enabled, size: st.size })
      else {
        items.push({ kind, file, enabled, sha1, size: st.size, title: file.replace(/\.(jar|zip)$/i, '') })
        unknown.push(sha1)
      }
    }
  }
  items.sort((a, b) => a.title.localeCompare(b.title))
  return { items, unknown }
}

/** Guarda en la caché el archivo que se va a quitar o sustituir (si ya estaba, basta con borrarlo) */
async function stash(dir: string, c: McContent): Promise<void> {
  const from = diskPath(dir, c)
  if (!existsSync(from)) return
  mkdirSync(cacheDir(dir), { recursive: true })
  const to = join(cacheDir(dir), c.sha1)
  if (existsSync(to)) await rm(from, { force: true })
  else await rename(from, to)
}

/** Quita un elemento de su carpeta (queda en la caché para poder volver atrás) */
export const removeFile = (dir: string, c: McContent): Promise<void> => stash(dir, c)

/** Activa o desactiva (renombrando con ".disabled", como hacen los demás launchers) */
export async function setEnabled(dir: string, c: McContent, enabled: boolean): Promise<McContent> {
  if (c.enabled === enabled) return c
  const next = { ...c, enabled }
  const from = diskPath(dir, c)
  if (existsSync(from)) await rename(from, diskPath(dir, next))
  return next
}

/** Pone en su carpeta un archivo ya descargado y comprobado (`tmp`), sustituyendo al anterior si lo había */
export async function placeFile(dir: string, c: McContent, tmp: string, previous?: McContent): Promise<void> {
  if (previous) await stash(dir, previous)
  mkdirSync(join(dir, FOLDERS[c.kind]), { recursive: true })
  const to = diskPath(dir, c)
  await rm(to, { force: true })
  await rename(tmp, to)
}

/** Recupera de la caché un archivo quitado antes; false si no está */
export async function restoreFromCache(dir: string, c: McContent): Promise<boolean> {
  const from = join(cacheDir(dir), c.sha1)
  if (!existsSync(from)) return false
  mkdirSync(join(dir, FOLDERS[c.kind]), { recursive: true })
  await copyFile(from, diskPath(dir, c))
  return true
}

/** Archivo temporal para una descarga (en la caché: mismo disco, así colocarlo es solo renombrar) */
export function tempFile(dir: string): string {
  mkdirSync(cacheDir(dir), { recursive: true })
  return join(cacheDir(dir), `.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

// ——— Fotos (historial) ———
interface SnapshotFile extends McSnapshot {
  items: McContent[]
}

export async function takeSnapshot(dir: string, items: McContent[], key: string, params?: Record<string, string>): Promise<void> {
  mkdirSync(historyDir(dir), { recursive: true })
  const at = Date.now()
  const snap: SnapshotFile = { at, key, params, count: items.length, items }
  await writeFile(join(historyDir(dir), `${at}.json`), JSON.stringify(snap))
  await prune(dir)
}

async function readSnapshot(dir: string, at: number): Promise<SnapshotFile | null> {
  try {
    return JSON.parse(await readFile(join(historyDir(dir), `${at}.json`), 'utf8')) as SnapshotFile
  } catch {
    return null
  }
}

/** Fotos de la más nueva a la más vieja */
export async function listSnapshots(dir: string): Promise<McSnapshot[]> {
  if (!existsSync(historyDir(dir))) return []
  const out: McSnapshot[] = []
  for (const f of await readdir(historyDir(dir))) {
    if (!/^\d+\.json$/.test(f)) continue
    const s = await readSnapshot(dir, Number(f.slice(0, -5)))
    if (s) out.push({ at: s.at, key: s.key, params: s.params, count: s.count })
  }
  return out.sort((a, b) => b.at - a.at)
}

/** Deja las últimas fotos y borra de la caché los archivos que ya no usa ninguna */
async function prune(dir: string): Promise<void> {
  const all = await listSnapshots(dir)
  for (const s of all.slice(MAX_SNAPSHOTS)) await rm(join(historyDir(dir), `${s.at}.json`), { force: true })
  const keep = new Set<string>()
  for (const s of all.slice(0, MAX_SNAPSHOTS)) (await readSnapshot(dir, s.at))?.items.forEach((c) => keep.add(c.sha1))
  if (!existsSync(cacheDir(dir))) return
  for (const f of await readdir(cacheDir(dir))) {
    if (f.startsWith('.tmp-') || !keep.has(f)) await rm(join(cacheDir(dir), f), { force: true })
  }
}

/**
 * Deja el contenido como estaba en una foto. Lo que sobra va a la caché; lo que falta sale de la caché o, si no
 * está, de `download` (Modrinth). Devuelve la lista nueva y los elementos que no se han podido recuperar.
 */
export async function restoreSnapshot(
  dir: string,
  current: McContent[],
  at: number,
  download: (c: McContent) => Promise<string | null>
): Promise<{ items: McContent[]; missing: McContent[] } | null> {
  const snap = await readSnapshot(dir, at)
  if (!snap) return null
  const key = (c: McContent): string => `${c.kind}/${c.sha1}`
  const wanted = new Map(snap.items.map((c) => [key(c), c]))
  // Fuera lo que no estaba
  for (const c of current) if (!wanted.has(key(c))) await stash(dir, c)
  const have = new Map(current.map((c) => [key(c), c]))
  const items: McContent[] = []
  const missing: McContent[] = []
  for (const c of snap.items) {
    const now = have.get(key(c))
    if (now) {
      // Ya está: mismo nombre y mismo estado que en la foto
      if (now.file !== c.file || now.enabled !== c.enabled) await rename(diskPath(dir, now), diskPath(dir, c))
      items.push(c)
    } else if (await restoreFromCache(dir, c)) items.push(c)
    else {
      const tmp = await download(c).catch(() => null)
      if (tmp) {
        await placeFile(dir, c, tmp)
        items.push(c)
      } else missing.push(c)
    }
  }
  return { items, missing }
}

export interface ModMeta {
  /** Id del mod para el loader ("sodium", "fabric-api"…) */
  id: string
  version: string
  /** Lo que necesita: id → condición (o varias: vale cualquiera) */
  depends: Record<string, string | string[]>
}

/** Lo que un mod de Fabric/Quilt dice de sí mismo (su fabric.mod.json); null si no es de Fabric o no se puede leer */
export async function readModMeta(file: string): Promise<ModMeta | null> {
  let zip: Awaited<ReturnType<typeof openZip>> | null = null
  try {
    zip = await openZip(file, { lazyEntries: true, autoClose: false })
    const [entry] = await filterEntries(zip, ['fabric.mod.json'])
    if (!entry) return null
    const json = JSON.parse((await readEntry(zip, entry)).toString('utf8').replace(/^﻿/, '')) as Partial<ModMeta>
    if (typeof json.id !== 'string' || typeof json.version !== 'string') return null
    return { id: json.id, version: json.version, depends: json.depends && typeof json.depends === 'object' ? json.depends : {} }
  } catch {
    return null
  } finally {
    zip?.close()
  }
}
