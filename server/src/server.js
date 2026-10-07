import express from 'express'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import cookieParser from 'cookie-parser'
import { z } from 'zod'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { config } from './config.js'
import { login, logout, refresh, requireAuth } from './auth.js'
import { createStore, MAX_CHUNK, VERSION_RE } from './releases.js'
import { createAccounts } from './accounts.js'
import { createMcPacks } from './mcPacks.js'
import { createTunnels } from './tunnel.js'
import { createLive } from './live.js'
import { adminRouter, userRouter } from './accountRoutes.js'
import { createChat } from './chat.js'
import { createReports } from './reports.js'
import { CODE, createInvites } from './invites.js'
import { createKlipy } from './klipy.js'
import { createStickers } from './stickers.js'
import { createMedia } from './media.js'

const here = dirname(fileURLToPath(import.meta.url))
const store = createStore(config.DATA_DIR)
await store.init()
setInterval(() => void store.cleanupStaleUploads(), 60 * 60 * 1000).unref()
// Avisos en directo a la app (solicitudes de amistad, amigos que empiezan a jugar, packs de Minecraft…)
const live = createLive()
const accounts = createAccounts(config.DATA_DIR, config.JWT_SECRET, live)
await accounts.init()
const mcPacks = createMcPacks(config.DATA_DIR, accounts, live, config.MAX_WORLD_MB * 1024 * 1024)
await mcPacks.init()
// Chat entre amigos (privados y grupos); al borrar una cuenta sale de todos sus chats
const chat = createChat(config.DATA_DIR, accounts, live)
await chat.init()
accounts.onRemove((id) => chat.forget(id))
// Al reiniciar o parar (pm2 manda SIGINT), el chat guarda lo pendiente antes de salir
for (const sig of ['SIGINT', 'SIGTERM'])
  process.once(sig, () => {
    void chat.close().finally(() => process.exit(0))
  })
// Stickers que sube cada cuenta (se van con ella)
const stickers = createStickers(config.DATA_DIR)
// Enlaces de invitación (amistad y, si es de un pack, entrar en él)
const invites = createInvites(config.DATA_DIR, accounts, mcPacks)
await invites.init()
// Denuncias de mensajes y cuentas (las revisa el admin en el panel)
const reports = createReports(config.DATA_DIR, accounts, chat)
await reports.init()
accounts.onRemove((id) => stickers.forget(id))
// Capturas y clips compartidos en el chat (se borran a los 30 días; mirarlo cada hora)
const media = createMedia(config.DATA_DIR)
await media.init()
accounts.onRemove((id) => void media.forget(id))
setInterval(() => void media.sweep(), 3600_000).unref()
// GIFs y stickers del chat (con la clave de KLIPY del .env; sin ella, sin buscador)
const klipy = createKlipy(config.KLIPY_API_KEY)
// Jugar con amigos sin abrir puertos (WebSocket por el mismo puerto)
const tunnels = createTunnels(accounts)

const app = express()
app.disable('x-powered-by')

// Detrás del túnel de Cloudflare: la IP real del visitante llega en CF-Connecting-IP
const clientIp = (req) => req.get('cf-connecting-ip') ?? req.ip ?? 'unknown'

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https://cdn.modrinth.com'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"]
      }
    },
    crossOriginResourcePolicy: { policy: 'same-origin' }
  })
)

const limiter = (windowMs, limit) =>
  rateLimit({ windowMs, limit, keyGenerator: clientIp, standardHeaders: 'draft-8', legacyHeaders: false, validate: false })

// Límite general para todo el sitio + uno estricto para el login
app.use(limiter(15 * 60 * 1000, 1500))
const loginLimiter = limiter(15 * 60 * 1000, 8)
// Cuentas de la app: crear cuentas muy limitado; iniciar sesión algo más holgado (además, cada cuenta se
// bloquea un rato tras 5 fallos seguidos)
const registerLimiter = limiter(60 * 60 * 1000, 5)
const userLoginLimiter = limiter(15 * 60 * 1000, 20)

app.use(cookieParser())

// ——— Público: lo que consulta la app para actualizarse ———
app.get('/updates/:file', async (req, res, next) => {
  try {
    const path = await store.resolveFile(req.params.file)
    // Un "no existe" no se guarda en ninguna caché: el archivo puede aparecer justo después (al publicar)
    if (!path) return res.status(404).set('Cache-Control', 'no-store').end()
    // latest.yml cambia al publicar; el resto lleva la versión en el nombre y no cambia nunca
    res.set('Cache-Control', req.params.file === 'latest.yml' ? 'no-cache' : 'public, max-age=31536000, immutable')
    res.sendFile(path, { dotfiles: 'deny', acceptRanges: true })
  } catch (e) {
    next(e)
  }
})

// ——— Cuentas de la app (usuario y contraseña propios de PoxiLauncher) ———
// Fotos de perfil: pocas subidas por hora
const avatarLimiter = limiter(60 * 60 * 1000, 20)
// Mundos compartidos de Minecraft: pocas subidas por hora (pesan)
const worldLimiter = limiter(60 * 60 * 1000, 300)
// Denuncias: pocas por hora
const reportLimiter = limiter(60 * 60 * 1000, 20)
app.use('/api/u', userRouter(accounts, { registerLimiter, loginLimiter: userLoginLimiter, avatarLimiter, live, mcPacks, tunnels, worldLimiter, chat, klipy, stickers, media, reports, reportLimiter, invites }))

// ——— API del panel ———
const api = express.Router()
api.use(express.json({ limit: '10kb' }))

const passwordBody = z.object({ password: z.string().min(1).max(200) }).strict()
api.post('/auth/login', loginLimiter, async (req, res) => {
  const body = passwordBody.safeParse(req.body)
  if (!body.success) return res.status(400).json({ error: 'Datos no válidos' })
  if (!(await login(body.data.password, res))) return res.status(401).json({ error: 'Contraseña incorrecta' })
  res.json({ ok: true })
})
api.post('/auth/refresh', loginLimiter, (req, res) =>
  refresh(req, res) ? res.json({ ok: true }) : res.status(401).json({ error: 'Sesión caducada' })
)
api.post('/auth/logout', (_req, res) => {
  logout(res)
  res.json({ ok: true })
})
api.get('/auth/me', requireAuth, (_req, res) => res.json({ ok: true }))

api.get('/releases', requireAuth, async (_req, res) => res.json(await store.list()))

const versionParam = z.string().regex(VERSION_RE)
api.post('/releases/:version/current', requireAuth, async (req, res) => {
  const v = versionParam.safeParse(req.params.version)
  if (!v.success || !(await store.setCurrent(v.data))) return res.status(400).json({ error: 'Versión no válida' })
  res.json({ ok: true })
})
api.delete('/releases/:version', requireAuth, async (req, res) => {
  const v = versionParam.safeParse(req.params.version)
  if (!v.success || !(await store.remove(v.data)))
    return res.status(400).json({ error: 'No se puede borrar (¿es la versión actual?)' })
  res.json({ ok: true })
})

// Subida por trozos (≤ 50 MB cada uno para pasar por Cloudflare)
api.post('/uploads', requireAuth, async (_req, res) => res.json({ id: await store.startUpload() }))

const chunkQuery = z.object({ offset: z.coerce.number().int().min(0) })
api.put(
  '/uploads/:id/files/:name',
  requireAuth,
  express.raw({ type: 'application/octet-stream', limit: MAX_CHUNK }),
  async (req, res, next) => {
    try {
      const q = chunkQuery.safeParse(req.query)
      if (!q.success || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Trozo no válido' })
      res.json({ size: await store.writeChunk(req.params.id, req.params.name, q.data.offset, req.body) })
    } catch (e) {
      next(e)
    }
  }
)

const finishBody = z.object({ makeCurrent: z.boolean() }).strict()
api.post('/uploads/:id/finish', requireAuth, async (req, res, next) => {
  try {
    const body = finishBody.safeParse(req.body)
    if (!body.success) return res.status(400).json({ error: 'Datos no válidos' })
    const info = await store.finishUpload(req.params.id, body.data.makeCurrent)
    res.json({ ok: true, version: info.version })
  } catch (e) {
    next(e)
  }
})
api.delete('/uploads/:id', requireAuth, async (req, res) => {
  await store.cancelUpload(req.params.id)
  res.json({ ok: true })
})

api.use('/accounts', adminRouter(accounts, requireAuth))

// Packs de Minecraft y mundos del grupo (pestaña Minecraft del panel)
const packParam = z.string().uuid()
api.get('/mc/packs', requireAuth, (_req, res) => res.json(mcPacks.adminList()))
api.delete('/mc/packs/:id', requireAuth, async (req, res) => {
  const id = packParam.safeParse(req.params.id)
  if (!id.success || !(await mcPacks.adminRemove(id.data))) return res.status(404).json({ error: 'No existe' })
  res.json({ ok: true })
})
api.delete('/mc/packs/:id/world', requireAuth, async (req, res) => {
  const id = packParam.safeParse(req.params.id)
  if (!id.success || !(await mcPacks.adminRemoveWorld(id.data))) return res.status(404).json({ error: 'No tiene mundo' })
  res.json({ ok: true })
})

app.use('/api', api)

// ——— Panel ———
// Denuncias (pestaña del panel): revisar y resolver (borrar el mensaje, bloquear la cuenta o descartar)
const reportParam = z.string().uuid()
api.get('/reports', requireAuth, (_req, res) => res.json(reports.adminList()))
api.post('/reports/:id/resolve', requireAuth, async (req, res) => {
  const id = reportParam.safeParse(req.params.id)
  const b = z.object({ action: z.enum(['dismiss', 'delete', 'block', 'deleteBlock']) }).strict().safeParse(req.body)
  const r = id.success ? reports.adminList().open.find((x) => x.id === id.data) : null
  if (!b.success || !r) return res.status(404).json({ error: 'No existe o ya está resuelta' })
  const { action } = b.data
  if ((action === 'delete' || action === 'deleteBlock') && r.snapshot) {
    const out = await chat.adminRemove(r.snapshot.chat.id, r.snapshot.message.id)
    if (out?.dropped) await media.remove(out.dropped)
  }
  if (action === 'block' || action === 'deleteBlock') await accounts.adminBlock(r.user.id, true)
  await reports.resolve(id.data, action)
  res.json({ ok: true })
})

// ——— Privacidad y términos (los enlaza la app al crear la cuenta y en Acerca de) ———
for (const page of ['privacidad', 'terminos'])
  app.get(`/${page}`, (_req, res) => res.sendFile(join(here, '..', 'public', 'legal', `${page}.html`)))
// Enlace de invitación: la página (para abrir la app o descargarla) y lo que enseña (sin cuenta, con límite)
const inviteLimiter = limiter(15 * 60 * 1000, 120)
app.get('/i/:code', (_req, res) => res.sendFile(join(here, '..', 'public', 'invite', 'index.html')))
app.use('/invite', express.static(join(here, '..', 'public', 'invite'), { dotfiles: 'deny', index: false }))
api.get('/invites/:code', inviteLimiter, (req, res) => {
  const p = CODE.test(req.params.code) ? invites.preview(req.params.code) : null
  return p ? res.json(p) : res.status(404).json({ error: 'Esta invitación ya no vale' })
})
app.use('/legal', express.static(join(here, '..', 'public', 'legal'), { dotfiles: 'deny', index: false }))

app.use('/admin', express.static(join(here, '..', 'public', 'admin'), { index: 'index.html', dotfiles: 'deny' }))

// Nada más: la raíz y cualquier otra ruta no existen
app.use((_req, res) => res.status(404).end())

// Errores: mensaje genérico al cliente (sin trazas ni rutas internas); detalle solo en el log
app.use((err, _req, res, _next) => {
  const status = err.status ?? err.statusCode ?? 500
  if (status >= 500) console.error('[error]', err.message)
  res.status(status).json({ error: err.expose || status < 500 ? err.message : 'Error interno' })
})

const server = app.listen(config.PORT, () => console.log(`PoxiLauncher escuchando en el puerto ${config.PORT}`))
server.on('upgrade', (req, socket, head) => {
  if (!tunnels.upgrade(req, socket, head)) socket.destroy()
})
