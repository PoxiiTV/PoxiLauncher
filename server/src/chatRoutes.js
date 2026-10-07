import { createHash } from 'node:crypto'
import express from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { editBody, groupBody, groupPatch, messageBody, reactBody } from './chat.js'
import { MIME } from './banners.js'
import { MAX_IMAGE, MEDIA_MIME } from './media.js'

// Rutas del chat (dentro de /api/u, con sesión). Mensajes limitados por cuenta: 40 por minuto.

const idParam = z.string().uuid()
const midParam = z.coerce.number().int().positive()
const pageQuery = z
  .object({ before: z.coerce.number().int().positive().optional(), after: z.coerce.number().int().min(0).optional(), limit: z.coerce.number().int().min(1).max(100).optional() })
  .strict()

export function mountChat(r, chat, requireUser, bad, klipy, stickers, media) {
  const perUser = (windowMs, limit) =>
    rateLimit({ windowMs, limit, keyGenerator: (req) => req.user?.id ?? 'x', standardHeaders: 'draft-8', legacyHeaders: false, validate: false })
  const sendLimiter = perUser(60_000, 40)
  const typingLimiter = perUser(60_000, 30)
  const reply = (res, out) => (out.error ? bad(res, out.error, out.status ?? 400) : res.json(out))

  r.get('/chats', requireUser, (req, res) => res.json({ chats: chat.list(req.user) }))

  // Tus stickers: hasta 30 de 512 KB (el tipo se mira en la cabecera del archivo). Los ven tus amigos y con quien
  // compartes chat
  if (stickers) {
    const stickerLimiter = perUser(60_000, 15)
    const stickerId = z.string().regex(/^[0-9a-f]{16}$/)
    r.get('/stickers', requireUser, async (req, res) => res.json({ stickers: await stickers.list(req.user.id) }))
    r.put('/stickers', requireUser, stickerLimiter, express.raw({ type: ['image/gif', 'image/png', 'image/jpeg', 'image/webp'], limit: '512kb' }), async (req, res) => {
      if (!Buffer.isBuffer(req.body)) return bad(res, 'Imagen no válida')
      reply(res, await stickers.save(req.user.id, req.body))
    })
    r.delete('/stickers/:id', requireUser, stickerLimiter, async (req, res) => {
      const id = stickerId.safeParse(req.params.id)
      if (!id.success) return bad(res)
      await stickers.remove(req.user.id, id.data)
      res.json({ ok: true })
    })
    r.get('/stickers/:owner/:id', requireUser, async (req, res) => {
      const owner = idParam.safeParse(req.params.owner)
      const id = stickerId.safeParse(req.params.id)
      if (!owner.success || !id.success) return bad(res)
      const me = req.user
      if (owner.data !== me.id && !me.friends.includes(owner.data) && !chat.together(me.id, owner.data)) return bad(res, 'Sin sticker', 404)
      const s = await stickers.read(owner.data, id.data)
      if (!s) return bad(res, 'Sin sticker', 404)
      res.set({ 'Content-Type': MIME[s.type], 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'", 'Cache-Control': 'private, max-age=31536000, immutable' })
      res.send(s.buf)
    })
  }

  // Capturas y clips del chat: los sube un miembro y solo los ven sus miembros (los vídeos, por trozos: Range)
  if (media) {
    const mediaLimiter = perUser(3600_000, 60)
    const mediaId = z.string().regex(/^[0-9a-f]{16}$/)
    const image = express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: MAX_IMAGE })
    r.put('/chats/:id/media', requireUser, mediaLimiter, (req, res, next) => (req.is('video/mp4') ? next() : image(req, res, next)), async (req, res) => {
      const id = idParam.safeParse(req.params.id)
      if (!id.success || !chat.isMember(req.user, id.data)) return bad(res, 'No existe', 404)
      if (req.is('video/mp4')) return reply(res, await media.saveVideo(req.user.id, id.data, req))
      if (!Buffer.isBuffer(req.body)) return bad(res, 'Imagen no válida')
      reply(res, await media.saveImage(req.user.id, id.data, req.body))
    })
    r.get('/chats/:id/media/:mid', requireUser, (req, res) => {
      const id = idParam.safeParse(req.params.id)
      const mid = mediaId.safeParse(req.params.mid)
      if (!id.success || !mid.success || !chat.isMember(req.user, id.data)) return bad(res, 'No existe', 404)
      const m = media.get(id.data, mid.data)
      if (!m) return bad(res, 'Ya no está', 404)
      res.sendFile(m.file, {
        acceptRanges: true,
        headers: { 'Content-Type': MEDIA_MIME[m.type], 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'", 'Cache-Control': 'private, max-age=2592000' }
      })
    })
  }

  // GIFs y stickers de KLIPY (sin clave en el servidor: 503, y la app dice que no hay buscador)
  const gifLimiter = perUser(60_000, 60)
  const gifQuery = z.object({ q: z.string().max(80).optional(), kind: z.enum(['gifs', 'stickers']).optional(), lang: z.enum(['es', 'en']).optional() }).strict()
  r.get('/gifs', requireUser, gifLimiter, async (req, res) => {
    const q = gifQuery.safeParse(req.query)
    if (!q.success) return bad(res)
    if (!klipy?.enabled) return bad(res, 'Sin GIFs', 503)
    try {
      // customer_id que pide KLIPY: una huella anónima de la cuenta (nunca su id ni su nombre)
      const customer = createHash('sha256').update(`klipy:${req.user.id}`).digest('hex').slice(0, 24)
      const items = await klipy.search(q.data.kind ?? 'gifs', (q.data.q ?? '').trim(), q.data.lang === 'en' ? 'US' : 'ES', customer)
      res.json({ items })
    } catch (e) {
      // Gastadas las llamadas de esta hora (o KLIPY nos frena): la app dice que se pruebe en un rato
      if (e?.budget || /KLIPY 429/.test(e?.message ?? '')) return bad(res, 'Sin GIFs por esta hora', 429)
      bad(res, 'KLIPY no responde', 502)
    }
  })

  r.post('/chats/dm', requireUser, async (req, res) => {
    const b = z.object({ userId: z.string().uuid() }).strict().safeParse(req.body)
    if (!b.success) return bad(res)
    reply(res, await chat.dm(req.user, b.data.userId))
  })

  r.post('/chats/group', requireUser, async (req, res) => {
    const b = groupBody.safeParse(req.body)
    if (!b.success) return bad(res)
    reply(res, await chat.group(req.user, b.data))
  })

  r.patch('/chats/:id', requireUser, async (req, res) => {
    const id = idParam.safeParse(req.params.id)
    const b = groupPatch.safeParse(req.body)
    if (!id.success || !b.success) return bad(res)
    reply(res, await chat.patchGroup(req.user, id.data, b.data))
  })

  r.post('/chats/:id/members', requireUser, async (req, res) => {
    const id = idParam.safeParse(req.params.id)
    const b = z.object({ ids: z.array(z.string().uuid()).min(1).max(24) }).strict().safeParse(req.body)
    if (!id.success || !b.success) return bad(res)
    reply(res, await chat.addMembers(req.user, id.data, b.data.ids))
  })

  r.delete('/chats/:id/members/:user', requireUser, async (req, res) => {
    const id = idParam.safeParse(req.params.id)
    const who = idParam.safeParse(req.params.user)
    if (!id.success || !who.success) return bad(res)
    reply(res, await chat.removeMember(req.user, id.data, who.data))
  })

  r.get('/chats/:id/messages', requireUser, async (req, res) => {
    const id = idParam.safeParse(req.params.id)
    const q = pageQuery.safeParse(req.query)
    if (!id.success || !q.success) return bad(res)
    reply(res, await chat.messages(req.user, id.data, q.data))
  })

  r.post('/chats/:id/messages', requireUser, sendLimiter, async (req, res) => {
    const id = idParam.safeParse(req.params.id)
    const b = messageBody.safeParse(req.body)
    if (!id.success || !b.success) return bad(res)
    // Un sticker subido: solo los tuyos y que existan
    const s = b.data.sticker
    if (s?.kind === 'user' && (s.owner !== req.user.id || !(await stickers?.exists(s.owner, s.id)))) return bad(res, 'Sticker no válido')
    // Una captura o un clip: subido por ti a este chat
    const md = b.data.media
    if (md && !media?.owns(req.user.id, id.data, md.id, md.kind)) return bad(res, 'Captura no válida')
    reply(res, await chat.send(req.user, id.data, b.data))
  })

  r.patch('/chats/:id/messages/:mid', requireUser, sendLimiter, async (req, res) => {
    const id = idParam.safeParse(req.params.id)
    const mid = midParam.safeParse(req.params.mid)
    const b = editBody.safeParse(req.body)
    if (!id.success || !mid.success || !b.success) return bad(res)
    reply(res, await chat.edit(req.user, id.data, mid.data, b.data))
  })

  r.delete('/chats/:id/messages/:mid', requireUser, async (req, res) => {
    const id = idParam.safeParse(req.params.id)
    const mid = midParam.safeParse(req.params.mid)
    if (!id.success || !mid.success) return bad(res)
    const { dropped, ...out } = await chat.remove(req.user, id.data, mid.data)
    if (dropped) await media?.remove(dropped)
    reply(res, out)
  })

  r.post('/chats/:id/messages/:mid/react', requireUser, sendLimiter, async (req, res) => {
    const id = idParam.safeParse(req.params.id)
    const mid = midParam.safeParse(req.params.mid)
    const b = reactBody.safeParse(req.body)
    if (!id.success || !mid.success || !b.success) return bad(res)
    reply(res, await chat.react(req.user, id.data, mid.data, b.data.emoji))
  })

  r.post('/chats/:id/pin/:mid', requireUser, async (req, res) => {
    const id = idParam.safeParse(req.params.id)
    const mid = midParam.safeParse(req.params.mid)
    if (!id.success || !mid.success) return bad(res)
    reply(res, await chat.pin(req.user, id.data, mid.data))
  })

  r.post('/chats/:id/read/:mid', requireUser, (req, res) => {
    const id = idParam.safeParse(req.params.id)
    const mid = z.coerce.number().int().min(0).safeParse(req.params.mid)
    if (!id.success || !mid.success) return bad(res)
    reply(res, chat.read(req.user, id.data, mid.data))
  })

  r.get('/chats/:id/reads', requireUser, (req, res) => {
    const id = idParam.safeParse(req.params.id)
    if (!id.success) return bad(res)
    reply(res, chat.reads(req.user, id.data))
  })

  r.post('/chats/:id/typing', requireUser, typingLimiter, (req, res) => {
    const id = idParam.safeParse(req.params.id)
    if (!id.success) return bad(res)
    reply(res, chat.typing(req.user, id.data))
  })
}
