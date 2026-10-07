import { createHash } from 'node:crypto'
import { createReadStream, cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { copyFile, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, normalize, relative } from 'node:path'
import { z } from 'zod'
import type { McContent, McInstance, McLoader } from '@shared/types'
import { downloadTo } from '../net'
import { run7z } from '../system/sevenzip'
import { FOLDERS } from './content'
import { getVersions, primaryFile } from './modrinth'

// Modpacks de Modrinth (.mrpack): importar (crea la instancia y baja cada archivo comprobando su hash), exportar la
// tuya y hacer un pack de servidor (solo lo que va en el servidor). Formato: https://support.modrinth.com/en/articles/8802351

const indexSchema = z.object({
  formatVersion: z.literal(1),
  game: z.literal('minecraft'),
  name: z.string().max(200),
  versionId: z.string().max(100).optional(),
  summary: z.string().max(2000).optional(),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(400),
        hashes: z.object({ sha1: z.string().regex(/^[0-9a-f]{40}$/), sha512: z.string().regex(/^[0-9a-f]{128}$/) }),
        env: z.object({ client: z.string(), server: z.string() }).partial().optional(),
        downloads: z.array(z.string().url()).min(1).max(10),
        fileSize: z.number().int().nonnegative().optional()
      })
    )
    .max(2000),
  dependencies: z.record(z.string(), z.string())
})
export type MrIndex = z.infer<typeof indexSchema>

const LOADER_KEYS: Record<string, Exclude<McLoader, 'vanilla'>> = { 'fabric-loader': 'fabric', 'quilt-loader': 'quilt', forge: 'forge', neoforge: 'neoforge' }

/** Versión de Minecraft y loader que pide el modpack */
export function packSpec(index: MrIndex): { mc: string; loader: McLoader; loaderVersion?: string } | null {
  const mc = index.dependencies.minecraft
  if (!mc) return null
  const key = Object.keys(index.dependencies).find((k) => k in LOADER_KEYS)
  return key ? { mc, loader: LOADER_KEYS[key], loaderVersion: index.dependencies[key] } : { mc, loader: 'vanilla' }
}

/** Una ruta del modpack dentro de la instancia; null si intenta salirse (o apunta a algo que no debe tocar) */
export function safeTarget(dir: string, path: string): string | null {
  if (isAbsolute(path) || /^[a-zA-Z]:/.test(path)) return null
  const n = normalize(path)
  if (n.startsWith('..') || n.split(/[\\/]/).includes('..') || n.startsWith('.poxigames')) return null
  const full = join(dir, n)
  const rel = relative(dir, full)
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? full : null
}

const sha512 = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const h = createHash('sha512')
    createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })

/** Lee un .mrpack (lo descomprime en una carpeta temporal que hay que borrar luego con `cleanup`) */
export async function openPack(file: string): Promise<{ index: MrIndex; root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'poxi-mrpack-'))
  const cleanup = (): Promise<void> => rm(root, { recursive: true, force: true })
  try {
    if (!(await run7z(['x', '-y', `-o${root}`, file], root))) throw new Error('No se puede abrir')
    const index = indexSchema.parse(JSON.parse(await readFile(join(root, 'modrinth.index.json'), 'utf8')))
    return { index, root, cleanup }
  } catch (e) {
    await cleanup()
    throw e
  }
}

/**
 * Pone el contenido del modpack en la carpeta de la instancia: baja cada archivo (de sus direcciones, en orden) y
 * comprueba su sha512; luego copia overrides/ y client-overrides/. Lo que el pack marca como solo de servidor, fuera.
 */
export async function applyPack(dir: string, index: MrIndex, root: string, onProgress: (done: number, total: number) => void): Promise<void> {
  const files = index.files.filter((f) => f.env?.client !== 'unsupported')
  // Rutas comprobadas antes de bajar nada: un pack con una ruta mala no llega a escribir ningún archivo
  const targets = files.map((f) => {
    const target = safeTarget(dir, f.path)
    if (!target) throw new Error(`Ruta no válida: ${f.path}`)
    return target
  })
  let done = 0
  const one = async (i: number): Promise<void> => {
    const f = files[i]
    const target = targets[i]
    mkdirSync(dirname(target), { recursive: true })
    const tmp = `${target}.poxi-tmp`
    // Cada dirección, dos veces (un corte suelto no tumba el modpack entero)
    for (const url of [...f.downloads, ...f.downloads]) {
      try {
        await downloadTo(url, tmp, () => undefined, 20_000)
        if ((await sha512(tmp)) === f.hashes.sha512) {
          await rm(target, { force: true })
          await rename(tmp, target)
          onProgress(++done, files.length)
          return
        }
      } catch {
        // Siguiente dirección
      }
    }
    await rm(tmp, { force: true })
    throw new Error(`No se ha podido descargar ${f.path}`)
  }
  // 6 a la vez (uno a uno, un pack de 50 mods tardaba minutos)
  onProgress(0, files.length)
  let next = 0
  let failed = false
  await Promise.all(
    Array.from({ length: Math.min(6, files.length) }, async () => {
      // Si uno falla, los demás dejan de empezar descargas (la instancia a medias se borra)
      while (!failed && next < files.length)
        await one(next++).catch((e) => {
          failed = true
          throw e
        })
    })
  )
  onProgress(files.length, files.length)
  for (const extra of ['overrides', 'client-overrides']) {
    const from = join(root, extra)
    if (!existsSync(from)) continue
    for (const e of readdirSync(from)) {
      const target = safeTarget(dir, e)
      if (target) cpSync(join(from, e), target, { recursive: true, force: true })
    }
  }
}

// Carpetas de la instancia que van en un modpack (configuración), además de mods, resource packs y shaders
const CONFIG_DIRS = ['config', 'defaultconfigs', 'kubejs', 'global_packs']

async function zipFolder(folder: string, dest: string): Promise<boolean> {
  const tmp = `${dest}.poxi-tmp`
  await rm(tmp, { force: true })
  if (!(await run7z(['a', '-tzip', '-mx=5', tmp, '.'], folder))) return false
  await rm(dest, { force: true })
  await rename(tmp, dest)
  return true
}

/** Exporta la instancia como .mrpack: lo de Modrinth, por enlace; lo puesto a mano y la configuración, dentro */
export async function exportPack(dir: string, inst: McInstance, items: McContent[], dest: string): Promise<boolean> {
  const work = await mkdtemp(join(tmpdir(), 'poxi-export-'))
  try {
    const fromModrinth = items.filter((c) => c.enabled && c.versionId)
    const versions = new Map((await getVersions(fromModrinth.map((c) => c.versionId!))).map((v) => [v.id, v]))
    const files: MrIndex['files'] = []
    const overrides = join(work, 'overrides')
    for (const c of items.filter((x) => x.enabled)) {
      const v = c.versionId ? versions.get(c.versionId) : undefined
      const f = v && primaryFile(v)
      if (f && f.hashes.sha1 === c.sha1) {
        files.push({
          path: `${FOLDERS[c.kind]}/${c.file}`,
          hashes: { sha1: f.hashes.sha1, sha512: f.hashes.sha512 },
          env: { client: 'required', server: c.server === 'unsupported' ? 'unsupported' : 'required' },
          downloads: [f.url],
          fileSize: f.size
        })
      } else {
        // A mano (o cambiado): el archivo va dentro del pack
        mkdirSync(join(overrides, FOLDERS[c.kind]), { recursive: true })
        await copyFile(join(dir, FOLDERS[c.kind], c.file), join(overrides, FOLDERS[c.kind], c.file))
      }
    }
    for (const d of CONFIG_DIRS) if (existsSync(join(dir, d))) cpSync(join(dir, d), join(overrides, d), { recursive: true })
    const dependencies: Record<string, string> = { minecraft: inst.version }
    const key = Object.entries(LOADER_KEYS).find(([, l]) => l === inst.loader)?.[0]
    if (key && inst.loaderVersion) dependencies[key] = inst.loaderVersion
    const index: MrIndex = { formatVersion: 1, game: 'minecraft', versionId: '1.0.0', name: inst.name, files, dependencies }
    await writeFile(join(work, 'modrinth.index.json'), JSON.stringify(index, null, 2))
    return await zipFolder(work, dest)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

/**
 * Pack de servidor: los mods que hacen falta en el servidor (fuera los que Modrinth marca como solo de cliente),
 * la configuración y unas instrucciones. Listo para copiar en la carpeta del servidor.
 */
export async function exportServerPack(dir: string, inst: McInstance, items: McContent[], dest: string, readme: string): Promise<boolean> {
  const work = await mkdtemp(join(tmpdir(), 'poxi-server-'))
  try {
    mkdirSync(join(work, 'mods'), { recursive: true })
    for (const c of items.filter((x) => x.enabled && x.kind === 'mod' && x.server !== 'unsupported'))
      await copyFile(join(dir, 'mods', c.file), join(work, 'mods', c.file))
    for (const d of CONFIG_DIRS) if (existsSync(join(dir, d))) cpSync(join(dir, d), join(work, d), { recursive: true })
    await writeFile(join(work, 'LEEME.txt'), readme.replace(/\n/g, '\r\n'))
    return await zipFolder(work, dest)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}
