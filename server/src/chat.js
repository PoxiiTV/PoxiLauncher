import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

// Chat entre amigos: privados (dos amigos) y grupos (hasta 25). Todo es texto: los GIFs y stickers viajan como una
// dirección de KLIPY, el código de un sticker incluido o el id de uno subido. Cada chat va en su propio archivo
// (chats/<id>.json) y guarda sus últimos 10.000 mensajes; el índice (chats/index.json) lleva quién está y lo leído.
// Solo ven un chat sus miembros, y un privado solo se abre entre amigos.

const MAX_MESSAGES = 10_000
const MAX_MEMBERS = 25
const EDIT_WINDOW_MS = 7 * 24 * 3600_000

const line = (max) => z.string().max(max).regex(/^[^\p{Cc}]*$/u)
// Texto de un mensaje: saltos de línea sí, otros caracteres de control no
const text = z.string().max(4000).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/)
/** GIFs y stickers de KLIPY: solo de su CDN (nada de enlaces cualquiera que carguen imágenes de otro sitio) */
export const KLIPY_URL = /^https:\/\/([a-z0-9-]+\.)*klipy\.com\/[\w\-./%]+$/i
const gifSchema = z.object({ url: z.string().max(500).regex(KLIPY_URL), w: z.number().int().min(1).max(4096), h: z.number().int().min(1).max(4096) }).strict()
const stickerSchema = z.union([
  // Incluido en la app (código del emoji animado)
  z.object({ kind: z.literal('pack'), code: z.string().regex(/^[0-9a-f]{2,6}(_[0-9a-f]{2,6}){0,3}$/) }).strict(),
  // De KLIPY
  z.object({ kind: z.literal('klipy'), url: z.string().max(500).regex(KLIPY_URL) }).strict(),
  // Subido por alguien
  z.object({ kind: z.literal('user'), owner: z.string().uuid(), id: z.string().regex(/^[a-f0-9]{16}$/) }).strict()
])
// Invitación a tu partida de Minecraft (lo justo para pintar la tarjeta; unirse usa tu estado en directo, no esto)
const inviteSchema = z
  .object({
    kind: z.literal('mc'),
    name: line(60).min(1),
    version: z.string().max(24).regex(/^[\w.\-+ ]+$/),
    loader: z.enum(['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']),
    where: line(80).optional()
  })
  .strict()
// Una captura o un clip subido a este chat (media.js): lo justo para pintarlo sin descargarlo
const mediaSchema = z
  .object({
    kind: z.enum(['image', 'video']),
    id: z.string().regex(/^[a-f0-9]{16}$/),
    w: z.number().int().min(1).max(8192),
    h: z.number().int().min(1).max(8192),
    seconds: z.number().int().min(1).max(600).optional(),
    game: line(80).optional()
  })
  .strict()
// Icono de grupo: un emoji o un emote de la app (<e:NOMBRE:ID>, que la app pinta como imagen)
const groupIcon = z.union([line(16), z.string().regex(/^<e:[\w\-!?.']{1,40}:([0-9A-Z]{26}|[0-9a-f]{24})>$/)])
const emoji = z.string().min(1).max(16).regex(/^[^\p{Cc}\s]+$/u)

export const messageBody = z
  .object({
    text: text.optional(),
    reply: z.number().int().positive().optional(),
    gif: gifSchema.optional(),
    sticker: stickerSchema.optional(),
    invite: inviteSchema.optional(),
    media: mediaSchema.optional()
  })
  .strict()
  // Algo tiene que llevar
  .refine((m) => (m.text && m.text.trim()) || m.gif || m.sticker || m.invite || m.media, 'Mensaje vacío')

export const groupBody = z
  .object({ name: line(40).min(1), icon: groupIcon.optional(), members: z.array(z.string().uuid()).min(1).max(MAX_MEMBERS - 1) })
  .strict()
export const groupPatch = z.object({ name: line(40).min(1).optional(), icon: groupIcon.optional() }).strict()
export const reactBody = z.object({ emoji }).strict()
export const editBody = z.object({ text: text.min(1) }).strict()

export function createChat(dataDir, accounts, live) {
  const dir = join(dataDir, 'chats')
  const indexFile = join(dir, 'index.json')
  /** id → { id, kind, members, owner?, name?, icon?, createdAt, lastAt, seq, reads: { userId: seq }, pins: [seq] } */
  let chats = {}
  /** id → mensajes (en memoria los chats que se han abierto) */
  const cache = new Map()
  const timers = new Map()
  let indexTimer = null
  let writing = Promise.resolve()

  const queue = (fn) => (writing = writing.then(fn).catch((e) => console.error('[chat] guardar', e.message)))
  const writeIndex = () => {
    indexTimer = null
    queue(async () => {
      await mkdir(dir, { recursive: true })
      await writeFile(`${indexFile}.tmp`, JSON.stringify(chats))
      await rename(`${indexFile}.tmp`, indexFile)
    })
  }
  const saveIndex = () => {
    if (!indexTimer) indexTimer = setTimeout(writeIndex, 500)
  }
  const writeMessages = (id) => {
    timers.delete(id)
    const list = cache.get(id)
    if (!list) return
    const file = join(dir, `${id}.json`)
    queue(async () => {
      await mkdir(dir, { recursive: true })
      await writeFile(`${file}.tmp`, JSON.stringify(list))
      await rename(`${file}.tmp`, file)
    })
  }
  const saveMessages = (id) => {
    if (!timers.has(id)) timers.set(id, setTimeout(() => writeMessages(id), 500))
  }
  async function messagesOf(id) {
    let list = cache.get(id)
    if (!list) {
      try {
        list = JSON.parse(await readFile(join(dir, `${id}.json`), 'utf8'))
      } catch {
        list = []
      }
      cache.set(id, list)
    }
    return list
  }

  const isMember = (c, u) => !!c && c.members.includes(u.id)
  const others = (c, u) => c.members.filter((m) => m !== u.id)
  /** Aviso en directo a los miembros (solo ids: la app pide lo nuevo con su sesión) */
  const ping = (c, what, data, except) => live.notify(c.members.filter((m) => m !== except), what, { chat: c.id, ...data })

  function view(c, u) {
    const list = cache.get(c.id)
    // Con los mensajes en memoria, el último; si no (recién arrancado), el resumen guardado, que ya está hecho
    // (resumirlo otra vez perdía si era GIF, sticker, juego o invitación)
    const last = list?.length ? preview(list[list.length - 1]) : (c.last ?? null)
    return {
      id: c.id,
      kind: c.kind,
      name: c.name ?? null,
      icon: c.icon ?? null,
      owner: c.owner ?? null,
      members: c.members,
      lastAt: c.lastAt,
      last,
      unread: Math.max(0, c.seq - (c.reads?.[u.id] ?? 0)),
      pins: c.pins ?? []
    }
  }
  /** Deja un mensaje como «Mensaje eliminado» (su captura o clip lo borra quien llama, con lo que devuelve) */
  function wipe(c, m) {
    const dropped = m.media?.id
    for (const k of ['text', 'gif', 'sticker', 'invite', 'media', 'reply', 'reactions', 'edited']) delete m[k]
    m.deleted = true
    c.pins = (c.pins ?? []).filter((p) => p !== m.id)
    saveMessages(c.id)
    saveIndex()
    ping(c, 'chatEdit', { id: m.id })
    return { message: m, dropped }
  }
  /** Lo justo para la lista de chats */
  const preview = (m) => ({
    id: m.id,
    from: m.from,
    at: m.at,
    ...(m.deleted ? { deleted: true } : { text: (m.text ?? '').slice(0, 140), kind: m.gif ? 'gif' : m.sticker ? 'sticker' : m.invite ? 'invite' : m.media ? m.media.kind : 'text' })
  })

  return {
    async init() {
      try {
        chats = JSON.parse(await readFile(indexFile, 'utf8'))
      } catch {
        chats = {}
      }
    },

    list(u) {
      return Object.values(chats)
        .filter((c) => isMember(c, u))
        .sort((a, b) => b.lastAt - a.lastAt)
        .map((c) => view(c, u))
    },

    /** Privado con un amigo (si ya existe, el mismo) */
    async dm(u, otherId) {
      if (!u.friends.includes(otherId)) return { error: 'Solo con tus amigos', status: 403 }
      const key = [u.id, otherId].sort().join(':')
      let c = Object.values(chats).find((x) => x.kind === 'dm' && x.key === key)
      if (!c) {
        c = { id: randomUUID(), kind: 'dm', key, members: [u.id, otherId], createdAt: Date.now(), lastAt: Date.now(), seq: 0, reads: {}, pins: [] }
        chats[c.id] = c
        saveIndex()
      }
      return { chat: view(c, u) }
    },

    async group(u, b) {
      const members = [...new Set(b.members)].filter((id) => id !== u.id)
      if (members.some((id) => !u.friends.includes(id))) return { error: 'Solo con tus amigos', status: 403 }
      const c = {
        id: randomUUID(),
        kind: 'group',
        owner: u.id,
        name: b.name.trim(),
        ...(b.icon ? { icon: b.icon } : {}),
        members: [u.id, ...members],
        createdAt: Date.now(),
        lastAt: Date.now(),
        seq: 0,
        reads: {},
        pins: []
      }
      chats[c.id] = c
      saveIndex()
      ping(c, 'chats', {}, u.id)
      return { chat: view(c, u) }
    },

    async patchGroup(u, id, b) {
      const c = chats[id]
      if (!isMember(c, u) || c.kind !== 'group') return { error: 'No existe', status: 404 }
      if (b.name) c.name = b.name.trim()
      if (b.icon !== undefined) c.icon = b.icon || undefined
      saveIndex()
      ping(c, 'chats', {})
      return { chat: view(c, u) }
    },

    /** Añadir a un grupo (solo amigos tuyos) */
    async addMembers(u, id, ids) {
      const c = chats[id]
      if (!isMember(c, u) || c.kind !== 'group') return { error: 'No existe', status: 404 }
      const add = [...new Set(ids)].filter((x) => !c.members.includes(x))
      if (add.some((x) => !u.friends.includes(x))) return { error: 'Solo con tus amigos', status: 403 }
      if (c.members.length + add.length > MAX_MEMBERS) return { error: 'El grupo está lleno', status: 409 }
      c.members.push(...add)
      saveIndex()
      ping(c, 'chats', {})
      return { chat: view(c, u) }
    },

    /** Salir de un grupo (o echar a alguien, si es tuyo) */
    async removeMember(u, id, who) {
      const c = chats[id]
      if (!isMember(c, u) || c.kind !== 'group') return { error: 'No existe', status: 404 }
      if (who !== u.id && c.owner !== u.id) return { error: 'Solo quien lo creó puede echar a alguien', status: 403 }
      ping(c, 'chats', {})
      c.members = c.members.filter((m) => m !== who)
      if (c.owner === who) c.owner = c.members[0]
      if (!c.members.length) {
        delete chats[id]
        cache.delete(id)
      }
      saveIndex()
      return { ok: true }
    },

    async messages(u, id, { before, after, limit = 50 }) {
      const c = chats[id]
      if (!isMember(c, u)) return { error: 'No existe', status: 404 }
      const list = await messagesOf(id)
      let out
      if (after !== undefined) out = list.filter((m) => m.id > after).slice(0, 200)
      else {
        const end = before !== undefined ? list.findIndex((m) => m.id >= before) : list.length
        const to = end < 0 ? list.length : end
        out = list.slice(Math.max(0, to - limit), to)
      }
      return { messages: out, more: after === undefined && out.length > 0 && out[0].id !== list[0]?.id }
    },

    async send(u, id, b) {
      const c = chats[id]
      if (!isMember(c, u)) return { error: 'No existe', status: 404 }
      // Un privado con alguien que ya no es tu amigo: no se escribe
      if (c.kind === 'dm' && !u.friends.includes(others(c, u)[0])) return { error: 'Ya no sois amigos', status: 403 }
      const list = await messagesOf(id)
      if (b.reply && !list.some((m) => m.id === b.reply)) delete b.reply
      const m = { id: ++c.seq, from: u.id, at: Date.now(), ...b, ...(b.text ? { text: b.text.trim() } : {}) }
      list.push(m)
      if (list.length > MAX_MESSAGES) list.splice(0, list.length - MAX_MESSAGES)
      c.lastAt = m.at
      c.last = preview(m)
      c.reads = { ...c.reads, [u.id]: m.id }
      saveMessages(id)
      saveIndex()
      ping(c, 'chat', { id: m.id }, u.id)
      return { message: m }
    },

    async edit(u, id, mid, b) {
      const c = chats[id]
      if (!isMember(c, u)) return { error: 'No existe', status: 404 }
      const m = (await messagesOf(id)).find((x) => x.id === mid)
      if (!m || m.from !== u.id || m.deleted) return { error: 'No se puede editar', status: 403 }
      if (Date.now() - m.at > EDIT_WINDOW_MS) return { error: 'Ya no se puede editar', status: 403 }
      m.text = b.text.trim()
      m.edited = Date.now()
      saveMessages(id)
      ping(c, 'chatEdit', { id: mid })
      return { message: m }
    },

    /** Borrar un mensaje tuyo (queda «Mensaje eliminado») */
    async remove(u, id, mid) {
      const c = chats[id]
      if (!isMember(c, u)) return { error: 'No existe', status: 404 }
      const m = (await messagesOf(id)).find((x) => x.id === mid)
      if (!m || m.from !== u.id) return { error: 'No se puede borrar', status: 403 }
      return wipe(c, m)
    },

    /** Panel (denuncias): borrar cualquier mensaje. Devuelve su captura o clip, para borrarla también; null si no existe */
    async adminRemove(id, mid) {
      const c = chats[id]
      const m = c && (await messagesOf(id)).find((x) => x.id === mid)
      return m ? wipe(c, m) : null
    },

    /** Un mensaje y los anteriores (para denunciarlo con su contexto): solo si quien pregunta está en el chat */
    async messageFor(u, id, mid, before = 4) {
      const c = chats[id]
      if (!isMember(c, u)) return null
      const list = await messagesOf(id)
      const i = list.findIndex((x) => x.id === mid)
      if (i < 0 || list[i].deleted) return null
      return { chat: { id: c.id, kind: c.kind, name: c.name ?? null }, message: list[i], context: list.slice(Math.max(0, i - before), i) }
    },

    /** Poner o quitar tu reacción */
    async react(u, id, mid, e) {
      const c = chats[id]
      if (!isMember(c, u)) return { error: 'No existe', status: 404 }
      const m = (await messagesOf(id)).find((x) => x.id === mid)
      if (!m || m.deleted) return { error: 'No existe', status: 404 }
      const r = (m.reactions ??= {})
      const who = new Set(r[e] ?? [])
      if (who.has(u.id)) who.delete(u.id)
      else {
        // Como mucho 20 emojis distintos por mensaje
        if (!r[e] && Object.keys(r).length >= 20) return { error: 'Demasiadas reacciones', status: 409 }
        who.add(u.id)
      }
      if (who.size) r[e] = [...who]
      else delete r[e]
      if (!Object.keys(r).length) delete m.reactions
      saveMessages(id)
      ping(c, 'chatEdit', { id: mid })
      return { message: m }
    },

    async pin(u, id, mid) {
      const c = chats[id]
      if (!isMember(c, u)) return { error: 'No existe', status: 404 }
      const m = (await messagesOf(id)).find((x) => x.id === mid)
      if (!m || m.deleted) return { error: 'No existe', status: 404 }
      const pins = new Set(c.pins ?? [])
      if (pins.has(mid)) pins.delete(mid)
      else if (pins.size >= 50) return { error: 'Demasiados fijados', status: 409 }
      else pins.add(mid)
      c.pins = [...pins]
      saveIndex()
      ping(c, 'chats', {})
      return { pins: c.pins }
    },

    read(u, id, mid) {
      const c = chats[id]
      if (!isMember(c, u)) return { error: 'No existe', status: 404 }
      const upTo = Math.min(mid, c.seq)
      if ((c.reads?.[u.id] ?? 0) >= upTo) return { ok: true }
      c.reads = { ...c.reads, [u.id]: upTo }
      saveIndex()
      // Los demás ven el «visto»
      ping(c, 'chatRead', { user: u.id, id: upTo }, u.id)
      return { ok: true }
    },

    /** Hasta dónde ha leído cada uno (para el «visto») */
    reads(u, id) {
      const c = chats[id]
      if (!isMember(c, u)) return { error: 'No existe', status: 404 }
      return { reads: c.reads ?? {} }
    },

    typing(u, id) {
      const c = chats[id]
      if (!isMember(c, u)) return { error: 'No existe', status: 404 }
      ping(c, 'typing', { user: u.id }, u.id)
      return { ok: true }
    },

    /** ¿Está en ese chat? (para subir y ver sus capturas y clips) */
    isMember: (u, id) => isMember(chats[id], u),

    /** ¿Comparten algún chat? (para ver los stickers que sube el otro) */
    together(a, b) {
      return Object.values(chats).some((c) => c.members.includes(a) && c.members.includes(b))
    },

    /** Al borrar una cuenta: fuera de todos sus chats */
    async forget(userId) {
      for (const c of Object.values(chats)) {
        if (!c.members.includes(userId)) continue
        c.members = c.members.filter((m) => m !== userId)
        if (c.kind === 'dm' || !c.members.length) {
          delete chats[c.id]
          cache.delete(c.id)
        } else if (c.owner === userId) c.owner = c.members[0]
      }
      saveIndex()
    },

    /** Para las pruebas: que todo lo pendiente llegue al disco */
    async flush() {
      await new Promise((r) => setTimeout(r, 600))
      await writing
    },

    /** Al apagar (pm2 restart): lo que estaba esperando su medio segundo se guarda ya */
    async close() {
      for (const [id, t] of timers) {
        clearTimeout(t)
        writeMessages(id)
      }
      if (indexTimer) {
        clearTimeout(indexTimer)
        writeIndex()
      }
      await writing
    }
  }
}
