import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { MinecraftFolder, Version, launch, type ResolvedVersion } from '@xmcl/core'
import {
  DEFAULT_RUNTIME_ALL_URL,
  getVersionList,
  installDependenciesTask,
  installFabric,
  installForgeTask,
  installJavaRuntimeTask,
  installNeoForgedTask,
  installQuiltVersion,
  installTask,
  type JavaRuntimeManifest,
  type JavaRuntimes,
  type MinecraftVersion
} from '@xmcl/installer'
import { Agent, interceptors } from 'undici'
import type { ModLoader } from './loaders'

// Motor de Minecraft sobre las librerías de XMCL: lista de versiones, instalación (versión, librerías, recursos y
// el Java oficial de Mojang que pide cada versión) y arranque. Sin Electron: se puede probar con Node a secas.

export type McStage = 'game' | 'java' | 'loader'
export interface McProgress {
  stage: McStage
  /** Bytes descargados y total (0 si aún no se sabe) */
  done: number
  total: number
}
type OnProgress = (p: McProgress) => void

// Sin agente, XMCL crea uno por archivo: con los ~4000 recursos del juego son miles de conexiones a la vez y
// Mojang las corta. Uno compartido: 16 conexiones por servidor, con reintentos y redirecciones.
const dispatcher = new Agent({ connections: 16, connect: { timeout: 30_000 } }).compose(
  interceptors.retry(),
  interceptors.redirect({ maxRedirections: 5 })
)

let versionsCache: { at: number; list: MinecraftVersion[] } | null = null

/** Versiones oficiales (de la más nueva a la más vieja); la lista se guarda 10 minutos */
export async function listVersions(): Promise<MinecraftVersion[]> {
  if (versionsCache && Date.now() - versionsCache.at < 600_000) return versionsCache.list
  const { versions } = await getVersionList()
  versionsCache = { at: Date.now(), list: versions }
  return versions
}

interface RunnableTask<T> {
  progress: number
  total: number
  cancel(): void
  startAndWait(ctx: { onUpdate?: () => void }): Promise<T>
}

/** Ejecuta una tarea de XMCL avisando del progreso (como mucho cada 300 ms) y cancelable con `signal` */
async function run<T>(stage: McStage, task: RunnableTask<T>, onProgress: OnProgress, signal?: AbortSignal): Promise<T> {
  let last = 0
  const tick = (force = false): void => {
    const now = Date.now()
    if (!force && now - last < 300) return
    last = now
    onProgress({ stage, done: task.progress, total: task.total })
  }
  const stop = (): void => task.cancel()
  signal?.throwIfAborted()
  signal?.addEventListener('abort', stop)
  tick(true)
  try {
    return await task.startAndWait({ onUpdate: () => tick() })
  } finally {
    signal?.removeEventListener('abort', stop)
    tick(true)
  }
}

/** Componente de Java que pide la versión (las muy antiguas no lo dicen: Java 8) */
export const javaComponent = (v: ResolvedVersion): string => v.javaVersion?.component ?? 'jre-legacy'

/** javaw.exe del Java de Mojang instalado para ese componente */
export const javaPathFor = (root: string, component: string): string => join(root, 'runtime', component, 'bin', 'javaw.exe')

const getJson = async <T>(url: string, signal?: AbortSignal): Promise<T> => {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

/**
 * Instala el Java oficial de Mojang para ese componente (si ya está, solo comprueba los archivos). Los dos JSON
 * se piden aquí: el `fetchJavaRuntimeManifest` de XMCL usa una opción que undici 7 ya no acepta.
 */
async function installJava(root: string, component: string, onProgress: OnProgress, signal?: AbortSignal): Promise<string> {
  const all = await getJson<JavaRuntimes>(DEFAULT_RUNTIME_ALL_URL, signal)
  const target = all['windows-x64'][component]?.[0]
  if (!target) throw new Error(`Java no disponible: ${component}`)
  const { files } = await getJson<Pick<JavaRuntimeManifest, 'files'>>(target.manifest.url, signal)
  const manifest: JavaRuntimeManifest = { files, target: component, version: target.version }
  await run('java', installJavaRuntimeTask({ manifest, destination: join(root, 'runtime', component), dispatcher }), onProgress, signal)
  const java = javaPathFor(root, component)
  if (!existsSync(java)) throw new Error('Java no instalado')
  return java
}

/**
 * Instala una versión oficial completa en la carpeta compartida `root`. Si ya estaba, solo se comprueban los
 * archivos y se descarga lo que falte o esté mal. Devuelve la versión lista y la ruta de Java.
 */
export async function installVersion(root: string, id: string, onProgress: OnProgress, signal?: AbortSignal): Promise<{ version: ResolvedVersion; java: string }> {
  const meta = (await listVersions()).find((v) => v.id === id)
  if (!meta) throw new Error(`Versión desconocida: ${id}`)
  const version = await run('game', installTask(meta, MinecraftFolder.from(root), { dispatcher }), onProgress, signal)
  const java = await installJava(root, javaComponent(version), onProgress, signal)
  return { version, java }
}

export interface VersionSpec {
  mc: string
  loader: 'vanilla' | ModLoader
  loaderVersion?: string
}

/**
 * Instala el loader de mods encima de su versión de Minecraft (que ya tiene que estar, con su Java: Forge y NeoForge
 * lo usan para preparar sus archivos) y sus librerías. Devuelve la versión con la que se arranca.
 */
async function installLoader(root: string, spec: VersionSpec, java: string, onProgress: OnProgress, signal?: AbortSignal): Promise<ResolvedVersion> {
  const folder = MinecraftFolder.from(root)
  const lv = spec.loaderVersion
  if (!lv) throw new Error('Falta la versión del loader')
  onProgress({ stage: 'loader', done: 0, total: 0 })
  let id: string
  switch (spec.loader) {
    case 'fabric':
      id = await installFabric({ minecraftVersion: spec.mc, version: lv, minecraft: folder })
      break
    case 'quilt':
      id = await installQuiltVersion({ minecraftVersion: spec.mc, version: lv, minecraft: folder })
      break
    case 'forge': {
      // XMCL lo pediría por http: la dirección https del maven oficial
      const full = `${spec.mc}-${lv}`
      const path = `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`
      id = await run('loader', installForgeTask({ mcversion: spec.mc, version: lv, installer: { path } }, folder, { java, dispatcher }), onProgress, signal)
      break
    }
    case 'neoforge':
      id = await run('loader', installNeoForgedTask('neoforge', lv, folder, { java, dispatcher }), onProgress, signal)
      break
    default:
      throw new Error('Loader desconocido')
  }
  const version = await Version.parse(folder, id)
  return run('loader', installDependenciesTask(version, { dispatcher }), onProgress, signal)
}

/**
 * Instala todo lo que necesita una instancia: su versión de Minecraft, su Java y, si lleva, su loader. Un fallo de
 * red suelto (un archivo que no llega) no la tumba: se reintenta hasta 3 veces (lo ya bajado no se repite).
 */
export async function installInstance(root: string, spec: VersionSpec, onProgress: OnProgress, signal?: AbortSignal): Promise<{ version: ResolvedVersion; java: string }> {
  for (let attempt = 1; ; attempt++) {
    try {
      const base = await installVersion(root, spec.mc, onProgress, signal)
      if (spec.loader === 'vanilla') return base
      return { version: await installLoader(root, spec, base.java, onProgress, signal), java: base.java }
    } catch (e) {
      if (signal?.aborted || attempt >= 3) throw e
      console.error(`[minecraft] instalar (intento ${attempt}):`, (e as Error).message)
      await new Promise((r) => setTimeout(r, 2000 * attempt))
    }
  }
}

export interface LaunchAccount {
  name: string
  uuid: string
  /** Token de Minecraft (cuenta Microsoft); sin conexión, ninguno */
  token?: string
}

/** Arranca el juego con la carpeta propia de la instancia (mods, mundos, opciones) y lo compartido en `root` */
export function launchGame(o: {
  root: string
  gameDir: string
  version: ResolvedVersion
  java: string
  account: LaunchAccount
  ramMB: number
  /** Entrar directamente en este servidor ("Unirme a mi amigo") */
  server?: { host: string; port: number }
}): Promise<ChildProcess> {
  // Desde la 1.20 se entra con Quick Play; antes, con --server/--port
  const quickPlay = JSON.stringify(o.version.arguments?.game ?? []).includes('quickPlayMultiplayer')
  const join = o.server
    ? quickPlay
      ? { quickPlayMultiplayer: `${o.server.host}:${o.server.port}` }
      : { server: { ip: o.server.host, port: o.server.port } }
    : {}
  return launch({
    ...join,
    resourcePath: o.root,
    gamePath: o.gameDir,
    // Sin la configuración de logs de Mojang (XML para su launcher): así el juego escribe logs/latest.log y
    // la consola sale en texto normal, que es lo que guardamos para "Ver registro"
    version: { ...o.version, logging: {} },
    javaPath: o.java,
    gameProfile: { name: o.account.name, id: o.account.uuid.replace(/-/g, '') },
    // Sin conexión: token de relleno y tipo "legacy" (como Prism y PollyMC)
    accessToken: o.account.token ?? '0',
    userType: (o.account.token ? 'msa' : 'legacy') as 'legacy',
    properties: {},
    launcherName: 'PoxiLauncher',
    launcherBrand: 'PoxiLauncher',
    minMemory: 512,
    maxMemory: o.ramMB,
    extraExecOption: { detached: false }
  })
}
