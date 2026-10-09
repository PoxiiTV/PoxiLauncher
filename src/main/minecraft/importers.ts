import { existsSync, statSync } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'
import type { McContent, McImportable, McLoader } from '@shared/types'
import { CONFIG_DIRS, safeFileName } from './content'

// «Trae tus instancias»: encuentra las de otros launchers (el oficial, CurseForge, Prism Launcher y Modrinth App) y
// las copia en una instancia nuestra. De sus carpetas solo se LEE: nada se mueve ni se cambia. Sus archivos son datos
// de fuera: se validan, y de sus rutas solo se usan las carpetas que se encuentran al recorrer las suyas.
// Las cuentas de Microsoft de esos launchers no se tocan. Sin Electron: las carpetas las pasa quien llama.

export type Launcher = McImportable['launcher']
export type ImportRoots = Partial<Record<Launcher, string>>

/** Una instancia encontrada, con la carpeta del juego de donde se copia (y, si la comparte, la clave de la otra) */
export interface Found extends Omit<McImportable, 'imported' | 'shares'> {
  dir: string
  shares?: { key: string; mods: boolean }
}

interface Spec {
  mc: string
  loader: McLoader
  loaderVersion?: string
}

// Mismas reglas que el IPC para versiones y loaders
const MC = /^[\w.+ -]{1,40}$/
const LV = /^[\w.+-]{1,60}$/
const valid = (s: Spec | null): Spec | null => (s && MC.test(s.mc) && (s.loader === 'vanilla' || LV.test(s.loaderVersion ?? '')) ? s : null)

/** "1.20.1-47.2.0" o "0.16.5-1.20.1" → la versión del loader sin la de Minecraft */
const stripMc = (v: string, mc: string): string => (v.startsWith(`${mc}-`) ? v.slice(mc.length + 1) : v.endsWith(`-${mc}`) ? v.slice(0, -mc.length - 1) : v)

/** Minecraft de una versión de NeoForge: "21.1.72" → "1.21.1", "21.0.5" → "1.21", "26.1.0.3" → "26.1" */
export function neoforgeMc(v: string): string | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v)
  if (!m) return null
  const [, a, b, c] = m
  // Desde 2026 la de NeoForge empieza por la de Minecraft (año.versión.parche)
  if (Number(a) >= 25) return c === '0' ? `${a}.${b}` : `${a}.${b}.${c}`
  return b === '0' ? `1.${a}` : `1.${a}.${b}`
}

/**
 * Launcher oficial: la versión de un perfil ("1.21.1", "fabric-loader-0.16.5-1.21.1", "1.20.1-forge-47.2.0",
 * "neoforge-21.1.72", "quilt-loader-0.26.0-1.21.1"). `inheritsFrom` (el JSON de esa versión, si está) manda sobre
 * lo que se deduce del nombre. null: algo que no sabemos instalar (OptiFine, versiones a mano…).
 */
export function parseVersionId(id: string, inheritsFrom?: string): Spec | null {
  const loaderOf = (prefix: string, loader: 'fabric' | 'quilt'): Spec | null => {
    const rest = id.slice(prefix.length)
    if (inheritsFrom && rest.endsWith(`-${inheritsFrom}`)) return { mc: inheritsFrom, loader, loaderVersion: rest.slice(0, -inheritsFrom.length - 1) }
    const m = /^([^-]+)-(.+)$/.exec(rest)
    return m ? { mc: m[2], loader, loaderVersion: m[1] } : null
  }
  if (id.startsWith('fabric-loader-')) return valid(loaderOf('fabric-loader-', 'fabric'))
  if (id.startsWith('quilt-loader-')) return valid(loaderOf('quilt-loader-', 'quilt'))
  const neo = /^neoforge-(.+)$/i.exec(id)
  if (neo) {
    const mc = inheritsFrom ?? neoforgeMc(neo[1])
    return mc ? valid({ mc, loader: 'neoforge', loaderVersion: stripMc(neo[1], mc) }) : null
  }
  const forge = /^(.+?)-forge-?(.+)$/i.exec(id)
  if (forge) {
    const mc = inheritsFrom ?? forge[1]
    return valid({ mc, loader: 'forge', loaderVersion: stripMc(forge[2], mc) })
  }
  // Hereda de otra y no es un loader conocido (OptiFine, LabyMod…): no
  if (inheritsFrom && inheritsFrom !== id) return null
  if (/optifine/i.test(id)) return null
  return valid({ mc: id, loader: 'vanilla' })
}

/** CurseForge: `baseModLoader.name` ("forge-47.2.0", "fabric-0.15.11-1.20.1", "neoforge-21.1.244"…) y su `gameVersion` */
export function parseCurseLoader(name: string | null | undefined, mc: string): Spec | null {
  if (!name) return valid({ mc, loader: 'vanilla' })
  const m = /^(forge|neoforge|fabric|quilt)-(.+)$/i.exec(name)
  if (!m) return null
  return valid({ mc, loader: m[1].toLowerCase() as McLoader, loaderVersion: stripMc(m[2], mc) })
}

const MMC_LOADERS: Record<string, Exclude<McLoader, 'vanilla'>> = {
  'net.fabricmc.fabric-loader': 'fabric',
  'org.quiltmc.quilt-loader': 'quilt',
  'net.minecraftforge': 'forge',
  'net.neoforged': 'neoforge'
}

const mmcSchema = z.object({
  components: z.array(z.object({ uid: z.string().max(100), version: z.string().max(100).optional(), cachedVersion: z.string().max(100).optional() }).passthrough()).max(100)
})

/** Prism Launcher / MultiMC: los componentes de mmc-pack.json */
export function parseMmcPack(json: unknown): Spec | null {
  const r = mmcSchema.safeParse(json)
  if (!r.success) return null
  const ver = (c: { version?: string; cachedVersion?: string }): string => c.version ?? c.cachedVersion ?? ''
  const mc = r.data.components.find((c) => c.uid === 'net.minecraft')
  if (!mc) return null
  const loader = r.data.components.find((c) => c.uid in MMC_LOADERS)
  if (!loader) return valid({ mc: ver(mc), loader: 'vanilla' })
  return valid({ mc: ver(mc), loader: MMC_LOADERS[loader.uid], loaderVersion: stripMc(ver(loader), ver(mc)) })
}

/** Una clave de un .cfg de Prism/MultiMC (formato de Qt: comillas opcionales, \" \\ y \xNNNN) */
export function cfgValue(text: string, key: string): string | undefined {
  const line = text.split(/\r?\n/).find((l) => l.startsWith(`${key}=`))
  if (line === undefined) return undefined
  let v = line.slice(key.length + 1).trim()
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
  return v.replace(/\\x([0-9a-fA-F]{4})|\\(["\\])/g, (_, hex: string | undefined, ch: string | undefined) => (hex ? String.fromCharCode(parseInt(hex, 16)) : ch!))
}

const MODRINTH_LOADERS: Record<string, McLoader> = { vanilla: 'vanilla', fabric: 'fabric', quilt: 'quilt', forge: 'forge', neoforge: 'neoforge' }

/** Modrinth App: lo que guarda de cada perfil (en app.db o, en las versiones viejas, en profile.json) */
export function parseModrinth(gameVersion: unknown, loader: unknown, loaderVersion: unknown): Spec | null {
  if (typeof gameVersion !== 'string' || typeof loader !== 'string' || !(loader in MODRINTH_LOADERS)) return null
  const l = MODRINTH_LOADERS[loader]
  return valid(l === 'vanilla' ? { mc: gameVersion, loader: l } : { mc: gameVersion, loader: l, loaderVersion: stripMc(String(loaderVersion ?? ''), gameVersion) })
}

/** Fecha de launcher_profiles.json: ISO con o sin zona, que a veces viene sin los dos puntos ("+0100"). 0 si no vale */
export function parseLauncherDate(s: string | undefined): number {
  const t = Date.parse((s ?? '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  return Number.isFinite(t) ? t : 0
}

/**
 * Perfiles del oficial sin carpeta propia: comparten mods y mundos. Por cada carpeta, el último jugado con loader
 * y el último vanilla salen marcados; los demás llevan con quién la comparten (los mods de esa carpeta son de la
 * versión del último jugado: en otra versión, el juego se cerraría al abrirse).
 */
export function markShared(list: (Found & { usedAt: number })[]): void {
  const groups = new Map<string, (Found & { usedAt: number })[]>()
  for (const f of list) {
    if (f.unsupported) continue
    const g = `${resolve(f.dir).toLowerCase()}|${f.loader === 'vanilla' ? 'vanilla' : 'mods'}`
    groups.set(g, [...(groups.get(g) ?? []), f])
  }
  for (const g of groups.values()) {
    const main = g.reduce((a, b) => (b.usedAt > a.usedAt ? b : a))
    for (const f of g) if (f !== main) f.shares = { key: main.key, mods: f.loader !== 'vanilla' }
  }
}

/** Mods reconocidos en Modrinth (activados) cuya versión no es para esta versión de Minecraft o estos loaders */
export function incompatibleMods(items: McContent[], versions: Map<string, { game_versions: string[]; loaders: string[] }>, mc: string, loaders: string[]): McContent[] {
  return items.filter((c) => {
    const v = c.kind === 'mod' && c.enabled && c.versionId ? versions.get(c.versionId) : undefined
    return !!v && (!v.game_versions.includes(mc) || !v.loaders.some((l) => loaders.includes(l)))
  })
}

// ——— Leer archivos de fuera ———
/** JSON de otro programa (con BOM o sin él); null si no está o no se entiende. Solo metadatos: nunca datos del juego */
async function readJsonFile(path: string): Promise<unknown> {
  try {
    if (statSync(path).size > 64 * 1024 ** 2) return null
    return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
}

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Subcarpetas de verdad (sin enlaces, sin las ocultas ni las temporales de los launchers) */
async function subdirs(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.isSymbolicLink() && !/^[._]/.test(e.name) && safeFileName(e.name))
      .map((e) => e.name)
  } catch {
    return []
  }
}

/** Tamaño de un archivo o una carpeta entera (sin seguir enlaces: podrían apuntar a cualquier sitio) */
async function sizeOf(path: string): Promise<number> {
  let st
  try {
    st = await lstat(path)
  } catch {
    return 0
  }
  if (st.isSymbolicLink()) return 0
  if (!st.isDirectory()) return st.size
  let total = 0
  for (const e of await readdir(path).catch(() => [] as string[])) total += await sizeOf(join(path, e))
  return total
}

// ——— Qué se copia ———
const SETTINGS_FILES = ['options.txt', 'optionsof.txt', 'optionsshaders.txt', 'servers.dat']
/** Lo que se copia de la carpeta del juego (sin mundos). Vanilla no lleva mods, shaders ni su configuración */
export const copiedItems = (loader: McLoader): string[] => [...(loader === 'vanilla' ? [] : ['mods', 'shaderpacks', ...CONFIG_DIRS]), 'resourcepacks', ...SETTINGS_FILES]

/** Cuánto ocupa cada carpeta del juego (varios perfiles del oficial comparten la misma: se mide una vez) */
interface Measured {
  items: Map<string, number>
  worlds: number
  worldsSize: number
  mods: number
}
type Sizes = Map<string, Promise<Measured>>

function measure(dir: string, cache: Sizes): Promise<Measured> {
  let p = cache.get(dir)
  if (!p) {
    p = (async () => {
      const items = new Map<string, number>()
      for (const i of copiedItems('fabric')) items.set(i, await sizeOf(join(dir, i)))
      const worlds = await subdirs(join(dir, 'saves'))
      const mods = await readdir(join(dir, 'mods')).catch(() => [] as string[])
      return { items, worlds: worlds.length, worldsSize: await sizeOf(join(dir, 'saves')), mods: mods.filter((m) => /\.jar(\.disabled)?$/i.test(m)).length }
    })()
    cache.set(dir, p)
  }
  return p
}

async function found(launcher: Launcher, key: string, name: string, dir: string, spec: Spec | null, sizes: Sizes, unsupported?: McImportable['unsupported']): Promise<Found> {
  const m = await measure(dir, sizes)
  const loader = spec?.loader ?? 'vanilla'
  return {
    key: `${launcher}:${resolve(key).toLowerCase()}`,
    launcher,
    name: name.trim().slice(0, 40),
    version: spec?.mc ?? '',
    loader,
    ...(spec?.loaderVersion ? { loaderVersion: spec.loaderVersion } : {}),
    dir,
    mods: loader === 'vanilla' ? 0 : m.mods,
    size: copiedItems(loader).reduce((s, i) => s + (m.items.get(i) ?? 0), 0),
    worlds: m.worlds,
    worldsSize: m.worldsSize,
    ...(spec ? {} : { unsupported: unsupported ?? 'mc.import.why.version' })
  }
}

// ——— Cada launcher ———
const officialSchema = z.object({
  profiles: z.record(
    z.string().max(200),
    z
      .object({
        name: z.string().max(200).optional(),
        type: z.string().max(40).optional(),
        lastVersionId: z.string().max(200).optional(),
        gameDir: z.string().max(400).optional(),
        lastUsed: z.string().max(60).optional()
      })
      .passthrough()
  )
})

/** Launcher oficial (.minecraft): sus perfiles (sin carpeta propia, todos usan .minecraft) */
async function official(root: string, sizes: Sizes): Promise<Found[]> {
  const parsed = officialSchema.safeParse(await readJsonFile(join(root, 'launcher_profiles.json')))
  if (!parsed.success) return []
  const manifest = (await readJsonFile(join(root, 'versions', 'version_manifest_v2.json'))) as { latest?: { release?: unknown; snapshot?: unknown } } | null
  const out: (Found & { usedAt: number })[] = []
  for (const [id, p] of Object.entries(parsed.data.profiles)) {
    const latest = p.type === 'latest-release' || p.lastVersionId === 'latest-release' ? 'release' : p.type === 'latest-snapshot' || p.lastVersionId === 'latest-snapshot' ? 'snapshot' : null
    const versionId = latest ? manifest?.latest?.[latest] : p.lastVersionId
    // Carpeta propia del perfil, solo si es una carpeta de verdad
    const dir = p.gameDir && isAbsolute(p.gameDir) && isDir(p.gameDir) ? p.gameDir : root
    // Nunca jugado (como el «última snapshot» que trae el launcher de serie): nada suyo que traer, salvo que tenga
    // su propia carpeta con mundos
    const usedAt = parseLauncherDate(p.lastUsed)
    const used = usedAt > Date.UTC(2000, 0, 1)
    if (!used && (dir === root || !(await measure(dir, sizes)).worlds)) continue
    let spec: Spec | null = null
    if (typeof versionId === 'string' && safeFileName(versionId)) {
      const json = (await readJsonFile(join(root, 'versions', versionId, `${versionId}.json`))) as { inheritsFrom?: unknown } | null
      spec = parseVersionId(versionId, typeof json?.inheritsFrom === 'string' ? json.inheritsFrom : undefined)
    }
    out.push({ ...(await found('official', `${dir}#${id}`, p.name ?? '', dir, spec, sizes)), usedAt })
  }
  markShared(out)
  return out.map(({ usedAt, ...f }) => (void usedAt, f))
}

const curseSchema = z.object({
  name: z.string().max(200).optional(),
  gameVersion: z.string().max(60),
  baseModLoader: z.object({ name: z.string().max(200).nullish() }).passthrough().nullish()
})

/** La carpeta de Minecraft de CurseForge (se puede cambiar en sus ajustes: la que diga su storage.json) */
export async function curseforgeRoot(appData: string, home: string): Promise<string> {
  const storage = (await readJsonFile(join(appData, 'CurseForge', 'storage.json'))) as Record<string, unknown> | null
  try {
    const raw = storage?.['minecraft-settings']
    const root = (typeof raw === 'string' ? JSON.parse(raw) : raw)?.minecraftRoot
    if (typeof root === 'string' && isAbsolute(root) && isDir(root)) return root
  } catch {
    // La de por defecto
  }
  return join(home, 'curseforge', 'minecraft')
}

/** CurseForge: cada carpeta de Instances con su minecraftinstance.json */
async function curseforge(root: string, sizes: Sizes): Promise<Found[]> {
  const out: Found[] = []
  const base = join(root, 'Instances')
  for (const name of await subdirs(base)) {
    const dir = join(base, name)
    const r = curseSchema.safeParse(await readJsonFile(join(dir, 'minecraftinstance.json')))
    if (!r.success) continue
    out.push(await found('curseforge', dir, r.data.name || name, dir, parseCurseLoader(r.data.baseModLoader?.name, r.data.gameVersion), sizes))
  }
  return out
}

/** Prism Launcher (y MultiMC, mismo formato): su carpeta de instancias, la que diga su .cfg si la cambiaste */
async function prism(root: string, sizes: Sizes): Promise<Found[]> {
  let base = join(root, 'instances')
  for (const cfg of ['prismlauncher.cfg', 'multimc.cfg']) {
    const text = await readFile(join(root, cfg), 'utf8').catch(() => '')
    const custom = text && cfgValue(text, 'InstanceDir')
    if (custom) base = isAbsolute(custom) ? custom : join(root, custom)
    if (text) break
  }
  const out: Found[] = []
  for (const name of await subdirs(base)) {
    const inst = join(base, name)
    const cfg = await readFile(join(inst, 'instance.cfg'), 'utf8').catch(() => null)
    if (cfg === null) continue
    const dir = isDir(join(inst, '.minecraft')) ? join(inst, '.minecraft') : join(inst, 'minecraft')
    out.push(await found('prism', inst, cfgValue(cfg, 'name') || name, dir, parseMmcPack(await readJsonFile(join(inst, 'mmc-pack.json'))), sizes))
  }
  return out
}

interface ModrinthRow {
  path: string
  name: unknown
  game_version: unknown
  mod_loader: unknown
  mod_loader_version: unknown
}

/**
 * Los perfiles de app.db (SQLite) con el SQLite que trae Node. Se lee una copia: abrir la suya, aun en solo lectura,
 * puede dejar archivos al lado (-shm) mientras Modrinth App la usa. null si no se puede leer.
 */
async function modrinthDb(root: string): Promise<{ rows: ModrinthRow[]; profiles: string } | null> {
  const sqlite = process.getBuiltinModule?.('node:sqlite') as typeof import('node:sqlite') | undefined
  const db = join(root, 'app.db')
  if (!sqlite || !existsSync(db)) return null
  const tmp = await mkdtemp(join(tmpdir(), 'poxi-modrinth-'))
  try {
    for (const f of ['app.db', 'app.db-wal']) if (existsSync(join(root, f))) await copyFile(join(root, f), join(tmp, f))
    const conn = new sqlite.DatabaseSync(join(tmp, 'app.db'))
    try {
      const rows = conn.prepare('SELECT path, name, game_version, mod_loader, mod_loader_version FROM profiles').all() as unknown as ModrinthRow[]
      // Carpeta propia de la app (si se cambió en sus ajustes)
      let custom: unknown = null
      try {
        custom = (conn.prepare('SELECT custom_dir FROM settings').get() as { custom_dir?: unknown } | undefined)?.custom_dir
      } catch {
        // Versiones sin ese ajuste
      }
      const profiles = typeof custom === 'string' && isAbsolute(custom) && isDir(join(custom, 'profiles')) ? join(custom, 'profiles') : join(root, 'profiles')
      return { rows, profiles }
    } finally {
      conn.close()
    }
  } catch {
    return null
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

const modrinthJson = z.object({
  metadata: z.object({ name: z.string().max(200).optional(), game_version: z.string().max(60), loader: z.string().max(20), loader_version: z.object({ id: z.string().max(100) }).passthrough().nullish() }).passthrough()
})

/** Modrinth App: sus perfiles (los datos en app.db; en las versiones viejas, profile.json en cada carpeta) */
async function modrinth(root: string, sizes: Sizes): Promise<Found[]> {
  const db = await modrinthDb(root)
  const base = db?.profiles ?? join(root, 'profiles')
  const rows = new Map((db?.rows ?? []).filter((r) => typeof r.path === 'string').map((r) => [r.path, r]))
  const out: Found[] = []
  for (const name of await subdirs(base)) {
    const dir = join(base, name)
    const row = rows.get(name)
    if (row) {
      out.push(await found('modrinth', dir, typeof row.name === 'string' && row.name ? row.name : name, dir, parseModrinth(row.game_version, row.mod_loader, row.mod_loader_version), sizes))
      continue
    }
    const legacy = modrinthJson.safeParse(await readJsonFile(join(dir, 'profile.json')))
    if (legacy.success) {
      const m = legacy.data.metadata
      out.push(await found('modrinth', dir, m.name || name, dir, parseModrinth(m.game_version, m.loader, m.loader_version?.id), sizes))
    } else out.push(await found('modrinth', dir, name, dir, null, sizes, 'mc.import.why.meta'))
  }
  return out
}

const READERS: Record<Launcher, (root: string, sizes: Sizes) => Promise<Found[]>> = { official, curseforge, prism, modrinth }

/** Todas las instancias que se encuentran (un launcher que falla no tumba a los demás) */
export async function detect(roots: ImportRoots): Promise<Found[]> {
  const sizes: Sizes = new Map()
  const all = await Promise.all(
    (Object.keys(READERS) as Launcher[]).map((l) => (roots[l] && isDir(roots[l]!) ? READERS[l](roots[l]!, sizes).catch(() => []) : Promise.resolve([])))
  )
  return all.flat()
}

/**
 * Copia lo que se trae (y los mundos, si se piden) a la carpeta de la instancia nueva, archivo a archivo (sin
 * cargarlos en memoria) y avisando de los bytes copiados. Los enlaces no se siguen. Si falla, lanza el error.
 */
export async function copyInstance(f: Pick<Found, 'dir' | 'loader'>, dest: string, worlds: boolean, onBytes: (n: number) => void): Promise<void> {
  const one = async (from: string, to: string): Promise<void> => {
    const st = await lstat(from)
    if (st.isSymbolicLink()) return
    if (st.isDirectory()) {
      await mkdir(to, { recursive: true })
      for (const e of await readdir(from)) await one(join(from, e), join(to, e))
    } else if (st.isFile()) {
      await copyFile(from, to)
      onBytes(st.size)
    }
  }
  for (const item of [...copiedItems(f.loader), ...(worlds ? ['saves'] : [])]) {
    const from = join(f.dir, item)
    if (existsSync(from)) await one(from, join(dest, item))
  }
}
