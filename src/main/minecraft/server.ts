import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { copyFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join, relative } from 'node:path'
import type { McLoader } from '@shared/types'
import { downloadTo } from '../net'

// Servidor de Minecraft en tu PC a partir de una instancia (carpeta server/ dentro de ella): se instala el del
// loader, se copian los mods que van en el servidor y se arranca con el Java de esa versión. Sin Electron.

export interface ServerSpec {
  mc: string
  loader: McLoader
  loaderVersion?: string
}

/** Cómo se arranca (argumentos después de java) */
export type LaunchArgs = string[]

const sha1 = (path: string): string => createHash('sha1').update(readFileSync(path)).digest('hex')

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

/** Busca un archivo por nombre dentro de una carpeta (los win_args.txt de Forge y NeoForge) */
function findFile(dir: string, name: string): string | null {
  if (!existsSync(dir)) return null
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      const f = findFile(p, name)
      if (f) return f
    } else if (e.name === name) return p
  }
  return null
}

/** Ejecuta java hasta que termine (el instalador de Forge/NeoForge); devuelve si ha ido bien */
const runJava = (java: string, args: string[], cwd: string): Promise<boolean> =>
  new Promise((resolve) => {
    const p = spawn(java, args, { cwd, windowsHide: true, stdio: 'ignore' })
    p.on('exit', (code) => resolve(code === 0))
    p.on('error', () => resolve(false))
  })

/**
 * Instala el servidor en `dir`. `versionJson` es la ruta del JSON de la versión oficial (ya instalada para jugar):
 * de ahí sale el server.jar de vanilla. Devuelve cómo arrancarlo.
 */
export async function installServer(dir: string, spec: ServerSpec, java: string, versionJson: string): Promise<LaunchArgs> {
  mkdirSync(dir, { recursive: true })
  const lv = spec.loaderVersion
  switch (spec.loader) {
    case 'vanilla': {
      const v = JSON.parse(readFileSync(versionJson, 'utf8')) as { downloads?: { server?: { url: string; sha1: string } } }
      const s = v.downloads?.server
      if (!s) throw new Error('Esta versión no tiene servidor oficial')
      const jar = join(dir, 'server.jar')
      if (!existsSync(jar) || sha1(jar) !== s.sha1) {
        await downloadTo(s.url, jar, () => undefined)
        if (sha1(jar) !== s.sha1) throw new Error('server.jar no coincide')
      }
      return ['-jar', 'server.jar', 'nogui']
    }
    case 'fabric': {
      // El lanzador de servidor de Fabric: un solo jar que baja el resto la primera vez que arranca
      const installers = await getJson<{ version: string; stable: boolean }[]>('https://meta.fabricmc.net/v2/versions/installer')
      const iv = (installers.find((i) => i.stable) ?? installers[0])?.version
      if (!iv || !lv) throw new Error('Sin instalador de Fabric')
      const url = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(spec.mc)}/${encodeURIComponent(lv)}/${encodeURIComponent(iv)}/server/jar`
      await downloadTo(url, join(dir, 'fabric-server-launch.jar'), () => undefined)
      return ['-jar', 'fabric-server-launch.jar', 'nogui']
    }
    case 'forge':
    case 'neoforge': {
      if (!lv) throw new Error('Falta la versión del loader')
      const url =
        spec.loader === 'forge'
          ? `https://maven.minecraftforge.net/net/minecraftforge/forge/${spec.mc}-${lv}/forge-${spec.mc}-${lv}-installer.jar`
          : `https://maven.neoforged.net/releases/net/neoforged/neoforge/${lv}/neoforge-${lv}-installer.jar`
      const installer = join(dir, 'installer.jar')
      await downloadTo(url, installer, () => undefined)
      if (!(await runJava(java, ['-jar', 'installer.jar', '--installServer'], dir))) throw new Error('El instalador del servidor ha fallado')
      await rm(installer, { force: true })
      await rm(`${installer}.log`, { force: true })
      // Modernos (1.17+): arrancan con sus archivos de argumentos
      const args = findFile(join(dir, 'libraries', 'net'), 'win_args.txt')
      if (args) return [...(existsSync(join(dir, 'user_jvm_args.txt')) ? ['@user_jvm_args.txt'] : []), `@${relative(dir, args).replace(/\\/g, '/')}`, 'nogui']
      // Antiguos: un jar de Forge ejecutable
      const jar = readdirSync(dir).find((f) => /^forge-.*\.jar$/i.test(f) && !/installer/i.test(f))
      if (!jar) throw new Error('No se encuentra el servidor de Forge')
      return ['-jar', jar, 'nogui']
    }
    default:
      throw new Error('Loader sin servidor')
  }
}

/** Un puerto libre en este PC */
export const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const a = s.address()
      const port = typeof a === 'object' && a ? a.port : 25565
      s.close(() => resolve(port))
    })
  })

/** server.properties con nuestros valores encima de los que ya hubiera (el resto los pone el servidor) */
export async function writeProperties(dir: string, values: Record<string, string>): Promise<void> {
  const file = join(dir, 'server.properties')
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : []
  const rest = lines.filter((l) => !Object.keys(values).some((k) => l.startsWith(`${k}=`)))
  await writeFile(file, [...rest.filter(Boolean), ...Object.entries(values).map(([k, v]) => `${k}=${v.replace(/[\r\n]/g, ' ')}`)].join('\n') + '\n')
}

/** Mods del servidor: los de la instancia que Modrinth no marca como solo de cliente (la carpeta se rehace) */
export async function syncServerMods(dir: string, instanceMods: string, files: string[]): Promise<void> {
  const mods = join(dir, 'mods')
  mkdirSync(mods, { recursive: true })
  for (const f of await readdir(mods)) if (/\.jar$/i.test(f)) await rm(join(mods, f), { force: true })
  for (const f of files) await copyFile(join(instanceMods, f), join(mods, f))
}

export interface RunningServer {
  proc: ChildProcess
  command(line: string): void
  stop(): void
}

/** Arranca el servidor. `onLine` recibe cada línea de su consola. */
export function startServer(dir: string, java: string, args: LaunchArgs, ramMB: number, onLine: (l: string) => void, onExit: (code: number | null) => void): RunningServer {
  const proc = spawn(java, [`-Xmx${ramMB}M`, '-Xms512M', ...args], { cwd: dir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let rest = ''
  const data = (c: Buffer): void => {
    const parts = (rest + c.toString()).split(/\r?\n/)
    rest = parts.pop() ?? ''
    parts.forEach(onLine)
  }
  proc.stdout?.on('data', data)
  proc.stderr?.on('data', data)
  proc.on('exit', (code) => onExit(code))
  proc.on('error', () => onExit(1))
  let killer: ReturnType<typeof setTimeout> | null = null
  return {
    proc,
    command: (line) => {
      if (proc.stdin?.writable) proc.stdin.write(`${line.replace(/[\r\n]/g, '')}\n`)
    },
    stop: () => {
      if (proc.stdin?.writable) proc.stdin.write('stop\n')
      // Si no se para solo en medio minuto (un mod colgado), se cierra a la fuerza
      killer ??= setTimeout(() => proc.kill(), 30_000)
      proc.once('exit', () => killer && clearTimeout(killer))
    }
  }
}

/** Tamaño de la carpeta del mundo (para enseñarlo) */
export function folderSize(p: string): number {
  if (!existsSync(p)) return 0
  let total = 0
  for (const e of readdirSync(p, { withFileTypes: true })) {
    const f = join(p, e.name)
    try {
      total += e.isDirectory() ? folderSize(f) : statSync(f).size
    } catch {
      // Archivo que desaparece mientras se cuenta
    }
  }
  return total
}
