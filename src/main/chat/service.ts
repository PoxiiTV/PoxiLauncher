// Chat entre amigos (lado de la app): la lista de chats, los mensajes de cada uno y los avisos. Todo pasa por nuestro
// servidor con tu sesión; los avisos en directo solo dicen qué chat y qué mensaje, y aquí se pide lo nuevo.
import { BrowserWindow, Notification } from 'electron'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { plainText, type ChatInfo, type ChatMessage, type ChatSend, type Emote } from '@shared/chat'
import { translate } from '@shared/i18n'
import { emit } from '../events'
import { getSettings } from '../settings'
import { imageType } from '@shared/profile'
import { dataPath } from '../store'
import { accountCall, getAccount, myInvite, onBeat, onLiveEvent, rawCall, signedIn } from '../account/service'

let chats: ChatInfo[] = []
/** El chat que tienes abierto (sus mensajes no avisan) */
let focused: string | null = null
let loaded = false

const infoSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['dm', 'group']),
  name: z.string().max(40).nullable(),
  icon: z.string().max(80).nullable(),
  owner: z.string().max(64).nullable(),
  members: z.array(z.string().max(64)).max(25),
  lastAt: z.number(),
  last: z
    .object({ id: z.number(), from: z.string().max(64), at: z.number(), deleted: z.boolean().optional(), text: z.string().max(200).optional(), kind: z.enum(['text', 'gif', 'sticker', 'invite', 'image', 'video']).optional() })
    .nullable(),
  unread: z.number().int().min(0),
  pins: z.array(z.number().int()).max(50)
})

export const getChats = (): ChatInfo[] => chats

export async function loadChats(): Promise<ChatInfo[]> {
  if (!signedIn()) {
    chats = []
    emit('chats', chats)
    return chats
  }
  const r = await accountCall('GET', '/chats').catch(() => null)
  const list = r?.status === 200 ? z.array(infoSchema).max(500).safeParse(r.data.chats) : null
  if (list?.success) {
    chats = list.data
    loaded = true
    emit('chats', chats)
  }
  return chats
}

let reloadTimer: NodeJS.Timeout | null = null
const reloadSoon = (): void => {
  if (reloadTimer) return
  reloadTimer = setTimeout(() => {
    reloadTimer = null
    void loadChats()
  }, 250)
}

type Result<T> = { ok: true; data: T } | { ok: false; error: 'offline' | 'forbidden' | 'invalid' | 'limit' | 'gone' }
async function send<T>(method: string, path: string, body?: unknown): Promise<Result<T>> {
  const r = await accountCall(method, path, body).catch(() => null)
  if (!r) return { ok: false, error: 'offline' }
  if (r.status === 200) return { ok: true, data: r.data as T }
  return { ok: false, error: r.status === 403 ? 'forbidden' : r.status === 404 ? 'gone' : r.status === 429 ? 'limit' : r.status === 400 ? 'invalid' : 'offline' }
}

export async function openDm(userId: string): Promise<ChatInfo | null> {
  const r = await send<{ chat: ChatInfo }>('POST', '/chats/dm', { userId })
  if (!r.ok) return null
  await loadChats()
  return r.data.chat
}

export async function createGroup(name: string, icon: string | null, members: string[]): Promise<ChatInfo | null> {
  const r = await send<{ chat: ChatInfo }>('POST', '/chats/group', { name, ...(icon ? { icon } : {}), members })
  if (!r.ok) return null
  await loadChats()
  return r.data.chat
}

export const patchGroup = async (id: string, patch: { name?: string; icon?: string }): Promise<boolean> =>
  (await send('PATCH', `/chats/${id}`, patch)).ok && !!(await loadChats())
export const addMembers = async (id: string, ids: string[]): Promise<boolean> => (await send('POST', `/chats/${id}/members`, { ids })).ok && !!(await loadChats())
export const removeMember = async (id: string, user: string): Promise<boolean> =>
  (await send('DELETE', `/chats/${id}/members/${user}`)).ok && !!(await loadChats())

export async function messages(id: string, opts: { before?: number; after?: number } = {}): Promise<{ messages: ChatMessage[]; more: boolean } | null> {
  const q = new URLSearchParams()
  if (opts.before) q.set('before', String(opts.before))
  if (opts.after !== undefined) q.set('after', String(opts.after))
  const r = await send<{ messages: ChatMessage[]; more: boolean }>('GET', `/chats/${id}/messages${q.size ? `?${q}` : ''}`)
  return r.ok ? r.data : null
}

export async function sendMessage(id: string, body: ChatSend): Promise<{ message?: ChatMessage; error?: string }> {
  const r = await send<{ message: ChatMessage }>('POST', `/chats/${id}/messages`, body)
  if (!r.ok) return { error: r.error }
  reloadSoon()
  return { message: r.data.message }
}

export const editMessage = async (id: string, mid: number, text: string): Promise<ChatMessage | null> => {
  const r = await send<{ message: ChatMessage }>('PATCH', `/chats/${id}/messages/${mid}`, { text })
  return r.ok ? r.data.message : null
}
export const deleteMessage = async (id: string, mid: number): Promise<ChatMessage | null> => {
  const r = await send<{ message: ChatMessage }>('DELETE', `/chats/${id}/messages/${mid}`)
  if (r.ok) reloadSoon()
  return r.ok ? r.data.message : null
}
export const react = async (id: string, mid: number, emoji: string): Promise<ChatMessage | null> => {
  const r = await send<{ message: ChatMessage }>('POST', `/chats/${id}/messages/${mid}/react`, { emoji })
  return r.ok ? r.data.message : null
}
export const pin = async (id: string, mid: number): Promise<number[] | null> => {
  const r = await send<{ pins: number[] }>('POST', `/chats/${id}/pin/${mid}`)
  if (r.ok) reloadSoon()
  return r.ok ? r.data.pins : null
}
export async function markRead(id: string, mid: number): Promise<void> {
  const c = chats.find((x) => x.id === id)
  if (c && c.unread) {
    c.unread = 0
    emit('chats', chats)
  }
  await send('POST', `/chats/${id}/read/${mid}`)
}
export const reads = async (id: string): Promise<Record<string, number>> => {
  const r = await send<{ reads: Record<string, number> }>('GET', `/chats/${id}/reads`)
  return r.ok ? r.data.reads : {}
}
export const typing = async (id: string): Promise<void> => void (await send('POST', `/chats/${id}/typing`))

/** GIFs o stickers de KLIPY (a través de nuestro servidor). null: el servidor no tiene KLIPY; 'limit': gastadas las de esta hora */
const gifItem = z.object({ id: z.string().max(80), preview: z.string().max(500), url: z.string().max(500), w: z.number().int().positive(), h: z.number().int().positive() })
export async function gifs(q: string, kind: 'gifs' | 'stickers' = 'gifs'): Promise<z.infer<typeof gifItem>[] | null | 'limit'> {
  const qs = new URLSearchParams({ kind, lang: getSettings().lang, ...(q ? { q } : {}) })
  const r = await accountCall('GET', `/gifs?${qs}`).catch(() => null)
  if (!r || r.status === 503) return null
  if (r.status === 429) return 'limit'
  const list = r.status === 200 ? z.array(gifItem).max(60).safeParse(r.data.items) : null
  // Solo del CDN de KLIPY
  return list?.success ? list.data.filter((g) => /^https:\/\/([a-z0-9-]+\.)*klipy\.com\//i.test(g.url) && /^https:\/\/([a-z0-9-]+\.)*klipy\.com\//i.test(g.preview)) : []
}

// ——— Emotes de 7TV (buscador, sin clave) y los globales de BetterTTV ———
// Fuera lo marcado como +18, epiléptico, «edgy» o no apto para Twitch, lo privado y los que van encima de otro
// (zero-width), que sueltos se ven raros. Se guardan un rato en memoria para no repetir búsquedas.
const HIDDEN_FLAGS = 1 | (1 << 8) | (1 << 16) | (1 << 17) | (1 << 18) | (1 << 24)
const emoteItem = z.object({ id: z.string().regex(/^[0-9A-Z]{26}$/), name: z.string().regex(/^[\w\-!?.']{1,40}$/), animated: z.boolean(), flags: z.number(), listed: z.boolean() })
const bttvItem = z.object({ id: z.string().regex(/^[0-9a-f]{24}$/), code: z.string(), animated: z.boolean() })
const emoteCache = new Map<string, { at: number; page: EmotePage }>()
/** 7TV deja pedir hasta ~100 páginas por búsqueda (6.000 emotes); más allá devuelve vacío */
const MAX_EMOTE_PAGE = 100
type EmotePage = { items: Emote[]; more: boolean }
let bttvGlobals: Emote[] | null = null

async function bttv(): Promise<Emote[]> {
  if (bttvGlobals) return bttvGlobals
  const r = await fetch('https://api.betterttv.net/3/cached/emotes/global', { signal: AbortSignal.timeout(10_000) }).catch(() => null)
  const list = r?.ok ? z.array(bttvItem).max(500).safeParse(await r.json().catch(() => null)) : null
  bttvGlobals = list?.success ? list.data.filter((e) => /^[\w\-!?.']{1,40}$/.test(e.code)).map((e) => ({ id: e.id, name: e.code, animated: e.animated })) : []
  return bttvGlobals
}

/** Emotes por nombre (vacío: los más usados), de 60 en 60: `more` dice si hay otra página */
export async function emotes(q: string, page = 1): Promise<EmotePage | null> {
  const key = `${q.toLowerCase()}|${page}`
  const hit = emoteCache.get(key)
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.page
  const query = 'query($q:String!,$p:Int!){emotes(query:$q,limit:60,page:$p,sort:{value:"popularity",order:DESCENDING},filter:{exact_match:false}){items{id name animated flags listed}}}'
  const r = await fetch('https://7tv.io/v3/gql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { q, p: page } }),
    signal: AbortSignal.timeout(12_000)
  }).catch(() => null)
  if (!r?.ok) return null
  const body = (await r.json().catch(() => null)) as { data?: { emotes?: { items?: unknown } } } | null
  // Pasada la última página, 7TV contesta sin datos: fin de la lista (no es un fallo)
  if (page > 1 && body && !body.data) return { items: [], more: false }
  const raw = body?.data?.emotes?.items
  if (!Array.isArray(raw)) return null
  // Uno a uno: un nombre raro (espacios, otros alfabetos…) se salta sin tirar la página entera
  const list: Emote[] = raw
    .slice(0, 100)
    .map((e) => emoteItem.safeParse(e))
    .filter((e) => e.success && e.data.listed && !(e.data.flags & HIDDEN_FLAGS))
    .map((e) => ({ id: e.data!.id, name: e.data!.name, animated: e.data!.animated }))
  // Los clásicos de BetterTTV, primero los que encajan con lo buscado
  if (page === 1) list.push(...(await bttv()).filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase())).slice(0, q ? 20 : 12))
  const out = { items: list, more: raw.length === 60 && page < MAX_EMOTE_PAGE }
  if (emoteCache.size > 300) emoteCache.clear()
  emoteCache.set(key, { at: Date.now(), page: out })
  return out
}

// ——— Invitar a tu partida ———
/** Manda una invitación a tu partida a esos chats y amigos (a los amigos, por su privado) */
export async function sendInvite(to: { chats?: string[]; friends?: string[] }): Promise<{ sent: number; error?: 'notPlaying' | 'send' }> {
  const invite = myInvite()
  if (!invite) return { sent: 0, error: 'notPlaying' }
  const ids = new Set(to.chats ?? [])
  for (const f of to.friends ?? []) {
    const c = await openDm(f).catch(() => null)
    if (c) ids.add(c.id)
  }
  let sent = 0
  for (const id of ids) if ((await sendMessage(id, { invite }).catch(() => ({ message: undefined }))).message) sent++
  return sent || !ids.size ? { sent } : { sent, error: 'send' }
}

// ——— Tus stickers (hasta 30 de 512 KB, en el servidor) ———
export const MAX_STICKER = 512 * 1024
const STICKER_MIMES = { gif: 'image/gif', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const
const STICKERS = (): string => dataPath('stickers')
/** El id de un sticker es el principio de su huella: lo guardado en disco se comprueba con él */
const stickerHash = (b: Buffer): string => createHash('sha256').update(b).digest('hex').slice(0, 16)

export async function myStickers(): Promise<string[]> {
  const r = await accountCall('GET', '/stickers').catch(() => null)
  const list = r?.status === 200 ? z.array(z.string().regex(/^[0-9a-f]{16}$/)).max(100).safeParse(r.data.stickers) : null
  return list?.success ? list.data : []
}

/** Sube uno: su id, o el porqué no (too-big, invalid, full, offline) */
export async function addSticker(bytes: Uint8Array): Promise<{ id?: string; error?: 'too-big' | 'invalid' | 'full' | 'offline' }> {
  if (bytes.length > MAX_STICKER) return { error: 'too-big' }
  const type = imageType(bytes)
  if (!type) return { error: 'invalid' }
  const res = await rawCall('PUT', '/stickers', Buffer.from(bytes), STICKER_MIMES[type]).catch(() => null)
  if (!res) return { error: 'offline' }
  if (res.status === 409) return { error: 'full' }
  if (res.status === 413) return { error: 'too-big' }
  if (!res.ok) return { error: res.status === 400 ? 'invalid' : 'offline' }
  const id = z.object({ id: z.string().regex(/^[0-9a-f]{16}$/) }).safeParse(await res.json().catch(() => null))
  return id.success ? { id: id.data.id } : { error: 'offline' }
}

export async function removeSticker(id: string): Promise<boolean> {
  return (await accountCall('DELETE', `/stickers/${id}`).catch(() => null))?.status === 200
}

/** poxi-img://sticker/<cuenta>/<id>: del disco si ya lo tenías (y cuadra su huella), si no, del servidor */
export async function serveSticker(request: Request): Promise<Response> {
  const [, owner, id] = new URL(request.url).pathname.split('/')
  if (!/^[0-9a-f-]{36}$/.test(owner ?? '') || !/^[0-9a-f]{16}$/.test(id ?? '')) return new Response(null, { status: 400 })
  const file = join(STICKERS(), `${owner}-${id}`)
  let buf = await readFile(file).catch(() => null)
  if (!buf || stickerHash(buf) !== id) {
    if (!signedIn()) return new Response(null, { status: 404 })
    const res = await rawCall('GET', `/stickers/${owner}/${id}`).catch(() => null)
    if (!res?.ok) return new Response(null, { status: 404 })
    buf = Buffer.from(await res.arrayBuffer())
    if (!imageType(buf) || stickerHash(buf) !== id) return new Response(null, { status: 404 })
    await mkdir(STICKERS(), { recursive: true })
    await writeFile(file, buf)
  }
  const type = imageType(buf)
  return new Response(new Uint8Array(buf), { headers: { 'Content-Type': type ? STICKER_MIMES[type] : 'application/octet-stream', 'Cache-Control': 'max-age=31536000' } })
}

/** El chat abierto en pantalla (null: ninguno) */
export function focusChat(id: string | null): void {
  focused = id
}

// ——— Avisos ———
function nameOf(userId: string): string {
  const f = getAccount().friends.find((x) => x.id === userId)
  return f?.username ?? '…'
}

function previewText(c: ChatInfo, lang: 'es' | 'en'): string {
  const l = c.last
  if (!l) return ''
  if (l.deleted) return translate(lang, 'chat.deleted', {})
  if (l.kind === 'gif') return 'GIF'
  if (l.kind === 'sticker') return translate(lang, 'chat.sticker', {})
  if (l.kind === 'invite') return translate(lang, 'chat.invite.preview', {})
  if (l.kind === 'image') return translate(lang, 'chat.media.image', {})
  if (l.kind === 'video') return translate(lang, 'chat.media.video', {})
  return plainText(l.text ?? '')
}

async function onMessage(chatId: string): Promise<void> {
  const before = chats.find((c) => c.id === chatId)?.last?.id ?? 0
  await loadChats()
  const c = chats.find((x) => x.id === chatId)
  if (!c?.last || c.last.id <= before) return
  const s = getSettings()
  const win = BrowserWindow.getAllWindows()[0]
  const visible = !!win && win.isVisible() && win.isFocused()
  // Abierto y a la vista: sin aviso. Silenciado, o con los avisos del chat apagados: tampoco
  if ((visible && focused === chatId) || s.chatMuted.includes(chatId) || !s.chatNotify) return
  const from = nameOf(c.last.from)
  const title = c.kind === 'group' ? `${from} · ${c.name ?? ''}` : from
  const body = previewText(c, s.lang)
  // El sonido es siempre el nuestro (con la app delante o detrás); el de Windows, callado para que no suene doble
  if (s.chatSounds) emit('chatSound', null)
  if (visible) emit('chatToast', { chat: chatId, from: c.last.from, title, text: body })
  else if (Notification.isSupported()) {
    const n = new Notification({ title, body, silent: true })
    n.on('click', () => {
      if (!win) return
      win.show()
      win.focus()
      emit('chatOpen', chatId)
    })
    n.show()
  }
}

onLiveEvent((what, data) => {
  const chat = typeof data.chat === 'string' ? data.chat : null
  if (what === 'chats') reloadSoon()
  if (!chat) return
  if (what === 'chat') void onMessage(chat).catch(() => undefined)
  emit('chatEvent', {
    what: what as 'chat' | 'chatEdit' | 'chatRead' | 'typing' | 'chats',
    chat,
    ...(typeof data.id === 'number' ? { id: data.id } : {}),
    ...(typeof data.user === 'string' ? { user: data.user } : {})
  })
})

// Al iniciar sesión (primer latido) y de vez en cuando: la lista al día (los no leídos)
onBeat(async () => {
  // Sesión cerrada: fuera los chats (la próxima vez se vuelven a pedir)
  if (!signedIn()) {
    loaded = false
    chats = []
    emit('chats', chats)
    return
  }
  if (!loaded) await loadChats().catch(() => undefined)
})
