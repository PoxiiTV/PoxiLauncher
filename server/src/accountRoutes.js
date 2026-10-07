import express from 'express'
import { z } from 'zod'
import { passwordSchema, usernameSchema } from './accounts.js'
import { noteSchema, packInfoSchema, packItemSchema, packOpSchema } from './mcPacks.js'
import { profileBody } from './profile.js'
import { reportBody } from './reports.js'
import { CODE } from './invites.js'
import { mountChat } from './chatRoutes.js'
import { MIME } from './banners.js'

// Rutas de las cuentas: /api/u/* para la app y /api/accounts/* para el panel de admin.
// Todo se valida con zod; los errores al cliente son mensajes cortos, sin detalles internos.

const bad = (res, msg = 'Datos no válidos', status = 400) => res.status(status).json({ error: msg })
const firstIssue = (r) => r.error?.issues?.[0]?.message ?? 'Datos no válidos'

/** Versión de los términos y la privacidad que se aceptan al crear la cuenta (cambiarla si cambian los documentos) */
export const TERMS_VERSION = '2026-10-07'
const credentials = z
  .object({
    username: usernameSchema,
    password: passwordSchema,
    // Casilla obligatoria: 14 años o más y acepta los términos y la política de privacidad
    accept: z.literal(true, { error: 'Para crear la cuenta tienes que aceptar los términos y la privacidad' })
  })
  .strict()
const loginBody = z.object({ username: z.string().trim().min(1).max(40), password: z.string().min(1).max(200) }).strict()
const refreshBody = z.object({ refresh: z.string().min(10).max(2000) }).strict()
const changeBody = z.object({ current: z.string().min(1).max(200), next: passwordSchema }).strict()
const deleteBody = z.object({ password: z.string().min(1).max(200) }).strict()
const heartbeatBody = z
  .object({
    gameName: z.string().max(200).optional(),
    /** Jugando a Minecraft: qué instancia, y el servidor en el que está (para "Unirme") */
    mc: z
      .object({
        name: z.string().max(60),
        version: z.string().regex(/^[\w.+ -]{1,40}$/),
        loader: z.enum(['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']),
        packId: z.string().uuid().optional(),
        /** Túnel abierto para que sus amigos entren sin abrir puertos */
        tunnel: z.string().uuid().optional(),
        premium: z.boolean().optional(),
        server: z
          .object({ host: z.string().regex(/^[a-zA-Z0-9.-]{1,253}$/), port: z.number().int().min(1).max(65535) })
          .strict()
          .optional()
      })
      .strict()
      .nullable()
      .optional(),
    /** Versión de PoxiLauncher que tiene instalada (la ve el admin) */
    version: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/).optional()
  })
  .strict()
const nameBody = z.object({ username: z.string().trim().min(1).max(40) }).strict()
const idParam = z.string().uuid()
// Apodo de un amigo: texto corto sin caracteres de control (vacío = quitarlo)
const nicknameBody = z.object({ nickname: z.string().trim().max(32).regex(/^[^\p{Cc}]*$/u) }).strict()

export function userRouter(accounts, { registerLimiter, loginLimiter, avatarLimiter, live, mcPacks, tunnels, worldLimiter, chat, klipy, stickers, media, reports, reportLimiter, invites }) {
  const r = express.Router()
  r.use(express.json({ limit: '200kb' }))

  /** Usuario de la petición (token de acceso en "Authorization: Bearer …") */
  const requireUser = (req, res, next) => {
    const token = /^Bearer (.+)$/.exec(req.get('authorization') ?? '')?.[1]
    const u = accounts.auth(token)
    if (!u) return bad(res, 'Sesión caducada', 401)
    req.user = u
    next()
  }

  // Chat entre amigos (rutas en chatRoutes.js)
  if (chat) mountChat(r, chat, requireUser, bad, klipy, stickers, media)

  r.post('/register', registerLimiter, async (req, res) => {
    const b = credentials.safeParse(req.body)
    if (!b.success) return bad(res, firstIssue(b))
    const out = await accounts.register(b.data.username, b.data.password, TERMS_VERSION)
    return out.error ? bad(res, out.error, 409) : res.json(out)
  })

  r.post('/login', loginLimiter, async (req, res) => {
    const b = loginBody.safeParse(req.body)
    if (!b.success) return bad(res)
    const out = await accounts.login(b.data.username, b.data.password)
    return out.error ? bad(res, out.error, out.locked ? 429 : 401) : res.json(out)
  })

  r.post('/refresh', loginLimiter, (req, res) => {
    const b = refreshBody.safeParse(req.body)
    const out = b.success ? accounts.refresh(b.data.refresh) : null
    return out ? res.json(out) : bad(res, 'Sesión caducada', 401)
  })

  r.get('/me', requireUser, (req, res) => res.json(accounts.me(req.user)))

  r.post('/password', loginLimiter, requireUser, async (req, res) => {
    const b = changeBody.safeParse(req.body)
    if (!b.success) return bad(res, firstIssue(b))
    const out = await accounts.changePassword(req.user, b.data.current, b.data.next)
    return out.error ? bad(res, out.error, 403) : res.json(out)
  })

  r.delete('/me', loginLimiter, requireUser, async (req, res) => {
    const b = deleteBody.safeParse(req.body)
    if (!b.success) return bad(res)
    const out = await accounts.deleteMe(req.user, b.data.password)
    return out.error ? bad(res, out.error, 403) : res.json(out)
  })

  // Latido cada 30 s: conectado o jugando a Minecraft. Devuelve de paso el estado de los amigos y sus packs.
  r.post('/heartbeat', requireUser, async (req, res) => {
    const b = heartbeatBody.safeParse(req.body)
    if (!b.success) return bad(res)
    // Solo se anuncia un túnel que existe y es suyo
    if (b.data.mc?.tunnel && !tunnels?.ownedBy(b.data.mc.tunnel, req.user.id)) delete b.data.mc.tunnel
    await accounts.heartbeat(req.user, b.data)
    res.json({ ...accounts.friends(req.user), mcPacks: mcPacks.list(req.user) })
  })

  // ——— Foto de perfil ———
  // Solo WebP pequeños (la app ya la recorta y la convierte); se comprueba la cabecera real, no el tipo que diga
  // la petición. Se sirve con cabeceras que impiden al navegador tratarla como otra cosa que una imagen.
  r.put('/avatar', avatarLimiter, requireUser, express.raw({ type: 'image/webp', limit: '150kb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body)) return bad(res, 'Imagen no válida')
    const out = await accounts.setAvatar(req.user, req.body)
    return out.error ? bad(res, out.error) : res.json(out)
  })

  r.delete('/avatar', avatarLimiter, requireUser, async (req, res) => res.json(await accounts.removeAvatar(req.user)))

  // Banner de imagen o GIF (hasta 20 MB; el tipo se comprueba por la cabecera del archivo)
  r.put('/banner', avatarLimiter, requireUser, express.raw({ type: ['image/gif', 'image/png', 'image/jpeg', 'image/webp'], limit: '20mb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body)) return bad(res, 'Imagen no válida')
    const out = await accounts.setBanner(req.user, req.body)
    return out.error ? bad(res, out.error) : res.json(out.user)
  })
  r.delete('/banner', avatarLimiter, requireUser, async (req, res) => res.json((await accounts.removeBanner(req.user)).user))
  r.get('/banner/:id', requireUser, async (req, res) => {
    const id = idParam.safeParse(req.params.id)
    if (!id.success) return bad(res)
    const b = await accounts.bannerFor(req.user, id.data)
    if (!b) return bad(res, 'Sin banner', 404)
    res.set({
      'Content-Type': MIME[b.type],
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Cache-Control': 'private, max-age=86400'
    })
    res.send(b.buf)
  })

  r.get('/avatar/:id', requireUser, async (req, res) => {
    const id = idParam.safeParse(req.params.id)
    if (!id.success) return bad(res)
    const buf = await accounts.avatarFor(req.user, id.data)
    if (!buf) return bad(res, 'Sin foto', 404)
    res.set({
      'Content-Type': 'image/webp',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Cache-Control': 'private, max-age=86400'
    })
    res.send(buf)
  })

  r.get('/friends', requireUser, (req, res) => res.json(accounts.friends(req.user)))

  // Conexión abierta para los avisos en directo (live.js): solo dice "algo ha cambiado"
  r.get('/events', requireUser, (req, res) => live.open(req.user.id, res))

  r.post('/friends/request', requireUser, async (req, res) => {
    const b = nameBody.safeParse(req.body)
    if (!b.success) return bad(res)
    const out = await accounts.request(req.user, b.data.username)
    return out.error ? bad(res, out.error, 404) : res.json(accounts.friends(req.user))
  })

  for (const [path, fn] of [
    ['accept', 'accept'],
    ['decline', 'decline']
  ])
    r.post(`/friends/:id/${path}`, requireUser, async (req, res) => {
      const id = idParam.safeParse(req.params.id)
      if (!id.success) return bad(res)
      const out = await accounts[fn](req.user, id.data)
      return out.error ? bad(res, out.error, 404) : res.json(accounts.friends(req.user))
    })

  // ——— Perfil personalizado ———
  r.put('/profile', requireUser, async (req, res) => {
    const b = profileBody.safeParse(req.body)
    if (!b.success) return bad(res)
    const out = await accounts.setProfile(req.user, b.data)
    // 409: el nombre visible es el usuario de otra cuenta
    return out.error ? res.status(409).json({ error: out.error }) : res.json(out.user)
  })

  r.put('/friends/:id/nickname', requireUser, async (req, res) => {
    const id = idParam.safeParse(req.params.id)
    const b = nicknameBody.safeParse(req.body)
    if (!id.success || !b.success) return bad(res)
    const out = await accounts.setNickname(req.user, id.data, b.data.nickname)
    return out.error ? bad(res, out.error, 404) : res.json(accounts.friends(req.user))
  })

  // ——— Enlaces de invitación ———
  const inviteBody = z.object({ pack: z.string().uuid().nullable() }).strict()
  r.post('/invites', requireUser, async (req, res) => {
    const b = inviteBody.safeParse(req.body)
    if (!b.success || !invites) return bad(res)
    const out = await invites.create(req.user, b.data.pack)
    return out.error ? bad(res, out.error, out.status) : res.json(out)
  })
  r.delete('/invites/:code', requireUser, async (req, res) => {
    if (!CODE.test(req.params.code)) return bad(res)
    const out = await invites.revoke(req.user, req.params.code)
    return out.error ? bad(res, out.error, out.status) : res.json(out)
  })
  r.post('/invites/:code/accept', requireUser, async (req, res) => {
    if (!CODE.test(req.params.code)) return bad(res, 'Esta invitación ya no vale', 404)
    const out = await invites.accept(req.user, req.params.code)
    return out.error ? bad(res, out.error, out.status) : res.json(out)
  })

  // ——— Bloquear y denunciar ———
  r.post('/blocks/:id', requireUser, async (req, res) => {
    const id = idParam.safeParse(req.params.id)
    if (!id.success) return bad(res)
    const out = await accounts.block(req.user, id.data)
    return out.error ? bad(res, out.error, 404) : res.json(accounts.friends(req.user))
  })
  r.delete('/blocks/:id', requireUser, async (req, res) => {
    const id = idParam.safeParse(req.params.id)
    if (!id.success) return bad(res)
    await accounts.unblock(req.user, id.data)
    res.json(accounts.friends(req.user))
  })
  r.post('/reports', reportLimiter, requireUser, async (req, res) => {
    const b = reportBody.safeParse(req.body)
    if (!b.success || !reports) return bad(res)
    const out = await reports.create(req.user, b.data)
    return out.error ? bad(res, out.error, out.status ?? 400) : res.json({ ok: true })
  })

  r.delete('/friends/:id', requireUser, async (req, res) => {
    const id = idParam.safeParse(req.params.id)
    if (!id.success) return bad(res)
    await accounts.unfriend(req.user, id.data)
    res.json(accounts.friends(req.user))
  })

  const reply = (res, out) => (out.error ? bad(res, out.error, 403) : res.json(out))

  // ——— Packs de Minecraft compartidos ———
  const packBody = z.object({ info: packInfoSchema, items: z.array(packItemSchema).max(500) }).strict()
  const packOps = z.object({ ops: z.array(packOpSchema).min(1).max(500), note: noteSchema }).strict()

  r.post('/mc/packs', requireUser, async (req, res) => {
    const b = packBody.safeParse(req.body)
    if (!b.success) return bad(res)
    reply(res, await mcPacks.create(req.user, b.data.info, b.data.items))
  })

  r.post('/mc/packs/:id/invite', requireUser, async (req, res) => {
    const id = idParam.safeParse(req.params.id)
    const b = z.object({ friendId: idParam }).strict().safeParse(req.body)
    if (!id.success || !b.success) return bad(res)
    reply(res, await mcPacks.invite(req.user, id.data, b.data.friendId))
  })

  for (const [path, accept] of [
    ['accept', true],
    ['decline', false]
  ])
    r.post(`/mc/packs/:id/${path}`, requireUser, async (req, res) => {
      const id = idParam.safeParse(req.params.id)
      if (!id.success) return bad(res)
      reply(res, await mcPacks.answer(req.user, id.data, accept))
    })

  r.post('/mc/packs/:id/join', requireUser, async (req, res) => {
    const id = idParam.safeParse(req.params.id)
    if (!id.success) return bad(res)
    reply(res, await mcPacks.join(req.user, id.data))
  })

  r.delete('/mc/packs/:id', requireUser, async (req, res) => {
    const id = idParam.safeParse(req.params.id)
    if (!id.success) return bad(res)
    reply(res, await mcPacks.leave(req.user, id.data))
  })

  r.post('/mc/packs/:id/items', requireUser, async (req, res) => {
    const id = idParam.safeParse(req.params.id)
    const b = packOps.safeParse(req.body)
    if (!id.success || !b.success) return bad(res)
    reply(res, await mcPacks.change(req.user, id.data, b.data.ops, b.data.note))
  })

  // Mundo del grupo: alojarlo (y renovarlo), soltarlo, bajarlo y subirlo
  r.post('/mc/packs/:id/world/lock', requireUser, async (req, res) => {
    const id = idParam.safeParse(req.params.id)
    if (!id.success) return bad(res)
    const out = await mcPacks.lockWorld(req.user, id.data)
    return out.error ? res.status(out.lockedBy ? 409 : 403).json({ error: out.error, lockedBy: out.lockedBy }) : res.json(out)
  })

  r.delete('/mc/packs/:id/world/lock', requireUser, async (req, res) => {
    const id = idParam.safeParse(req.params.id)
    if (!id.success) return bad(res)
    reply(res, await mcPacks.unlockWorld(req.user, id.data))
  })

  r.get('/mc/packs/:id/world', requireUser, (req, res) => {
    const id = idParam.safeParse(req.params.id)
    if (!id.success) return bad(res)
    const file = mcPacks.worldPath(req.user, id.data)
    if (!file) return bad(res, 'Sin mundo', 404)
    res.set({ 'Content-Type': 'application/zip', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    mcPacks.openWorld(file).on('error', () => res.destroy()).pipe(res)
  })

  // Por partes de hasta 32 MB (?part=0&parts=N&upload=<uuid>): Cloudflare gratis corta los cuerpos de más de 100 MB
  const partQuery = z
    .object({ part: z.coerce.number().int().min(0).max(200), parts: z.coerce.number().int().min(1).max(200), upload: z.string().uuid() })
    .strict()
    .refine((q) => q.part < q.parts)
  r.put('/mc/packs/:id/world', worldLimiter, requireUser, async (req, res) => {
    const id = idParam.safeParse(req.params.id)
    const q = partQuery.safeParse(req.query)
    if (!id.success || !q.success || req.get('content-type') !== 'application/octet-stream') return bad(res)
    const out = await mcPacks.uploadWorld(req.user, id.data, req, q.data)
    return out.error ? bad(res, out.error, out.status ?? 403) : res.json(out)
  })

  r.post('/mc/packs/:id/rollback', requireUser, async (req, res) => {
    const id = idParam.safeParse(req.params.id)
    const b = z.object({ rev: z.number().int().positive() }).strict().safeParse(req.body)
    if (!id.success || !b.success) return bad(res)
    reply(res, await mcPacks.rollback(req.user, id.data, b.data.rev))
  })

  return r
}

/** Gestión de cuentas desde el panel (ya protegido con la sesión de admin) */
export function adminRouter(accounts, requireAuth) {
  const r = express.Router()
  r.use(requireAuth)

  const withId = (fn) => async (req, res) => {
    const id = idParam.safeParse(req.params.id)
    if (!id.success) return bad(res)
    return fn(id.data, req, res)
  }

  r.get('/', (_req, res) => res.json(accounts.adminList()))
  r.get('/audit', async (_req, res) => res.json(await accounts.adminAudit()))

  // Ficha completa de una cuenta
  r.get(
    '/:id',
    withId(async (id, _req, res) => {
      const d = accounts.adminDetail(id)
      return d ? res.json(d) : bad(res, 'No existe', 404)
    })
  )

  // Cambiar la fecha de alta: nunca en el futuro ni muy en el pasado
  r.post(
    '/:id/created',
    withId(async (id, req, res) => {
      const b = z
        .object({ createdAt: z.number().int().min(Date.UTC(2020, 0, 1)).max(Date.now() + 24 * 3600 * 1000) })
        .strict()
        .safeParse(req.body)
      if (!b.success) return bad(res, 'Fecha no válida')
      return (await accounts.adminSetCreated(id, b.data.createdAt)) ? res.json({ ok: true }) : bad(res, 'No existe', 404)
    })
  )

  // Foto: la misma comprobación estricta que la de la app (solo WebP pequeños, por su cabecera real)
  r.get(
    '/:id/avatar',
    withId(async (id, _req, res) => {
      const buf = await accounts.adminAvatar(id)
      if (!buf) return bad(res, 'Sin foto', 404)
      res.set({ 'Content-Type': 'image/webp', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' })
      res.send(buf)
    })
  )
  r.put(
    '/:id/avatar',
    express.raw({ type: 'image/webp', limit: '150kb' }),
    withId(async (id, req, res) => {
      if (!Buffer.isBuffer(req.body)) return bad(res, 'Imagen no válida')
      const out = await accounts.adminSetAvatar(id, req.body)
      return out.error ? bad(res, out.error) : res.json(out)
    })
  )
  r.delete(
    '/:id/avatar',
    withId(async (id, _req, res) => ((await accounts.adminRemoveAvatar(id)) ? res.json({ ok: true }) : bad(res, 'No existe', 404)))
  )

  r.post(
    '/:id/password',
    withId(async (id, req, res) => {
      const b = z.object({ password: passwordSchema }).strict().safeParse(req.body)
      if (!b.success) return bad(res, firstIssue(b))
      return (await accounts.adminSetPassword(id, b.data.password)) ? res.json({ ok: true }) : bad(res, 'No existe', 404)
    })
  )

  r.post(
    '/:id/rename',
    withId(async (id, req, res) => {
      const b = z.object({ username: usernameSchema }).strict().safeParse(req.body)
      if (!b.success) return bad(res, firstIssue(b))
      const out = await accounts.adminRename(id, b.data.username)
      return out.error ? bad(res, out.error, 409) : res.json(out)
    })
  )

  r.post(
    '/:id/block',
    withId(async (id, req, res) => {
      const b = z.object({ blocked: z.boolean() }).strict().safeParse(req.body)
      if (!b.success) return bad(res)
      return (await accounts.adminBlock(id, b.data.blocked)) ? res.json({ ok: true }) : bad(res, 'No existe', 404)
    })
  )

  r.post(
    '/:id/logout',
    withId(async (id, _req, res) => ((await accounts.adminLogout(id)) ? res.json({ ok: true }) : bad(res, 'No existe', 404)))
  )

  r.delete(
    '/:id',
    withId(async (id, _req, res) => ((await accounts.adminRemove(id)) ? res.json({ ok: true }) : bad(res, 'No existe', 404)))
  )

  return r
}
