import { app, BrowserWindow, dialog, safeStorage, shell } from 'electron'
import type { ChildProcess } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { totalmem } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { MinecraftFolder, Version, type ResolvedVersion } from '@xmcl/core'
import type { McAccount, McContent, McContentKind, McError, McInstance, McIssue, McLoader, McOptimizePlan, McSkinInfo, McState, McVersion, McWorld } from '@shared/types'
import { translate } from '@shared/i18n'
import { emit } from '../events'
import { getSettings } from '../settings'
import { dataPath, readJson, writeJson } from '../store'
import { AuthError, cancelLogin, loginMicrosoft, msaAvailable, refreshSession, type McSession } from './auth'
import { installInstance, javaComponent, javaPathFor, launchGame, listVersions, type McProgress, type VersionSpec } from './engine'
import { loaderVersions, type LoaderVersion, type ModLoader } from './loaders'
import * as mods from './mods'
import { explainCrash } from './crash'
import { applyPack, exportPack, exportServerPack, openPack, packSpec } from './mrpack'
import { allVersions, bestVersion, getProject, getProjects, getVersion, getVersions, loadersFor, primaryFile, projectVersions, search as mrSearch, type MrVersion } from './modrinth'
import { decideOptimize, PERF_MODS } from './optimize'
import { findIssues } from './preflight'
import { scan } from './content'
import { autoBackup, backupWorld, deleteBackup, listWorlds, restoreWorld, worldBackupsFolder, worldPath } from './worlds'
import { downloadTo, UPDATE_BASE } from '../net'
import { freshAccess, syncNow } from '../account/service'
import { hostTunnel, type HostedTunnel } from './tunnel'
import * as share from './share'
import * as hosting from './hosting'
import { getSkinInfo, resetSkin, setCape, uploadSkin, withTextures } from './skins'
import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { defaultRamMB, gameLanguage, instanceId, isValidPlayerName, lanPort, offlineUuid, withGameLanguage } from './rules'
import { hideWhilePlaying, showAfterPlaying } from '../system'
import { notify } from '../system/notify'

// Minecraft (beta): instancias (cada una con su carpeta: mundos, opciones, mods), cuentas (Microsoft y sin
// conexión) y jugar. Lo que comparten todas las instancias (versiones, librerías, recursos, Java) va una sola vez
// en la carpeta raíz.

interface Saved {
  root: string
  instances: McInstance[]
  activeAccount: string | null
  /**
   * Lo ya instalado y comprobado (para no revisar miles de archivos cada vez que se juega): "versión|loader|versión
   * del loader" → id de la versión con la que se arranca
   */
  installed: Record<string, string>
}
type StoredAccount = McAccount & { session?: Omit<McSession, 'uuid' | 'name' | 'skin'> }

const FILE = (): string => dataPath('minecraft', 'state.json')
const ACCOUNTS = (): string => dataPath('minecraft', 'accounts.bin')
const LOG = 'poxigames-last.log'
const MAX_LOG_LINES = 4000

let saved: Saved | null = null
let accounts: StoredAccount[] | null = null
let busy: McState['busy'] = null
let running: {
  id: string
  proc: ChildProcess
  stopped: boolean
  server?: { host: string; port: number }
  /** Mundo abierto a LAN: túnel para que tus amigos entren sin abrir puertos */
  tunnel?: HostedTunnel
  /** Juegas con cuenta Microsoft */
  premium: boolean
} | null = null
let abort: AbortController | null = null

const data = (): Saved => {
  saved ??= readJson<Saved>(FILE(), {
    // Juegos, versiones e instancias: en tu carpeta de usuario, a la vista (son gigas)
    root: join(app.getPath('home'), 'PoxiLauncher'),
    instances: [],
    activeAccount: null,
    installed: {}
  })
  // De la primera beta (era una lista)
  if (Array.isArray(saved.installed)) saved.installed = {}
  // Modpacks que se quedaron a medias (la app se cerró instalándolos): fuera, para que no parezcan instalados
  const broken = saved.instances.filter((i) => i.incomplete)
  if (broken.length) {
    for (const i of broken) rmSync(join(saved.root, 'instances', i.id), { recursive: true, force: true })
    saved.instances = saved.instances.filter((i) => !i.incomplete)
    writeJson(FILE(), saved)
  }
  return saved
}
const save = (): void => writeJson(FILE(), data())

// Las cuentas (con sus tokens) van cifradas con la protección de Windows del usuario, como la clave de Nexus
const accountList = (): StoredAccount[] => {
  if (accounts) return accounts
  try {
    accounts = existsSync(ACCOUNTS()) && safeStorage.isEncryptionAvailable() ? JSON.parse(safeStorage.decryptString(readFileSync(ACCOUNTS()))) : []
  } catch {
    accounts = []
  }
  return accounts ?? []
}
const saveAccounts = (): void => {
  if (!safeStorage.isEncryptionAvailable()) return
  mkdirSync(dataPath('minecraft'), { recursive: true })
  writeFileSync(ACCOUNTS(), safeStorage.encryptString(JSON.stringify(accountList())))
}

const instanceDir = (id: string): string => join(data().root, 'instances', id)

export function getMinecraft(): McState {
  const d = data()
  return {
    accounts: accountList().map(({ id, kind, name, uuid, skin }) => ({ id, kind, name, uuid, skin })),
    activeAccount: d.activeAccount,
    instances: d.instances,
    autoRamMB: defaultRamMB(totalmem() / 1024 ** 3),
    busy,
    running: running?.id ?? null,
    msa: msaAvailable(),
    ...share.packState(),
    servers: hosting.hostingState()
  }
}

const push = (): void => emit('minecraft', getMinecraft())

export async function mcVersions(): Promise<McVersion[]> {
  return (await listVersions()).map(({ id, type, releaseTime }) => ({ id, type: type as McVersion['type'], releaseTime }))
}

// ——— Instancias ———
export const mcLoaderVersions = (loader: ModLoader, mc: string): Promise<LoaderVersion[]> => loaderVersions(loader, mc)

export async function createInstance(name: string, version: string, loader: McLoader = 'vanilla', loaderVersion?: string): Promise<string> {
  if (!(await listVersions()).some((v) => v.id === version)) throw new Error('Versión desconocida')
  if (loader !== 'vanilla' && !(await loaderVersions(loader, version)).some((v) => v.id === loaderVersion)) throw new Error('Loader desconocido')
  const inst: McInstance = {
    id: instanceId(),
    name,
    version,
    loader,
    ...(loader !== 'vanilla' ? { loaderVersion } : {}),
    createdAt: Date.now(),
    lastPlayed: null,
    playtime: 0,
    ramMB: null
  }
  mkdirSync(instanceDir(inst.id), { recursive: true })
  data().instances.unshift(inst)
  save()
  push()
  return inst.id
}

const findInstance = (id: string): McInstance => {
  const inst = data().instances.find((i) => i.id === id)
  if (!inst) throw new Error('Instancia desconocida')
  return inst
}

export function updateInstance(id: string, patch: Partial<Pick<McInstance, 'name' | 'ramMB' | 'autoBackup' | 'shareSettings'>>): void {
  Object.assign(findInstance(id), patch)
  save()
  push()
}

/** Borra la instancia y su carpeta (mundos incluidos: la interfaz lo avisa antes) */
export function deleteInstance(id: string): void {
  findInstance(id)
  if (running?.id === id || busy?.instanceId === id) throw new Error('En uso')
  const dir = resolve(instanceDir(id))
  // Nunca fuera de la carpeta de instancias
  if (dir.startsWith(resolve(data().root, 'instances') + sep)) rmSync(dir, { recursive: true, force: true })
  data().instances = data().instances.filter((i) => i.id !== id)
  save()
  push()
}

export const openInstanceFolder = (id: string): void => {
  findInstance(id)
  mkdirSync(instanceDir(id), { recursive: true })
  void shell.openPath(instanceDir(id))
}

/** Lo que escribió el juego la última vez que se abrió (para ver por qué ha fallado) */
export function instanceLog(id: string): string {
  findInstance(id)
  try {
    return readFileSync(join(instanceDir(id), LOG), 'utf8')
  } catch {
    return ''
  }
}

// ——— Cuentas ———
function addAccount(a: StoredAccount): McAccount {
  const list = accountList()
  // La misma cuenta otra vez: se actualiza (nombre, skin, tokens) en lugar de duplicarla
  const i = list.findIndex((x) => x.kind === a.kind && x.uuid === a.uuid)
  if (i >= 0) a.id = list[i].id
  if (i >= 0) list[i] = a
  else list.push(a)
  data().activeAccount = a.id
  saveAccounts()
  save()
  push()
  return a
}

export function addOfflineAccount(name: string): { ok: boolean; error?: McError } {
  if (!isValidPlayerName(name)) throw new Error('Nombre no válido')
  if (accountList().some((a) => a.kind === 'offline' && a.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: 'mc.nameTaken' }
  addAccount({ id: instanceId(), kind: 'offline', name, uuid: offlineUuid(name), skin: null })
  return { ok: true }
}

const fromSession = (s: McSession, id = instanceId()): StoredAccount => ({
  id,
  kind: 'msa',
  name: s.name,
  uuid: s.uuid,
  skin: s.skin,
  session: { token: s.token, expires: s.expires, refresh: s.refresh }
})

export async function addMicrosoftAccount(): Promise<{ ok: boolean; error?: McError }> {
  try {
    const s = await loginMicrosoft((code) => emit('minecraftCode', { code }))
    addAccount(fromSession(s))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof AuthError ? (e.key as McError) : 'mc.auth.failed' }
  } finally {
    emit('minecraftCode', { code: null })
  }
}

export const cancelMicrosoftLogin = (): void => cancelLogin()

export function removeAccount(id: string): void {
  accounts = accountList().filter((a) => a.id !== id)
  if (data().activeAccount === id) data().activeAccount = accounts[0]?.id ?? null
  saveAccounts()
  save()
  push()
}

export function setActiveAccount(id: string): void {
  if (!accountList().some((a) => a.id === id)) throw new Error('Cuenta desconocida')
  data().activeAccount = id
  save()
  push()
}

/** Token de Minecraft válido para jugar (se renueva solo si le queda poco) */
async function tokenFor(a: StoredAccount): Promise<string | undefined> {
  if (a.kind === 'offline') return undefined
  if (!a.session) throw new AuthError('mc.auth.expired')
  if (a.session.expires - Date.now() > 10 * 60_000) return a.session.token
  const s = await refreshSession(a.session.refresh)
  Object.assign(a, fromSession(s, a.id))
  saveAccounts()
  return s.token
}

// ——— Jugar ———
const setBusy = (b: McState['busy']): void => {
  busy = b
  push()
}

/** Versión instalada y su Java: si no está (o no está comprobada), se instala con su barra de progreso */
const specOf = (inst: McInstance): VersionSpec => ({ mc: inst.version, loader: inst.loader, loaderVersion: inst.loaderVersion })
const specKey = (inst: McInstance): string => `${inst.version}|${inst.loader}|${inst.loaderVersion ?? ''}`

async function ensureInstalled(inst: McInstance, signal: AbortSignal): Promise<{ version: ResolvedVersion; java: string }> {
  const d = data()
  const ready = d.installed[specKey(inst)]
  if (ready) {
    try {
      const version = await Version.parse(MinecraftFolder.from(d.root), ready)
      const java = javaPathFor(d.root, javaComponent(version))
      if (existsSync(java)) return { version, java }
    } catch {
      // Falta algo: se reinstala abajo
    }
  }
  const onProgress = (p: McProgress): void => setBusy({ instanceId: inst.id, ...p })
  const r = await installInstance(d.root, specOf(inst), onProgress, signal)
  d.installed[specKey(inst)] = r.version.id
  save()
  return r
}

export async function playInstance(id: string, server?: { host: string; port: number }): Promise<{ ok: boolean; error?: McError }> {
  const inst = findInstance(id)
  if (busy || running) return { ok: false, error: 'mc.busy' }
  const account = accountList().find((a) => a.id === data().activeAccount)
  if (!account) return { ok: false, error: 'mc.noAccount' }

  abort = new AbortController()
  setBusy({ instanceId: id, stage: 'game', done: 0, total: 0 })
  let proc: ChildProcess
  try {
    let installed: { version: ResolvedVersion; java: string }
    try {
      installed = await ensureInstalled(inst, abort.signal)
    } catch (e) {
      console.error('[minecraft] instalar:', (e as Error).message)
      return { ok: false, error: abort.signal.aborted ? undefined : 'mc.installFailed' }
    }
    const token = await tokenFor(account)
    mkdirSync(instanceDir(id), { recursive: true })
    // Copia de los mundos que han cambiado desde la última (si falla, se juega igual)
    if (inst.autoBackup !== false) {
      setBusy({ instanceId: id, stage: 'backup', done: 0, total: 0 })
      await autoBackup(instanceDir(id), () => undefined).catch(() => undefined)
    }
    if (inst.shareSettings !== false) pullShared(inst)
    // El juego, siempre en el idioma de la app (aunque las opciones compartidas vengan de otra instancia en inglés)
    const options = join(instanceDir(id), 'options.txt')
    const lang = gameLanguage(inst.version, getSettings().lang)
    writeFileSync(options, withGameLanguage(existsSync(options) ? readFileSync(options, 'utf8') : '', lang))
    setBusy({ instanceId: id, stage: 'launching', done: 0, total: 0 })
    proc = await launchGame({
      root: data().root,
      gameDir: instanceDir(id),
      version: installed.version,
      java: installed.java,
      account: { name: account.name, uuid: account.uuid, token },
      ramMB: inst.ramMB ?? defaultRamMB(totalmem() / 1024 ** 3),
      server
    })
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.key as McError }
    console.error('[minecraft] arrancar:', (e as Error).message)
    return { ok: false, error: 'mc.launchFailed' }
  } finally {
    abort = null
    busy = null
    push()
  }

  watch(inst, proc)
  hideWhilePlaying()
  return { ok: true }
}

/** Sigue la partida: guarda lo que escribe el juego, cuenta el tiempo y, si se cierra de golpe, explica por qué */
function watch(inst: McInstance, proc: ChildProcess): void {
  const started = Date.now()
  running = { id: inst.id, proc, stopped: false, premium: accountList().find((a) => a.id === data().activeAccount)?.kind === 'msa' }
  inst.lastPlayed = started
  save()
  push()
  // Tus amigos ven al momento que juegas (y a qué), y Discord también
  void syncNow()
  playingListeners.forEach((fn) => fn())

  // Hay que leer siempre la salida: si nadie la lee, el juego se queda bloqueado al llenarse
  const lines: string[] = []
  let rest = ''
  const onData = (c: Buffer): void => {
    const parts = (rest + c.toString()).split(/\r?\n/)
    rest = parts.pop() ?? ''
    lines.push(...parts)
    for (const l of parts) watchServer(l)
    if (lines.length > MAX_LOG_LINES) lines.splice(0, lines.length - MAX_LOG_LINES)
  }
  proc.stdout?.on('data', onData)
  proc.stderr?.on('data', onData)

  // En qué servidor está (lo dice el propio juego al conectar): tus amigos lo ven para poder unirse
  const watchServer = (line: string): void => {
    if (!running) return
    // Abres tu mundo a LAN: túnel para tus amigos
    const lan = lanPort(line)
    if (lan && !running.tunnel && UPDATE_BASE) void openLanTunnel(lan)
    const m = /Connecting to ([a-zA-Z0-9.-]{1,253}), (\d{1,5})/.exec(line)
    const next = m ? { host: m[1], port: Number(m[2]) } : /Starting integrated minecraft server|Stopping singleplayer server|Disconnecting from server/i.test(line) ? undefined : running.server
    if (JSON.stringify(next) === JSON.stringify(running.server)) return
    running.server = next
    void syncNow()
  }

  let done = false
  const finish = (code: number | null): void => {
    if (done) return
    done = true
    const seconds = Math.round((Date.now() - started) / 1000)
    inst.playtime += seconds
    if (rest) lines.push(rest)
    try {
      writeFileSync(join(instanceDir(inst.id), LOG), lines.join('\n'))
    } catch {
      // Sin registro no pasa nada
    }
    if (inst.shareSettings !== false) pushShared(inst)
    running?.tunnel?.close()
    const stopped = running?.stopped
    if (code && !stopped) {
      // Cerrado de golpe: explicación con el registro y el informe de crasheo de esta partida
      inst.crash = { at: Date.now(), causes: explainCrash(lines.join('\n'), newestCrashReport(inst, started)) }
      // Nada más abrir: la próxima vez se revisan los archivos de la versión por si faltaba algo
      if (seconds < 60) delete data().installed[specKey(inst)]
      emit('toast', { kind: 'error', key: 'mc.crashed', params: { name: inst.name } })
    } else inst.crash = null
    running = null
    save()
    push()
    void syncNow()
    playingListeners.forEach((fn) => fn())
    showAfterPlaying()
  }
  proc.on('exit', finish)
  proc.on('error', () => finish(1))
}

/** Cancela la instalación en curso */
export const cancelInstall = (): void => abort?.abort()

/** Cierra el juego (por si se queda colgado) */
export const stopInstance = (): void => {
  if (!running) return
  // Cerrado a propósito: no es un crasheo
  running.stopped = true
  running.proc.kill()
}

// ——— Contenido (mods, resource packs, shaders) ———
const ctxOf = (id: string): mods.ContentCtx => ({ inst: findInstance(id), dir: instanceDir(id), running: running?.id === id })

export const mcContent = (id: string): Promise<McContent[]> => mods.listContent(ctxOf(id))
export const mcSearch = (id: string | null, q: string, kind: McContentKind | 'modpack', sort: 'relevance' | 'downloads' | 'updated' | 'newest', offset: number) =>
  mods.searchContent(id ? findInstance(id) : null, q, kind, sort, offset)
export const mcInstall = (id: string, projectId: string, kind: McContentKind, versionId?: string) => mods.installProject(ctxOf(id), projectId, kind, versionId)

// ——— Antes de jugar ———
/** Lo que haría que el juego se cerrara al abrirse. Sin conexión (o si Modrinth tarda), solo dependencias y repetidos */
export async function mcPreflight(id: string): Promise<McIssue[]> {
  const inst = findInstance(id)
  if (inst.loader === 'vanilla') return []
  const { items } = await scan(instanceDir(id))
  const ids = items.filter((c) => c.kind === 'mod' && c.enabled && c.versionId).map((c) => c.versionId!)
  const versions = ids.length
    ? await Promise.race([getVersions(ids).then((l) => new Map(l.map((v) => [v.id, v]))), new Promise<null>((r) => setTimeout(() => r(null), 5000))]).catch(() => null)
    : new Map()
  const issues = findIssues(items, versions, inst)
  // El nombre de las dependencias que faltan (si Modrinth contesta)
  const missing = issues.filter((i) => i.kind === 'missingDep').map((i) => i.projectId!)
  if (missing.length) {
    const names = new Map((await getProjects(missing).catch(() => [])).map((p) => [p.id, p.title]))
    for (const i of issues) if (i.kind === 'missingDep') i.other = names.get(i.projectId!) ?? i.other
  }
  return issues
}

/** Arregla todo lo que se pueda (cada arreglo queda en el Historial) */
export async function mcFixIssues(id: string): Promise<{ ok: boolean; error?: McError }> {
  const inst = findInstance(id)
  let error: McError | undefined
  for (const i of await mcPreflight(id)) {
    const ctx = ctxOf(id)
    let r: { ok: boolean; error?: McError } = { ok: true }
    if (i.fix === 'disable' || i.fix === 'enable') r = await mods.toggleContent(ctx, i.files ?? [], i.fix === 'enable')
    else if (i.fix === 'install') r = await mods.installProject(ctx, i.projectId!, 'mod')
    else if (i.fix === 'update') {
      // La versión buena para esta instancia; si no existe, fuera
      const best = bestVersion(await projectVersions(i.projectId!, inst.version, loadersFor(inst.loader)).catch(() => []))
      r = best ? await mods.setVersions(ctx, [best.id]) : await mods.toggleContent(ctx, i.files ?? [], false)
    }
    if (!r.ok) error = r.error ?? error
  }
  return { ok: !error, error }
}

// ——— Optimizar con un clic ———
/** Las versiones de los mods de rendimiento que valen para la instancia (vanilla: las de Fabric) y qué hacer con cada uno */
async function optimizeFor(id: string): Promise<{ plan: McOptimizePlan; best: Map<string, MrVersion | undefined> }> {
  const inst = findInstance(id)
  const vanilla = inst.loader === 'vanilla'
  const loaders = loadersFor(vanilla ? 'fabric' : inst.loader)
  let failed = 0
  const found = await Promise.all(
    PERF_MODS.map((m) =>
      projectVersions(m.id, inst.version, loaders)
        .then(bestVersion)
        .catch(() => void failed++)
    )
  )
  if (failed === PERF_MODS.length) throw new Error('Sin conexión')
  const best = new Map(PERF_MODS.map((m, i) => [m.id, found[i] || undefined]))
  const titles = new Map((await getProjects(PERF_MODS.map((m) => m.id)).catch(() => [])).map((p) => [p.id, p.title]))
  const installed = vanilla ? [] : await mods.listContent(ctxOf(id))
  return { plan: { vanilla, items: decideOptimize(best, installed, titles), ramMB: inst.ramMB ?? defaultRamMB(totalmem() / 1024 ** 3) }, best }
}

export const mcOptimizePlan = async (id: string): Promise<McOptimizePlan | null> => (await optimizeFor(id).catch(() => null))?.plan ?? null

/**
 * Instala los elegidos (solo los que el plan dice que se pueden). Vanilla: una copia en Fabric con sus mundos y
 * opciones, y los mods en la copia; la original no se toca. Devuelve la instancia optimizada.
 */
export async function mcOptimize(id: string, chosen: string[]): Promise<{ ok: boolean; id?: string; error?: McError }> {
  let r: Awaited<ReturnType<typeof optimizeFor>>
  try {
    r = await optimizeFor(id)
  } catch {
    return { ok: false, error: 'mc.downloadFailed' }
  }
  const versions = r.plan.items.filter((i) => i.status === 'add' && chosen.includes(i.projectId)).map((i) => r.best.get(i.projectId)!)
  if (!versions.length) return { ok: true, id }
  let target = id
  if (r.plan.vanilla) {
    const inst = findInstance(id)
    const fabric = (await loaderVersions('fabric', inst.version).catch(() => [])).find((v) => v.stable) ?? null
    if (!fabric) return { ok: false, error: 'mc.noVersion' }
    target = duplicateInstance(id, true)
    // La copia es suya: en Fabric, sin el pack del grupo ni el servidor de la original
    const copy = findInstance(target)
    copy.name = `${inst.name} (${translate(getSettings().lang, 'mc.optimize.copySuffix')})`.slice(0, 40)
    copy.loader = 'fabric'
    copy.loaderVersion = fabric.id
    delete copy.packId
    delete copy.server
    save()
    push()
  }
  const done = await mods.installVersions(ctxOf(target), versions.map((v) => ({ v, kind: 'mod' as const })), 'mc.history.optimize', { n: String(versions.length) })
  return { ok: done.ok, error: done.error, id: target }
}
export const mcProjectVersions = (id: string, projectId: string, kind: McContentKind) => mods.projectVersionList(ctxOf(id), projectId, kind)
export const mcUpdates = (id: string) => mods.checkUpdates(ctxOf(id))
export const mcSetVersions = (id: string, versionIds: string[], downgrade: boolean) =>
  mods.setVersions(ctxOf(id), versionIds, downgrade ? 'mc.history.version' : 'mc.history.update')
export const mcRemove = (id: string, files: string[], orphans: boolean) => mods.removeContent(ctxOf(id), files, orphans)
export const mcToggle = (id: string, files: string[], enabled: boolean) => mods.toggleContent(ctxOf(id), files, enabled)
export const mcToggleTag = (id: string, tag: string, enabled: boolean) => mods.toggleTag(ctxOf(id), tag, enabled)
export const mcEditContent = (id: string, file: string, patch: Pick<McContent, 'locked' | 'tags'>) => mods.editContent(ctxOf(id), file, patch)
export const mcHistory = (id: string) => mods.history(ctxOf(id))
export const mcRollback = (id: string, at: number) => mods.rollback(ctxOf(id), at)

// ——— Crasheos ———
/** El informe de crasheo que ha escrito esta partida (si ha escrito alguno) */
function newestCrashReport(inst: McInstance, since: number): string {
  const d = join(instanceDir(inst.id), 'crash-reports')
  try {
    const f = readdirSync(d)
      .map((n) => ({ n, t: statSync(join(d, n)).mtimeMs }))
      .filter((x) => x.t >= since - 5000)
      .sort((a, b) => b.t - a.t)[0]
    return f ? readFileSync(join(d, f.n), 'utf8').slice(0, 200_000) : ''
  } catch {
    return ''
  }
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Aplica el arreglo que propone el explicador (instalar lo que falta, apagar el mod culpable o dar más RAM) */
export async function fixCrash(id: string, index: number): Promise<{ ok: boolean; error?: McError }> {
  const inst = findInstance(id)
  const cause = inst.crash?.causes[index]
  const fix = cause?.fix
  if (!fix) return { ok: false }
  let r: { ok: boolean; error?: McError } = { ok: false }
  if (fix.type === 'ram') {
    const total = Math.floor((totalmem() / 1024 ** 2) * 0.75)
    const now = inst.ramMB ?? defaultRamMB(totalmem() / 1024 ** 3)
    updateInstance(id, { ramMB: Math.min(total, now + 2048) })
    r = { ok: true }
  } else if (fix.type === 'install') {
    // El id del mod suele ser su nombre en Modrinth ("sodium", "fabric-api"…)
    const found = await mrSearch(fix.modId, 'mod', inst.version, inst.loader, 'relevance', 0).catch(() => null)
    const hit = found?.hits.find((h) => h.slug === fix.modId || norm(h.title) === norm(fix.modId)) ?? found?.hits[0]
    if (!hit) return { ok: false, error: 'mc.noVersion' }
    r = await mods.installProject(ctxOf(id), hit.project_id, 'mod')
  } else if (fix.type === 'version') {
    // La versión que pide el loader ("0.6.x", ">=1.2"…): la más nueva de Modrinth que la cumple
    const items = await mods.listContent(ctxOf(id))
    const m = norm(fix.modId)
    const item = items.find((c) => c.kind === 'mod' && c.projectId && (norm(c.title) === m || norm(c.file).startsWith(m)))
    if (!item?.projectId) return { ok: false, error: 'mc.noVersion' }
    const picked = await mods.versionFor(ctxOf(id), item.projectId, fix.want)
    if (!picked) return { ok: false, error: 'mc.noVersion' }
    r = await mods.setVersions(ctxOf(id), [picked], 'mc.history.version')
  } else if (fix.type === 'disable') {
    const items = await mods.listContent(ctxOf(id))
    const m = norm(fix.modId)
    const item = items.find((c) => c.kind === 'mod' && c.enabled && (norm(c.title) === m || norm(c.file).startsWith(m)))
    if (!item) return { ok: false, error: 'mc.noVersion' }
    r = await mods.toggleContent(ctxOf(id), [item.file], false)
  }
  if (r.ok) {
    // Arreglado: el aviso entero sobra (las demás causas suelen ser el mismo problema contado desde el otro mod; si
    // queda algo, el próximo crasheo lo vuelve a explicar)
    inst.crash = null
    save()
    push()
  }
  return r
}

export function dismissCrash(id: string): void {
  findInstance(id).crash = null
  save()
  push()
}

// ——— Ajustes compartidos entre instancias (opciones, teclas, servidores) ———
const SHARED = ['options.txt', 'servers.dat', 'optionsof.txt', 'optionsshaders.txt']
const sharedDir = (): string => join(data().root, 'shared')

/** Antes de jugar: los ajustes compartidos (los últimos que se guardaron en cualquier instancia) */
function pullShared(inst: McInstance): void {
  for (const f of SHARED) {
    const from = join(sharedDir(), f)
    if (existsSync(from)) copyFileSync(from, join(instanceDir(inst.id), f))
  }
}

/** Al cerrar el juego: lo que se haya cambiado pasa a ser lo compartido */
function pushShared(inst: McInstance): void {
  mkdirSync(sharedDir(), { recursive: true })
  for (const f of SHARED) {
    const from = join(instanceDir(inst.id), f)
    try {
      if (existsSync(from)) copyFileSync(from, join(sharedDir(), f))
    } catch {
      // Sin compartir esta vez
    }
  }
}

// ——— Duplicar ———
export function duplicateInstance(id: string, withWorlds: boolean): string {
  const inst = findInstance(id)
  const copy: McInstance = { ...inst, id: instanceId(), name: `${inst.name} (2)`.slice(0, 40), createdAt: Date.now(), lastPlayed: null, playtime: 0, crash: null }
  const from = instanceDir(id)
  // Fuera: el historial de la original, registros, crasheos y (si no se piden) los mundos
  const skip = new Set(['logs', 'crash-reports', ...(withWorlds ? [] : ['saves'])])
  cpSync(from, instanceDir(copy.id), {
    recursive: true,
    filter: (src) => {
      const rel = src.slice(from.length + 1).split(/[\\/]/)
      return !(skip.has(rel[0]) || (rel[0] === '.poxigames' && (rel[1] === 'history' || rel[1] === 'cache' || rel[1] === 'worlds')))
    }
  })
  data().instances.unshift(copy)
  save()
  push()
  return copy.id
}

// ——— Mundos ———
export const mcWorlds = (id: string): Promise<McWorld[]> => listWorlds(instanceDir(findInstance(id).id))

const worldOf = (id: string, world: string): string => {
  findInstance(id)
  if (!worldPath(instanceDir(id), world)) throw new Error('Mundo desconocido')
  return world
}

export async function mcBackupWorld(id: string, world: string): Promise<{ ok: boolean }> {
  return { ok: !!(await backupWorld(instanceDir(id), worldOf(id, world), false)) }
}

export async function mcRestoreWorld(id: string, world: string, at: number): Promise<{ ok: boolean; error?: McError }> {
  if (running?.id === id) return { ok: false, error: 'mc.running' }
  findInstance(id)
  if (basename(world) !== world) throw new Error('Mundo no válido')
  return { ok: await restoreWorld(instanceDir(id), world, at) }
}

export const mcDeleteBackup = (id: string, world: string, at: number): Promise<void> => deleteBackup(instanceDir(id), worldOf(id, world), at)

export const mcOpenBackups = (id: string, world: string): void => {
  const d = worldBackupsFolder(instanceDir(id), worldOf(id, world))
  mkdirSync(d, { recursive: true })
  void shell.openPath(d)
}

// ——— Modpacks (.mrpack) ———
/** Crea una instancia a partir de un .mrpack ya descargado */
async function importFile(file: string, icon: string | null): Promise<{ ok: boolean; id?: string; error?: McError }> {
  if (busy || running) return { ok: false, error: 'mc.busy' }
  let pack: Awaited<ReturnType<typeof openPack>>
  try {
    pack = await openPack(file)
  } catch {
    return { ok: false, error: 'mc.badPack' }
  }
  try {
    const spec = packSpec(pack.index)
    if (!spec) return { ok: false, error: 'mc.badPack' }
    const inst: McInstance = {
      id: instanceId(),
      name: pack.index.name.slice(0, 40) || 'Modpack',
      version: spec.mc,
      loader: spec.loader,
      ...(spec.loaderVersion ? { loaderVersion: spec.loaderVersion } : {}),
      icon,
      createdAt: Date.now(),
      lastPlayed: null,
      playtime: 0,
      ramMB: null,
      incomplete: true
    }
    mkdirSync(instanceDir(inst.id), { recursive: true })
    data().instances.unshift(inst)
    save()
    setBusy({ instanceId: inst.id, stage: 'modpack', done: 0, total: pack.index.files.length })
    try {
      await applyPack(instanceDir(inst.id), pack.index, pack.root, (done, total) => setBusy({ instanceId: inst.id, stage: 'modpack', done, total }))
    } catch (e) {
      console.error('[minecraft] modpack:', (e as Error).message)
      // A medias no sirve: fuera la instancia
      busy = null
      deleteInstance(inst.id)
      return { ok: false, error: 'mc.downloadFailed' }
    }
    busy = null
    delete inst.incomplete
    save()
    // Lista de contenido con los datos de Modrinth (por hash)
    await mods.listContent(ctxOf(inst.id)).catch(() => undefined)
    push()
    return { ok: true, id: inst.id }
  } finally {
    busy = null
    push()
    await pack.cleanup()
  }
}

/** Importar un .mrpack del disco (se elige con la ventana de Windows) */
export async function importPackFile(): Promise<{ ok: boolean; id?: string; error?: McError }> {
  const smoke = smokeFile()
  if (smoke) return importFile(smoke, null)
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }] })
  if (r.canceled || !r.filePaths[0]) return { ok: false }
  return importFile(r.filePaths[0], null)
}

/** Instalar un modpack de Modrinth (la versión dada o la mejor) */
export async function installModpack(projectId: string, versionId?: string): Promise<{ ok: boolean; id?: string; error?: McError }> {
  if (busy || running) return { ok: false, error: 'mc.busy' }
  let file: string | null = null
  try {
    const [project, version] = await Promise.all([
      getProject(projectId),
      versionId ? getVersion(versionId) : allVersions(projectId).then((l) => bestVersion(l))
    ])
    const f = version && primaryFile(version)
    if (!f || version.project_id !== project.id) return { ok: false, error: 'mc.noVersion' }
    file = join(tmpdir(), `poxi-${project.id}-${Date.now()}.mrpack`)
    await downloadTo(f.url, file, () => undefined)
    const hash = createHash('sha512').update(await readFile(file)).digest('hex')
    if (hash !== f.hashes.sha512) return { ok: false, error: 'mc.downloadFailed' }
    return await importFile(file, project.icon_url)
  } catch {
    return { ok: false, error: 'mc.downloadFailed' }
  } finally {
    if (file) await rm(file, { force: true })
  }
}

/** Pruebas automáticas (solo sin empaquetar): las ventanas de archivos devuelven esta ruta en vez de abrirse */
const smokeFile = (): string | null => (!app.isPackaged && process.env.POXI_SMOKE_FILE) || null

async function saveDialog(defaultName: string, ext: string, label: string): Promise<string | null> {
  const smoke = smokeFile()
  if (smoke) return smoke.replace(/\.[a-z]+$/, `.${ext}`)
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const r = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters: [{ name: label, extensions: [ext] }] })
  return r.canceled || !r.filePath ? null : r.filePath
}

const fileName = (name: string): string => name.replace(/[<>:"/\\|?*]+/g, '').trim() || 'Minecraft'

export async function exportInstancePack(id: string): Promise<{ ok: boolean }> {
  const inst = findInstance(id)
  const dest = await saveDialog(`${fileName(inst.name)}.mrpack`, 'mrpack', 'Modrinth modpack')
  if (!dest) return { ok: false }
  const items = await mods.listContent(ctxOf(id))
  const ok = await exportPack(instanceDir(id), inst, items, dest).catch(() => false)
  if (ok && !smokeFile()) shell.showItemInFolder(dest)
  return { ok }
}

export async function exportInstanceServer(id: string): Promise<{ ok: boolean }> {
  const inst = findInstance(id)
  const dest = await saveDialog(`${fileName(inst.name)} (servidor).zip`, 'zip', 'Zip')
  if (!dest) return { ok: false }
  const items = await mods.listContent(ctxOf(id))
  const lang = getSettings().lang
  const readme = translate(lang, 'mc.serverPack.readme', {
    name: inst.name,
    mc: inst.version,
    loader: translate(lang, `mc.loader.${inst.loader}`),
    lv: inst.loaderVersion ?? ''
  })
  const ok = await exportServerPack(instanceDir(id), inst, items, dest, readme).catch(() => false)
  if (ok && !smokeFile()) shell.showItemInFolder(dest)
  return { ok }
}

// ——— Packs compartidos con amigos ———
share.initShare({
  instances: () => data().instances,
  find: findInstance,
  ctx: ctxOf,
  create: async (name, mc, loader, loaderVersion, icon) => {
    const id = await createInstance(name.slice(0, 40), mc, loader, loaderVersion)
    if (icon) {
      findInstance(id).icon = icon
      save()
    }
    return id
  },
  setPack: (id, packId) => {
    const inst = findInstance(id)
    if (packId) inst.packId = packId
    else delete inst.packId
    save()
    push()
  },
  changed: () => push(),
  play: (id, server) => playInstance(id, server),
  premium: () => accountList().find((a) => a.id === data().activeAccount)?.kind === 'msa',
  onGameEnd: (fn) => {
    const off = (): void => {
      if (mcPlaying()) return
      const i = playingListeners.indexOf(off)
      if (i >= 0) playingListeners.splice(i, 1)
      fn()
    }
    playingListeners.push(off)
  },
  presence: () => {
    // Sin jugar: el servidor que alojas (si alojas uno)
    if (!running) return hosting.hostingPresence()
    const inst = data().instances.find((i) => i.id === running!.id)
    if (!inst) return null
    // Jugando en tu propio servidor: tus amigos ven su túnel
    const hosted = running.tunnel ? null : hosting.hostingPresence()
    return {
      name: inst.name,
      version: inst.version,
      loader: inst.loader,
      ...(inst.packId ? { packId: inst.packId } : {}),
      ...(running.server ? { server: running.server } : {}),
      ...(running.tunnel ? { tunnel: running.tunnel.id } : hosted?.tunnel ? { tunnel: hosted.tunnel } : {}),
      // Un mundo en LAN siempre pide cuenta Microsoft a quien entra (Minecraft lo abre en modo online, sea cual sea
      // tu cuenta); el servidor, lo que diga su configuración
      premium: hosted ? !!hosted.premium : running.tunnel ? true : running.premium
    }
  }
})

// ——— Para Discord ———
const playingListeners: (() => void)[] = []
/** Empieza o termina una partida de Minecraft */
export const onMcPlaying = (fn: () => void): void => {
  playingListeners.push(fn)
}
/** La instancia con la que se está jugando ahora (null si ninguna) */
export const mcPlaying = (): McInstance | null => (running ? (data().instances.find((i) => i.id === running!.id) ?? null) : null)

// ——— Skins (cuentas Microsoft) ———
const msaAccount = (id: string): StoredAccount => {
  const a = accountList().find((x) => x.id === id)
  if (!a || a.kind !== 'msa') throw new Error('Cuenta no válida')
  return a
}

/** Tras cambiar la skin: la cabeza de la cuenta en la app, al día */
async function refreshSkin(a: StoredAccount, token: string): Promise<McSkinInfo> {
  const info = await getSkinInfo(token)
  a.skin = info.skin?.url ?? null
  saveAccounts()
  push()
  return withTextures(info)
}

export async function mcSkin(id: string): Promise<McSkinInfo | null> {
  const a = msaAccount(id)
  try {
    return await refreshSkin(a, (await tokenFor(a))!)
  } catch {
    return null
  }
}

export async function mcSetSkin(id: string, png: Buffer, variant: 'classic' | 'slim'): Promise<McSkinInfo | null> {
  const a = msaAccount(id)
  const token = (await tokenFor(a))!
  await uploadSkin(token, png, variant)
  return refreshSkin(a, token)
}

export async function mcResetSkin(id: string): Promise<McSkinInfo | null> {
  const a = msaAccount(id)
  const token = (await tokenFor(a))!
  await resetSkin(token)
  return refreshSkin(a, token)
}

export async function mcSetCape(id: string, capeId: string | null): Promise<McSkinInfo | null> {
  const a = msaAccount(id)
  const token = (await tokenFor(a))!
  await setCape(token, capeId)
  return refreshSkin(a, token)
}

/** Mundo abierto a LAN: túnel por el servidor para que tus amigos entren sin abrir puertos */
async function openLanTunnel(port: number): Promise<void> {
  const r = running
  if (!r) return
  try {
    const t = await hostTunnel(UPDATE_BASE, freshAccess, port)
    // Si el juego se ha cerrado mientras se abría, fuera
    if (running !== r) return t.close()
    r.tunnel = t
    void syncNow()
    emit('toast', { kind: 'success', key: 'mc.lan.open' })
    // Con cuenta sin conexión: tus amigos sin Microsoft no podrán entrar (el juego no lo permite en LAN)
    if (!r.premium) notify('mc.lan.offlineFriends', {}, 'info')
  } catch (e) {
    console.error('[minecraft] túnel:', (e as Error).message)
  }
}

// ——— Servidor en tu PC desde una instancia ———
hosting.initHosting({
  find: findInstance,
  dir: instanceDir,
  root: () => data().root,
  ensure: async (inst) => {
    // Misma instalación que para jugar (versión, Java y loader), con su barra de progreso
    try {
      return await ensureInstalled(inst, new AbortController().signal)
    } finally {
      busy = null
      push()
    }
  },
  items: (id) => mods.listContent(ctxOf(id)),
  pack: (inst) => share.packState().packs.find((p) => p.id === inst.packId && !p.invited),
  save,
  changed: () => push()
})

/** Entrar tú en el servidor de esta instancia */
export function playOwnServer(id: string): Promise<{ ok: boolean; error?: McError }> {
  const port = hosting.hostingPort(id)
  return port ? playInstance(id, { host: '127.0.0.1', port }) : Promise.resolve({ ok: false, error: 'mc.server.failed' as const })
}

export const openServerFolder = (id: string): void => {
  findInstance(id)
  const d = join(instanceDir(id), 'server')
  mkdirSync(d, { recursive: true })
  void shell.openPath(d)
}
