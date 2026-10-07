import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ResolvedVersion } from '@xmcl/core'
import type { McContent, McError, McInstance, McPack, McPresence, McServerConfig, McServerState } from '@shared/types'
import { accountCall, freshAccess, signedIn, syncNow } from '../account/service'
import { emit } from '../events'
import { serverDownload, serverUpload, UPDATE_BASE } from '../net'
import { run7z } from '../system/sevenzip'
import { freePort, installServer, startServer, syncServerMods, writeProperties, type RunningServer } from './server'
import { hostTunnel, type HostedTunnel } from './tunnel'

// Servidor de Minecraft en tu PC a partir de una instancia, abierto a tus amigos por el túnel de PoxiLauncher (sin
// abrir puertos). Con una instancia compartida, el mundo puede ser el del grupo: se guarda en nuestro servidor y
// cualquiera del pack lo aloja (uno a la vez), aunque quien lo creó no esté.

export interface HostingHost {
  find(id: string): McInstance
  dir(id: string): string
  root(): string
  /** Versión instalada (y su Java) para esta instancia */
  ensure(inst: McInstance): Promise<{ version: ResolvedVersion; java: string }>
  items(id: string): Promise<McContent[]>
  pack(inst: McInstance): McPack | undefined
  save(): void
  changed(): void
}

type Result = { ok: boolean; error?: McError; params?: Record<string, string> }

interface Live {
  state: McServerState
  server?: RunningServer
  tunnel?: HostedTunnel
  lines: string[]
  lockTimer?: ReturnType<typeof setInterval>
}

const MAX_LINES = 2000
let host: HostingHost
const live = new Map<string, Live>()

export const initHosting = (h: HostingHost): void => {
  host = h
}

/** Hay algún servidor en marcha (al cerrar la app hay que esperar a que se pare y suba el mundo) */
export const hostingActive = (): boolean => live.size > 0

export const hostingState = (): Record<string, McServerState> => Object.fromEntries([...live].map(([id, l]) => [id, l.state]))

const serverDir = (id: string): string => join(host.dir(id), 'server')
const specKey = (inst: McInstance): string => `${inst.version}|${inst.loader}|${inst.loaderVersion ?? ''}`

const set = (id: string, patch: Partial<McServerState>): void => {
  const l = live.get(id)
  if (!l) return
  l.state = { ...l.state, ...patch }
  host.changed()
}

const log = (id: string, line: string): void => {
  const l = live.get(id)
  if (!l) return
  l.lines.push(line)
  if (l.lines.length > MAX_LINES) l.lines.splice(0, l.lines.length - MAX_LINES)
  emit('minecraftServerLog', { instanceId: id, line })
}

export const serverLog = (id: string): string[] => live.get(id)?.lines ?? []

/** Configura el servidor de una instancia (la primera vez, con el EULA aceptado) */
export function setupServer(id: string, cfg: Omit<McServerConfig, 'eulaAt' | 'worldRev' | 'installedFor' | 'args'>): void {
  const inst = host.find(id)
  if (cfg.world === 'group' && !inst.packId) throw new Error('Sin pack')
  inst.server = { ...inst.server, ...cfg, eulaAt: inst.server?.eulaAt ?? Date.now() }
  host.save()
  host.changed()
}

// ——— Mundo del grupo ———
async function lockGroupWorld(packId: string): Promise<Result> {
  try {
    const r = await accountCall('POST', `/mc/packs/${packId}/world/lock`)
    if (r.status === 409) return { ok: false, error: 'mc.server.worldLocked', params: { name: String((r.data as { lockedBy?: string }).lockedBy ?? '') } }
    return { ok: r.status === 200, error: r.status === 200 ? undefined : 'mc.server.worldFailed' }
  } catch {
    return { ok: false, error: 'mc.server.worldFailed' }
  }
}

const auth = async (): Promise<Record<string, string>> => ({ Authorization: `Bearer ${(await freshAccess()) ?? ''}` })

/** Si el grupo tiene una versión del mundo más nueva que la de este PC, se baja y se pone */
async function pullGroupWorld(inst: McInstance, pack: McPack): Promise<boolean> {
  const cfg = inst.server!
  if (!pack.world || pack.world.rev <= (cfg.worldRev ?? 0)) return true
  const zip = join(tmpdir(), `poxi-world-${pack.id}-${Date.now()}.zip`)
  try {
    if (!(await serverDownload(`/api/u/mc/packs/${pack.id}/world`, zip, await auth()))) return false
    const dir = serverDir(inst.id)
    const world = join(dir, 'world')
    const aside = `${world}.poxi-old`
    await rm(aside, { recursive: true, force: true })
    if (existsSync(world)) await rename(world, aside)
    if (!(await run7z(['x', '-y', `-o${dir}`, zip], dir)) || !existsSync(world)) {
      await rm(world, { recursive: true, force: true })
      if (existsSync(aside)) await rename(aside, world)
      return false
    }
    await rm(aside, { recursive: true, force: true })
    cfg.worldRev = pack.world.rev
    host.save()
    return true
  } finally {
    await rm(zip, { force: true })
  }
}

/** Al cerrar: el mundo sube al servidor (nueva versión para el grupo) y se suelta */
async function pushGroupWorld(inst: McInstance, packId: string): Promise<void> {
  const dir = serverDir(inst.id)
  const zip = join(tmpdir(), `poxi-world-${packId}-${Date.now()}.zip`)
  try {
    if (existsSync(join(dir, 'world')) && (await run7z(['a', '-tzip', '-mx=3', '-xr!session.lock', zip, 'world'], dir))) {
      const res = await serverUpload(`/api/u/mc/packs/${packId}/world`, zip, await auth())
      if (res.ok) {
        const p = ((await res.json()) as { pack: McPack }).pack
        if (p.world) inst.server!.worldRev = p.world.rev
        host.save()
      } else emit('toast', { kind: 'error', key: 'mc.server.worldFailed' })
    }
  } catch {
    emit('toast', { kind: 'error', key: 'mc.server.worldFailed' })
  } finally {
    await rm(zip, { force: true })
    await accountCall('DELETE', `/mc/packs/${packId}/world/lock`).catch(() => undefined)
    void syncNow()
  }
}

// ——— Arrancar y parar ———
export async function startHosting(id: string): Promise<Result> {
  const inst = host.find(id)
  const cfg = inst.server
  if (!cfg) return { ok: false }
  if (live.has(id)) return { ok: true }
  if (inst.loader === 'quilt') return { ok: false, error: 'mc.server.unsupported' }
  const group = cfg.world === 'group' && inst.packId ? inst.packId : null
  if (group) {
    const l = await lockGroupWorld(group)
    if (!l.ok) return l
  }
  live.set(id, { state: { state: 'installing', players: [], tunnel: false }, lines: [] })
  host.changed()
  const dir = serverDir(id)
  try {
    const { java } = await host.ensure(inst)
    if (cfg.installedFor !== specKey(inst) || !cfg.args) {
      log(id, '[PoxiLauncher] Instalando el servidor…')
      cfg.args = await installServer(dir, { mc: inst.version, loader: inst.loader, loaderVersion: inst.loaderVersion }, java, join(host.root(), 'versions', inst.version, `${inst.version}.json`))
      cfg.installedFor = specKey(inst)
      host.save()
    }
    // El usuario aceptó el EULA de Minecraft al crear el servidor
    writeFileSync(join(dir, 'eula.txt'), `# Aceptado en PoxiLauncher el ${new Date(cfg.eulaAt).toISOString()}\neula=true\n`)
    const port = await freePort()
    // La primera vez, sin lista blanca: entran tus amigos (el túnel ya solo deja pasar a tus amigos). Minecraft 26.x
    // la trae activada al crear el servidor; si luego la activas tú, se respeta
    const fresh = !existsSync(join(dir, 'server.properties'))
    await writeProperties(dir, {
      'server-port': String(port),
      'online-mode': String(cfg.online),
      motd: cfg.motd.slice(0, 60),
      ...(fresh ? { 'white-list': 'false', 'enforce-whitelist': 'false' } : {})
    })
    // Mods: los de la instancia que van en el servidor
    if (inst.loader !== 'vanilla') {
      const items = await host.items(id)
      await syncServerMods(dir, join(host.dir(id), 'mods'), items.filter((c) => c.kind === 'mod' && c.enabled && c.server !== 'unsupported').map((c) => c.file))
    }
    // Mundo: el del grupo (al día) o, la primera vez, una copia de uno tuyo
    if (group) {
      const pack = host.pack(inst)
      if (pack && !(await pullGroupWorld(inst, pack))) throw new Error('world')
    } else if (typeof cfg.world === 'object' && !existsSync(join(dir, 'world'))) {
      const from = join(host.dir(id), 'saves', cfg.world.copy)
      if (existsSync(join(from, 'level.dat'))) {
        mkdirSync(dir, { recursive: true })
        cpSync(from, join(dir, 'world'), { recursive: true, filter: (p) => !p.endsWith('session.lock') })
      }
    }
    set(id, { state: 'starting', port })
    const l = live.get(id)!
    l.server = startServer(
      dir,
      java,
      cfg.args,
      cfg.ramMB,
      (line) => {
        log(id, line)
        if (/\bDone \(/.test(line)) void ready(id, port)
        const joined = /: (\w{3,16}) joined the game/.exec(line)
        const left = /: (\w{3,16}) left the game/.exec(line)
        if (joined) set(id, { players: [...new Set([...l.state.players, joined[1]])] })
        if (left) set(id, { players: l.state.players.filter((p) => p !== left[1]) })
      },
      (code) => void stopped(id, code, group)
    )
    if (group) l.lockTimer = setInterval(() => void lockGroupWorld(group), 60_000)
    return { ok: true }
  } catch (e) {
    console.error('[minecraft] servidor:', (e as Error).message)
    live.delete(id)
    host.changed()
    if (group) await accountCall('DELETE', `/mc/packs/${group}/world/lock`).catch(() => undefined)
    return { ok: false, error: (e as Error).message === 'world' ? 'mc.server.worldFailed' : 'mc.server.failed' }
  }
}

/** Ya se puede entrar: túnel para tus amigos */
async function ready(id: string, port: number): Promise<void> {
  const l = live.get(id)
  if (!l) return
  set(id, { state: 'running' })
  if (!signedIn() || !UPDATE_BASE || l.tunnel) return
  try {
    l.tunnel = await hostTunnel(UPDATE_BASE, freshAccess, port, () => {
      if (live.get(id) === l) set(id, { tunnel: false })
    })
    set(id, { tunnel: true })
    void syncNow()
  } catch (e) {
    log(id, `[PoxiLauncher] No se ha podido abrir el túnel: ${(e as Error).message}`)
  }
}

async function stopped(id: string, code: number | null, group: string | null): Promise<void> {
  const l = live.get(id)
  if (!l) return
  if (l.lockTimer) clearInterval(l.lockTimer)
  l.tunnel?.close()
  log(id, `[PoxiLauncher] Servidor cerrado (${code ?? '?'})`)
  set(id, { state: 'stopping', tunnel: false, players: [] })
  if (group) await pushGroupWorld(host.find(id), group)
  live.delete(id)
  host.changed()
  void syncNow()
}

export function stopHosting(id: string): void {
  const l = live.get(id)
  if (!l?.server) return
  set(id, { state: 'stopping' })
  l.server.stop()
}

export function serverCommand(id: string, line: string): void {
  const l = live.get(id)
  if (!l?.server) return
  log(id, `> ${line}`)
  l.server.command(line)
}

/** Para la presencia: el servidor que alojas (si no estás jugando, tus amigos ven esto) */
export function hostingPresence(): McPresence | null {
  for (const [id, l] of live) {
    if (!l.tunnel || l.state.state !== 'running') continue
    const inst = host.find(id)
    return {
      name: inst.name,
      version: inst.version,
      loader: inst.loader,
      ...(inst.packId ? { packId: inst.packId } : {}),
      tunnel: l.tunnel.id,
      premium: !!inst.server?.online
    }
  }
  return null
}

/** Puerto local del servidor de esta instancia (para entrar tú mismo) */
export const hostingPort = (id: string): number | undefined => (live.get(id)?.state.state === 'running' ? live.get(id)?.state.port : undefined)

/** Al cerrar la app: se paran todos (y el mundo del grupo sube) */
export async function stopAllHosting(): Promise<void> {
  const ids = [...live.keys()]
  ids.forEach(stopHosting)
  const deadline = Date.now() + 40_000
  while (live.size && Date.now() < deadline) await new Promise((r) => setTimeout(r, 300))
}
