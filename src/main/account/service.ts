import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { AccountError, AccountResult, AccountState, Friend, McPack, McPresence, Me, ReportBody } from '@shared/types'
import { emit } from '../events'
import { serverFetch, serverStream } from '../net'
import { dataPath } from '../store'
import { getSettings } from '../settings'
import { notify } from '../system/notify'
import { imageType, sanitizeProfile, shownName, type ProfilePatch } from '@shared/profile'
import type { ChatInvite } from '@shared/chat'

// Cuenta y amigos (en el servidor de PoxiLauncher). El token de renovación (30 días)
// se guarda cifrado con safeStorage (atado al usuario de Windows); el de acceso (15 min) solo vive en memoria.
// Cada 30 s un latido le dice al servidor si estás conectado o jugando a Minecraft, y trae el estado de los amigos.

const FILE = (): string => dataPath('account.bin')
const BEAT_MS = 30_000

let session: { refresh: string; user: Me } | null = null
let access = ''
let state: AccountState = { user: null, friends: [], incoming: [], outgoing: [], offline: false }
/** Ya se recibió la lista de amigos una vez (los que ya jugaban al abrir no avisan) */
let friendsLoaded = false

const push = (patch: Partial<AccountState>): void => {
  state = { ...state, ...patch }
  emit('account', state)
}

export const getAccount = (): AccountState => state

function persist(): void {
  try {
    if (!session) rmSync(FILE(), { force: true })
    // Sin cifrado disponible no se guarda en disco: la sesión dura lo que dure la app abierta
    else if (safeStorage.isEncryptionAvailable()) writeFileSync(FILE(), safeStorage.encryptString(JSON.stringify(session)))
  } catch (e) {
    console.error('Cuenta:', (e as Error).message)
  }
}

function load(): void {
  try {
    if (existsSync(FILE()) && safeStorage.isEncryptionAvailable()) session = JSON.parse(safeStorage.decryptString(readFileSync(FILE())))
  } catch {
    session = null
  }
}

/** Al iniciar sesión (o renovarla): lo que depende de la cuenta se pide de nuevo (juegos a mano…) */
const sessionListeners: (() => void)[] = []
export const onSession = (fn: () => void): void => void sessionListeners.push(fn)

function setSession(data: { access: string; refresh: string; user: Me }): void {
  const fresh = !session
  access = data.access
  const user = { ...data.user, profile: sanitizeProfile(data.user.profile) }
  session = { refresh: data.refresh, user }
  persist()
  push({ user, offline: false })
  startLive()
  if (fresh) for (const fn of sessionListeners) fn()
}

function signOut(): void {
  stopLive()
  session = null
  access = ''
  friendsLoaded = false
  persist()
  push({ user: null, friends: [], incoming: [], outgoing: [], offline: false })
  for (const fn of beatListeners) void fn().catch(() => undefined)
}

type Reply = { status: number; data: Record<string, unknown> }

async function send(method: string, path: string, body?: unknown, auth = true): Promise<Reply> {
  const res = await serverFetch(`/api/u${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth && access ? { Authorization: `Bearer ${access}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> }
}

/** Petición con sesión: si el token de acceso caducó, se renueva y se repite. Si ya no vale, se cierra la sesión. */
async function call(method: string, path: string, body?: unknown): Promise<Reply> {
  let r = await send(method, path, body)
  if (r.status === 401 && session) {
    const renewed = await send('POST', '/refresh', { refresh: session.refresh }, false)
    if (renewed.status !== 200) {
      signOut()
      notify('account.expired', {}, 'error')
      return r
    }
    setSession(renewed.data as never)
    r = await send(method, path, body)
  }
  return r
}

function setFriends(data: Record<string, unknown>): void {
  // El nombre que se ve (lista, perfil, avisos…): el apodo que le pusiste, o el nombre visible que eligió; su usuario
  // queda en realName. El perfil llega limpio (solo colores y opciones que se saben pintar)
  const friends = ((data.friends ?? []) as Friend[]).map((raw) => {
    const f = { ...raw, profile: sanitizeProfile(raw.profile) }
    const shown = shownName(f.username, f.profile, f.nickname)
    return shown !== f.username ? { ...f, realName: f.username, username: shown } : f
  })
  const before = new Map(state.friends.map((f) => [f.id, f]))
  if (friendsLoaded && getSettings().friendAlerts) {
    for (const f of friends) {
      const prev = before.get(f.id)
      if (f.state === 'playing' && prev?.state !== 'playing') notify('friends.startedPlaying', { name: f.username, game: f.gameName || 'Minecraft' })
    }
  }
  // Solicitudes nuevas y solicitudes tuyas aceptadas: se avisa (antes solo cambiaba un numerito)
  if (friendsLoaded) {
    const incoming = (data.incoming ?? []) as AccountState['incoming']
    const had = new Set(state.incoming.map((r) => r.id))
    for (const r of incoming) if (!had.has(r.id)) notify('friends.newRequest', { name: r.username })
    const asked = new Set(state.outgoing.map((r) => r.id))
    for (const f of friends) if (asked.has(f.id) && !before.has(f.id)) notify('friends.accepted', { name: f.username }, 'success')
  }
  friendsLoaded = true
  // Los que juegan arriba, luego los conectados; dentro de cada grupo, por nombre
  const rank = { playing: 0, online: 1, offline: 2 }
  friends.sort((a, b) => rank[a.state] - rank[b.state] || a.username.localeCompare(b.username))
  push({
    friends,
    incoming: (data.incoming ?? []) as AccountState['incoming'],
    outgoing: (data.outgoing ?? []) as AccountState['outgoing'],
    blocked: (data.blocked ?? []) as NonNullable<AccountState['blocked']>,
    offline: false
  })
}

// ——— Fotos de perfil ———
// La tuya y las de tus amigos, guardadas en este PC por versión: cada una se descarga una sola vez.
const AVATARS = (): string => dataPath('avatars')
const WEBP_DATA = /^data:image\/webp;base64,([A-Za-z0-9+/]+=*)$/
const MAX_AVATAR = 150 * 1024
/** Firma de un WebP (el servidor comprueba el resto: medidas, sin animación…) */
const isWebp = (b: Buffer): boolean =>
  b.length > 30 && b.length <= MAX_AVATAR && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'

/** Petición con sesión que no es JSON (la foto): renueva el token si hace falta, como call() */
export async function rawCall(
  method: string,
  path: string,
  body?: Buffer,
  type = 'image/webp',
  opts: { headers?: Record<string, string>; timeoutMs?: number } = {}
): Promise<Response> {
  const go = (): Promise<Response> =>
    serverFetch(`/api/u${path}`, {
      method,
      headers: { ...opts.headers, ...(body ? { 'Content-Type': type } : {}), Authorization: `Bearer ${access}` },
      body: body ? new Uint8Array(body) : undefined,
      timeoutMs: opts.timeoutMs
    })
  let res = await go()
  if (res.status === 401 && session) {
    const renewed = await send('POST', '/refresh', { refresh: session.refresh }, false)
    if (renewed.status !== 200) return res
    setSession(renewed.data as never)
    res = await go()
  }
  return res
}

async function cacheAvatar(id: string, version: string, buf: Buffer): Promise<void> {
  await mkdir(AVATARS(), { recursive: true })
  await writeFile(join(AVATARS(), `${id}-${version}.webp`), buf)
  // Las versiones viejas de esa foto ya no sirven
  for (const f of await readdir(AVATARS()).catch(() => [] as string[]))
    if (f.startsWith(`${id}-`) && f !== `${id}-${version}.webp`) await rm(join(AVATARS(), f), { force: true })
}

/** Foto de una cuenta (la tuya o la de un amigo) como data URL. null: sin foto o no se pudo traer. */
export async function avatarOf(id: string, version: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f]{16}$/.test(version)) return null
  // La versión es la huella de la propia foto: así se sabe si lo guardado (o lo recibido) es de verdad esa versión
  const isVersion = (b: Buffer): boolean => createHash('sha256').update(b).digest('hex').slice(0, 16) === version
  const file = join(AVATARS(), `${id}-${version}.webp`)
  let buf = await readFile(file).catch(() => null)
  if (!buf || !isVersion(buf)) {
    if (!session) return null
    // Con la versión en la dirección: la caché del navegador de la app no puede devolver la foto de otra versión
    const res = await rawCall('GET', `/avatar/${id}?v=${version}`).catch(() => null)
    if (!res?.ok) return null
    buf = Buffer.from(await res.arrayBuffer())
    if (!isWebp(buf)) return null
    // Si ha vuelto a cambiar justo ahora, se enseña pero no se guarda con un nombre que no es el suyo
    if (isVersion(buf)) await cacheAvatar(id, version, buf)
  }
  return `data:image/webp;base64,${buf.toString('base64')}`
}

/** Sube tu foto (ya recortada y en WebP por la interfaz) */
export async function setAvatar(dataUrl: string): Promise<AccountResult> {
  const m = WEBP_DATA.exec(dataUrl)
  const buf = m ? Buffer.from(m[1], 'base64') : null
  if (!session || !buf || !isWebp(buf)) return fail('invalid')
  try {
    const res = await rawCall('PUT', '/avatar', buf)
    if (!res.ok) return fail('invalid')
    const { avatar } = (await res.json()) as { avatar: string }
    await cacheAvatar(session.user.id, avatar, buf)
    session.user = { ...session.user, avatar }
    persist()
    push({ user: session.user })
    return { ok: true }
  } catch (e) {
    return errorOf(e)
  }
}

/** Guarda los cambios de tu perfil (solo lo que llega) */
export async function setProfile(patch: ProfilePatch): Promise<AccountResult> {
  if (!session) return fail('invalid')
  try {
    const res = await call('PUT', '/profile', patch)
    // 409: algo de PoxiDrops que no tienes, o el nombre visible es de otra cuenta
    if (res.status === 409) return fail('taken')
    if (res.status !== 200) return fail(res.status === 400 ? 'invalid' : 'offline')
    session.user = { ...session.user, ...(res.data as Partial<Me>), profile: sanitizeProfile((res.data as { profile?: unknown }).profile) }
    persist()
    push({ user: session.user })
    return { ok: true }
  } catch (e) {
    return errorOf(e)
  }
}

// ——— Banner de imagen o GIF (hasta 20 MB) ———
const BANNERS = (): string => dataPath('banners')
const MIMES = { gif: 'image/gif', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const

/** Sube tu banner (el servidor comprueba que es una imagen de verdad) */
export async function setBanner(bytes: Uint8Array): Promise<AccountResult> {
  if (!session) return fail('invalid')
  const type = imageType(bytes)
  if (!type) return fail('invalid')
  try {
    const res = await rawCall('PUT', '/banner', Buffer.from(bytes), MIMES[type])
    if (res.status === 413 || res.status === 400) return fail('invalid')
    if (!res.ok) return fail('offline')
    const me = (await res.json()) as Me
    session.user = { ...session.user, ...me, profile: sanitizeProfile(me.profile) }
    persist()
    push({ user: session.user })
    return { ok: true }
  } catch (e) {
    return errorOf(e)
  }
}

export async function removeBanner(): Promise<AccountResult> {
  if (!session) return fail('invalid')
  try {
    const res = await rawCall('DELETE', '/banner')
    if (!res.ok) return fail('offline')
    const me = (await res.json()) as Me
    session.user = { ...session.user, ...me, profile: sanitizeProfile(me.profile) }
    persist()
    push({ user: session.user })
    return { ok: true }
  } catch (e) {
    return errorOf(e)
  }
}

/**
 * poxi-img://banner/<cuenta>/<versión>: el banner de un perfil, desde el disco (cada versión se baja una sola vez).
 * La versión es la huella del archivo: lo guardado o lo recibido tiene que ser de verdad esa versión.
 */
export async function serveBanner(request: Request): Promise<Response> {
  const [, id, version] = new URL(request.url).pathname.split('/')
  if (!/^[0-9a-f-]{36}$/.test(id ?? '') || !/^[0-9a-f]{16}$/.test(version ?? '')) return new Response(null, { status: 400 })
  const file = join(BANNERS(), `${id}-${version}`)
  const isVersion = (b: Buffer): boolean => createHash('sha256').update(b).digest('hex').slice(0, 16) === version
  let buf = await readFile(file).catch(() => null)
  if (!buf || !isVersion(buf)) {
    if (!session) return new Response(null, { status: 404 })
    const res = await rawCall('GET', `/banner/${id}?v=${version}`).catch(() => null)
    if (!res?.ok) return new Response(null, { status: 404 })
    buf = Buffer.from(await res.arrayBuffer())
    if (!imageType(buf)) return new Response(null, { status: 404 })
    if (isVersion(buf)) {
      await mkdir(BANNERS(), { recursive: true })
      await writeFile(file, buf)
      // Las versiones viejas de ese banner ya no sirven
      for (const f of await readdir(BANNERS()).catch(() => [] as string[])) if (f.startsWith(`${id}-`) && f !== `${id}-${version}`) await rm(join(BANNERS(), f), { force: true })
    }
  }
  const type = imageType(buf)
  return new Response(new Uint8Array(buf), { headers: { 'Content-Type': type ? MIMES[type] : 'application/octet-stream', 'Cache-Control': 'max-age=31536000' } })
}

export async function removeAvatar(): Promise<AccountResult> {
  if (!session) return fail('invalid')
  try {
    const res = await rawCall('DELETE', '/avatar')
    if (!res.ok) return fail('offline')
    session.user = { ...session.user, avatar: null }
    persist()
    push({ user: session.user })
    return { ok: true }
  } catch (e) {
    return errorOf(e)
  }
}

async function beat(): Promise<void> {
  if (!session) return
  try {
    const version = app.getVersion()
    // Qué instancia y en qué servidor (para que tus amigos puedan unirse)
    const mc = mcPresence?.() ?? null
    const r = await call('POST', '/heartbeat', mc ? { gameName: `Minecraft ${mc.version}`, mc, version } : { version })
    if (r.status === 200) {
      setFriends(r.data)
      for (const fn of mcPackListeners) await fn((r.data.mcPacks ?? []) as McPack[]).catch(() => undefined)
      for (const fn of beatListeners) await fn().catch(() => undefined)
    }
  } catch {
    if (!state.offline) push({ offline: true })
  }
}

// ——— Para otras partes de la app ———
const beatListeners: (() => Promise<void>)[] = []
/** Tras cada latido (y al cerrar sesión): p. ej. el chat pide su lista la primera vez */
export const onBeat = (fn: () => Promise<void>): void => void beatListeners.push(fn)
const mcPackListeners: ((packs: McPack[]) => Promise<void>)[] = []
/** Cada latido trae los packs de Minecraft compartidos en los que estás (o a los que te invitan) */
export const onMcPacks = (fn: (packs: McPack[]) => Promise<void>): void => {
  mcPackListeners.push(fn)
}
let mcPresence: (() => McPresence | null) | null = null
/** Qué se manda en el latido cuando juegas a Minecraft (lo pone la sección de Minecraft) */
export const setMcPresence = (fn: () => McPresence | null): void => {
  mcPresence = fn
}
/** A qué partida tuya se puede invitar ahora: tu Minecraft si tiene un mundo abierto a tus amigos o estás en un
 * servidor (si no, no hay donde unirse) */
export function myInvite(): ChatInvite | null {
  const mc = mcPresence?.() ?? null
  if (!mc || (!mc.tunnel && !mc.server)) return null
  return { kind: 'mc', name: mc.name.slice(0, 60) || 'Minecraft', version: mc.version.slice(0, 24), loader: mc.loader, where: mc.tunnel ? 'lan' : mc.server!.host.slice(0, 80) }
}
/** Latido ahora mismo (p. ej. antes de jugar, para tener los mods del grupo al día) */
export const syncNow = (): Promise<void> => beat()
export const signedIn = (): boolean => !!session
/** Token de acceso vigente (renovado si hacía falta) para conexiones que no pasan por `call` (el túnel) */
export async function freshAccess(): Promise<string | null> {
  if (!session) return null
  await call('GET', '/me').catch(() => undefined)
  return session ? access : null
}
/** Petición con sesión a /api/u (lanza si no hay conexión) */
export const accountCall = (method: string, path: string, body?: unknown): Promise<Reply> => call(method, path, body)

// ——— Avisos en directo ———
// Conexión abierta con el servidor: cuando algo tuyo cambia (una solicitud de amistad, un amigo que empieza a jugar,
// un grupo de mods…) avisa al momento y se pide lo nuevo, sin esperar al siguiente latido (que sigue de respaldo).
let live: AbortController | null = null
let soon: ReturnType<typeof setTimeout> | null = null
const LIVE_IDLE_MS = 70_000

/** Un latido enseguida (varios avisos seguidos cuentan como uno) */
const beatSoon = (): void => {
  if (soon) clearTimeout(soon)
  soon = setTimeout(() => void beat(), 300)
}

/** Avisos del chat: nuevo mensaje, cambios en uno, leídos, «escribiendo…» y la lista de chats */
const LIVE_CHAT = /^(chat|chats|chatEdit|chatRead|typing)$/
const liveListeners: ((what: string, data: Record<string, unknown>) => void)[] = []
export const onLiveEvent = (fn: (what: string, data: Record<string, unknown>) => void): void => void liveListeners.push(fn)

function startLive(): void {
  if (live || !session) return
  const ctrl = new AbortController()
  live = ctrl
  void (async () => {
    let wait = 3000
    while (session && !ctrl.signal.aborted) {
      try {
        const res = await serverStream('/api/u/events', { Authorization: `Bearer ${access}` }, ctrl.signal)
        if (res.status === 401) {
          // Token caducado: una petición normal lo renueva (o cierra la sesión si ya no vale)
          await call('GET', '/me').catch(() => undefined)
          if (!session) break
          await new Promise((r) => setTimeout(r, 1000))
          continue
        }
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
        wait = 3000
        // Justo al conectar, por si algo cambió mientras no había conexión
        beatSoon()
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        for (;;) {
          // El servidor manda algo cada 25 s: si pasa mucho más sin nada, la conexión está muerta
          let idle: ReturnType<typeof setTimeout> | undefined
          const r = await Promise.race([
            reader.read(),
            new Promise<null>((ok) => (idle = setTimeout(() => ok(null), LIVE_IDLE_MS)))
          ]).finally(() => clearTimeout(idle))
          if (!r || r.done) break
          buf += dec.decode(r.value, { stream: true })
          const parts = buf.split('\n\n')
          buf = parts.pop() ?? ''
          let beat = false
          for (const p of parts) {
            const what = /^event: (\w+)/m.exec(p)?.[1]
            if (!what) continue
            // Los del chat van a quien los escucha (llevan qué chat y qué mensaje); el resto, un latido
            if (LIVE_CHAT.test(what)) {
              let data: Record<string, unknown> = {}
              try {
                data = JSON.parse(/^data: (.*)$/m.exec(p)?.[1] ?? '{}') as Record<string, unknown>
              } catch {
                /* sin datos */
              }
              for (const fn of liveListeners) fn(what, data)
            } else beat = true
          }
          if (beat) beatSoon()
        }
        await reader.cancel().catch(() => undefined)
      } catch {
        /* sin conexión: se reintenta */
      }
      if (ctrl.signal.aborted || !session) break
      await new Promise((r) => setTimeout(r, wait))
      wait = Math.min(wait * 2, 60_000)
    }
    if (live === ctrl) live = null
  })()
}

function stopLive(): void {
  live?.abort()
  live = null
}

export function startAccount(): void {
  load()
  if (session) push({ user: session.user })
  startLive()
  void beat()
  setInterval(() => void beat(), BEAT_MS)
}

// ——— Lo que pide la interfaz ———
const errorOf = (e: unknown): AccountResult => {
  console.error('Cuenta:', (e as Error).message)
  return { ok: false, error: 'offline' }
}
const fail = (error: AccountError): AccountResult => ({ ok: false, error })

async function enter(path: '/login' | '/register', username: string, password: string): Promise<AccountResult> {
  try {
    // Al crear la cuenta se acepta (casilla obligatoria en la app) que tienes 14 años o más, los términos y la privacidad
    const r = await send('POST', path, path === '/register' ? { username, password, accept: true } : { username, password }, false)
    if (r.status === 200) {
      friendsLoaded = false
      setSession(r.data as never)
      void beat()
      return { ok: true }
    }
    if (r.status === 429) return fail('locked')
    if (r.status === 409) return fail('taken')
    return fail(path === '/login' ? 'credentials' : 'invalid')
  } catch (e) {
    return errorOf(e)
  }
}

export const login = (username: string, password: string): Promise<AccountResult> => enter('/login', username, password)
/** accept: la casilla obligatoria (14 años o más, términos y privacidad); sin ella ni se intenta */
export const register = (username: string, password: string, accept: true): Promise<AccountResult> =>
  accept ? enter('/register', username, password) : Promise.resolve(fail('invalid'))
export const logout = (): void => signOut()

export async function changePassword(current: string, next: string): Promise<AccountResult> {
  try {
    const r = await call('POST', '/password', { current, next })
    if (r.status === 200) {
      setSession(r.data as never)
      return { ok: true }
    }
    return fail(r.status === 403 ? 'current' : r.status === 429 ? 'locked' : 'invalid')
  } catch (e) {
    return errorOf(e)
  }
}

export async function deleteAccount(password: string): Promise<AccountResult> {
  try {
    const r = await call('DELETE', '/me', { password })
    if (r.status !== 200) return fail(r.status === 429 ? 'locked' : 'current')
    signOut()
    return { ok: true }
  } catch (e) {
    return errorOf(e)
  }
}

/** Solicitud de amistad, aceptar/rechazar y quitar: todas devuelven la lista de amigos al día */
async function friendsCall(method: string, path: string, body?: unknown): Promise<AccountResult> {
  try {
    const r = await call(method, path, body)
    if (r.status !== 200) return fail('noUser')
    setFriends(r.data)
    return { ok: true }
  } catch (e) {
    return errorOf(e)
  }
}

/** Bloquear (deja de ser tu amigo, no puede escribirte ni pedirte amistad) y desbloquear */
export const blockUser = (id: string): Promise<AccountResult> => friendsCall('POST', `/blocks/${id}`)
export const unblockUser = (id: string): Promise<AccountResult> => friendsCall('DELETE', `/blocks/${id}`)

/** Denunciar un mensaje o una cuenta (lo revisa el admin) */
export async function report(body: ReportBody): Promise<AccountResult> {
  try {
    const r = await call('POST', '/reports', body)
    if (r.status === 200) return { ok: true }
    return fail(r.status === 429 ? 'tooMany' : r.status === 404 ? 'noUser' : 'invalid')
  } catch (e) {
    return errorOf(e)
  }
}

export const addFriend = (username: string): Promise<AccountResult> => friendsCall('POST', '/friends/request', { username })
export const answerFriend = (id: string, accept: boolean): Promise<AccountResult> =>
  friendsCall('POST', `/friends/${id}/${accept ? 'accept' : 'decline'}`)
export const removeFriend = (id: string): Promise<AccountResult> => friendsCall('DELETE', `/friends/${id}`)
export const setNickname = (id: string, nickname: string): Promise<AccountResult> =>
  friendsCall('PUT', `/friends/${id}/nickname`, { nickname })
