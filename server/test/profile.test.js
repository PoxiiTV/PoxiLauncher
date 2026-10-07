// Perfil de amigos de punta a punta: fotos (subir, ver, rechazar lo que no vale, borrar con la cuenta), siempre
// solo entre amigos. Arranca el servidor de verdad.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import bcrypt from 'bcrypt'

const PORT = 24000 + Math.floor(Math.random() * 1000)
const BASE = `http://127.0.0.1:${PORT}`
const data = mkdtempSync(join(tmpdir(), 'poxi-profile-'))
let server

before(async () => {
  server = spawn(process.execPath, ['src/server.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: data,
      ADMIN_PASSWORD_HASH: await bcrypt.hash('admin-de-prueba-123', 4),
      JWT_SECRET: randomBytes(32).toString('hex'),
      DEPLOY_TOKEN: randomBytes(24).toString('hex'),
      SECURE_COOKIES: 'false'
    },
    stdio: 'ignore'
  })
  for (let i = 0; i < 80; i++) {
    try {
      await fetch(`${BASE}/updates/latest.yml`)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error('El servidor no arrancó')
})

after(() => {
  server.kill()
  rmSync(data, { recursive: true, force: true })
})

const json = async (method, path, body, token) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}
const upload = (buf, token, type = 'image/webp') =>
  fetch(`${BASE}/api/u/avatar`, { method: 'PUT', headers: { 'Content-Type': type, Authorization: `Bearer ${token}` }, body: buf })
const photo = readFileSync(new URL('./fixtures/avatar.webp', import.meta.url))

test('fotos: solo entre amigos, y solo imágenes que valen', async () => {
  const ana = (await json('POST', '/api/u/register', { username: 'ana', password: 'secreto-ana-1', accept: true })).body
  const pepe = (await json('POST', '/api/u/register', { username: 'pepe', password: 'secreto-pepe-1', accept: true })).body
  const luis = (await json('POST', '/api/u/register', { username: 'luis', password: 'secreto-luis-1', accept: true })).body
  await json('POST', '/api/u/friends/request', { username: 'pepe' }, ana.access)
  await json('POST', `/api/u/friends/${ana.user.id}/accept`, null, pepe.access)

  // Sin sesión no se puede subir; lo que no es un WebP válido se rechaza
  assert.equal((await upload(photo, 'token-falso')).status, 401)
  assert.equal((await upload(Buffer.from('<html><script>alert(1)</script></html>'), pepe.access)).status, 400)
  assert.equal((await upload(Buffer.from('<svg onload=alert(1)>'), pepe.access, 'image/svg+xml')).status, 400)
  assert.equal((await upload(Buffer.concat([photo, Buffer.from('<script>x</script>')]), pepe.access)).status, 400)
  assert.equal((await upload(Buffer.alloc(200 * 1024, 1), pepe.access)).status, 413)
  const big = readFileSync(new URL('./fixtures/avatar-big.webp', import.meta.url))
  assert.equal((await upload(big, pepe.access)).status, 400)

  // Una foto buena: su versión llega a la propia cuenta y a los amigos
  const ok = await upload(photo, pepe.access)
  assert.equal(ok.status, 200)
  const version = (await ok.json()).avatar
  assert.match(version, /^[0-9a-f]{16}$/)
  assert.equal((await json('GET', '/api/u/me', null, pepe.access)).body.createdAt > 0, true)
  const seen = (await json('GET', '/api/u/friends', null, ana.access)).body.friends[0]
  assert.equal(seen.avatar, version)
  assert.ok(seen.createdAt > 0)

  // La ve su amigo (tal cual y con cabeceras que impiden tratarla como otra cosa); un desconocido, no
  const got = await fetch(`${BASE}/api/u/avatar/${pepe.user.id}`, { headers: { Authorization: `Bearer ${ana.access}` } })
  assert.equal(got.status, 200)
  assert.equal(got.headers.get('content-type'), 'image/webp')
  assert.equal(got.headers.get('x-content-type-options'), 'nosniff')
  assert.match(got.headers.get('content-security-policy') ?? '', /default-src 'none'/)
  assert.ok(Buffer.from(await got.arrayBuffer()).equals(photo))
  assert.equal((await fetch(`${BASE}/api/u/avatar/${pepe.user.id}`, { headers: { Authorization: `Bearer ${luis.access}` } })).status, 404)
  assert.equal((await fetch(`${BASE}/api/u/avatar/..%2F..%2Fusers`, { headers: { Authorization: `Bearer ${ana.access}` } })).status, 400)

  // Quitar la foto y, al borrar la cuenta, desaparece del disco
  await upload(photo, pepe.access)
  const file = join(data, 'avatars', `${pepe.user.id}.webp`)
  assert.ok(existsSync(file))
  assert.equal((await json('DELETE', '/api/u/me', { password: 'secreto-pepe-1' }, pepe.access)).status, 200)
  assert.equal(existsSync(file), false)
})

test('panel: ficha completa, fecha de alta, foto y versión de la app de cada cuenta', async () => {
  const eva = (await json('POST', '/api/u/register', { username: 'eva', password: 'secreto-eva-1', accept: true })).body
  // La app manda su versión con el latido; algo que no es una versión se rechaza
  assert.equal((await json('POST', '/api/u/heartbeat', { version: '2.0.3' }, eva.access)).status, 200)
  assert.equal((await json('POST', '/api/u/heartbeat', { version: '<b>x</b>' }, eva.access)).status, 400)

  const adm = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'admin-de-prueba-123' })
  })
  const Cookie = adm.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  const admin = async (method, path, body, type = 'application/json') => {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': type, Cookie },
      body: body === undefined ? undefined : type === 'application/json' ? JSON.stringify(body) : body
    })
    return { status: res.status, body: await res.json().catch(() => null), res }
  }
  const id = eva.user.id

  // Sin sesión de admin no se ve nada
  assert.equal((await fetch(`${BASE}/api/accounts/${id}`)).status, 401)
  const d = (await admin('GET', `/api/accounts/${id}`)).body
  assert.equal(d.username, 'eva')
  assert.equal(d.appVersion, '2.0.3')
  assert.ok(!('hash' in d) && !('tv' in d))
  assert.equal((await admin('GET', '/api/accounts')).body.find((u) => u.id === id).appVersion, '2.0.3')

  // Fecha de alta: se puede cambiar, pero nunca al futuro ni antes de 2020
  const day = Date.UTC(2024, 4, 17, 12)
  assert.equal((await admin('POST', `/api/accounts/${id}/created`, { createdAt: day })).status, 200)
  assert.equal((await json('GET', '/api/u/me', null, eva.access)).body.createdAt, day)
  assert.equal((await admin('POST', `/api/accounts/${id}/created`, { createdAt: Date.now() + 10 * 86400000 })).status, 400)
  assert.equal((await admin('POST', `/api/accounts/${id}/created`, { createdAt: Date.UTC(2019, 0, 1) })).status, 400)

  // Foto: el admin la cambia (misma comprobación estricta), la ve y la quita
  assert.equal((await admin('PUT', `/api/accounts/${id}/avatar`, Buffer.from('<html>'), 'image/webp')).status, 400)
  assert.equal((await admin('PUT', `/api/accounts/${id}/avatar`, photo, 'image/webp')).status, 200)
  const pic = await fetch(`${BASE}/api/accounts/${id}/avatar`, { headers: { Cookie } })
  assert.equal(pic.headers.get('content-type'), 'image/webp')
  assert.ok(Buffer.from(await pic.arrayBuffer()).equals(photo))
  assert.ok((await json('GET', '/api/u/me', null, eva.access)).body.avatar)
  assert.equal((await admin('DELETE', `/api/accounts/${id}/avatar`)).status, 200)
  assert.equal((await json('GET', '/api/u/me', null, eva.access)).body.avatar, null)

  // Todo queda en el historial
  const audit = (await admin('GET', '/api/accounts/audit')).body.map((a) => a.action)
  assert.deepEqual(audit.slice(0, 3), ['avatarRemove', 'avatar', 'created'])
})

test('avisos en directo: solicitud de amistad y amigo que empieza a jugar llegan al momento', async () => {
  // Cuentas de las pruebas de arriba (el servidor solo deja 5 registros por hora desde la misma IP)
  const a = (await json('POST', '/api/u/login', { username: 'luis', password: 'secreto-luis-1' })).body
  const b = (await json('POST', '/api/u/login', { username: 'eva', password: 'secreto-eva-1' })).body
  // Sin sesión no hay conexión
  assert.equal((await fetch(`${BASE}/api/u/events`)).status, 401)

  const ctrl = new AbortController()
  const res = await fetch(`${BASE}/api/u/events`, { headers: { Authorization: `Bearer ${a.access}` }, signal: ctrl.signal })
  assert.match(res.headers.get('content-type') ?? '', /^text\/event-stream/)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let text = ''
  let pending = null
  /** Espera hasta que llegue un aviso (o 3 s) */
  const next = async () => {
    const until = Date.now() + 3000
    while (Date.now() < until) {
      // Una sola lectura pendiente a la vez: si se agota la espera, la siguiente llamada sigue con la misma (y no se
      // suelta hasta usar lo leído: si llega mientras nadie espera, no se pierde)
      pending ??= reader.read()
      const r = await Promise.race([pending, new Promise((ok) => setTimeout(() => ok(null), until - Date.now()))])
      if (!r) break
      pending = null
      if (r.done) break
      text += dec.decode(r.value)
      if (/event: \w+/.test(text)) {
        const ev = /event: (\w+)/.exec(text)[1]
        text = ''
        return ev
      }
    }
    return null
  }

  // Solicitud: le llega al momento
  await json('POST', '/api/u/friends/request', { username: 'luis' }, b.access)
  assert.equal(await next(), 'friends')
  // La acepta; su amigo empieza a jugar: también al momento
  await json('POST', `/api/u/friends/${b.user.id}/accept`, null, a.access)
  const mc = { name: 'Survival', version: '1.21.1', loader: 'fabric' }
  await json('POST', '/api/u/heartbeat', { mc }, b.access)
  assert.equal(await next(), 'friends')
  // Mismo estado otra vez: no molesta
  await json('POST', '/api/u/heartbeat', { mc }, b.access)
  assert.equal(await next(), null)
  // Cambia de servidor (lo que usan sus amigos para «Unirme»): al momento
  await json('POST', '/api/u/heartbeat', { mc: { ...mc, server: { host: 'mc.ejemplo.es', port: 25565 } } }, b.access)
  assert.equal(await next(), 'friends')
  ctrl.abort()
})

test('perfil personalizado: lo ven sus amigos, se valida todo y nadie suplanta a otro', async () => {
  // (el registro está limitado a 5 por hora: se usan ana y luis, de la primera prueba, y se hacen amigos)
  const login = async (u) => (await json('POST', '/api/u/login', { username: u, password: `secreto-${u}-1` })).body
  const eva = await login('ana')
  const tom = await login('luis')
  await json('POST', '/api/u/friends/request', { username: 'luis' }, eva.access)
  await json('POST', `/api/u/friends/${eva.user.id}/accept`, null, tom.access)

  const profile = {
    displayName: 'Eva 👑',
    pronouns: 'ella',
    about: 'Hola\n**gamer**',
    name: { colors: ['#ff00aa', '#00ffee'], effect: 'gold', font: 'display' },
    banner: { kind: 'color', colors: ['#112233', '#445566'] },
    theme: ['#101020', '#502080'],
    frame: 'gold',
    custom: { emoji: '🎮', text: 'Jugando', until: null }
  }
  const me = await json('PUT', '/api/u/profile', profile, eva.access)
  assert.equal(me.status, 200)
  assert.deepEqual(me.body.profile, profile)
  await json('POST', '/api/u/heartbeat', {}, eva.access)
  const seen = (await json('GET', '/api/u/friends', null, tom.access)).body.friends.find((f) => f.id === eva.user.id)
  assert.deepEqual(seen.profile, profile)
  assert.ok(Array.isArray(seen.badges))

  // Solo cambia lo que llega; lo vacío se quita
  await json('PUT', '/api/u/profile', { pronouns: '', frame: 'none' }, eva.access)
  const after = (await json('GET', '/api/u/me', null, eva.access)).body
  assert.equal(after.profile.pronouns, undefined)
  assert.equal(after.profile.frame, undefined)
  assert.equal(after.profile.displayName, 'Eva 👑')

  // Marcos, efectos y placas: todos valen para todos (no hay nada que desbloquear)
  for (const b of [{ frame: 'neon' }, { name: { colors: ['#ffffff'], effect: 'glitch', font: 'default' } }, { plate: ['#ff2e88'] }])
    assert.equal((await json('PUT', '/api/u/profile', b, eva.access)).status, 200, JSON.stringify(b))
  // Nombre visible igual al usuario de otra cuenta: no
  assert.equal((await json('PUT', '/api/u/profile', { displayName: 'LUIS' }, eva.access)).status, 409)
  // Valores raros o campos que no existen: fuera
  for (const b of [
    { name: { colors: ['red'], effect: 'neon', font: 'display' } },
    { name: { colors: ['#ff0000'], effect: 'fuego', font: 'display' } },
    { banner: { kind: 'url', value: 'https://x' } },
    { banner: { kind: 'game', gameId: 42 } },
    { theme: ['#000000'] },
    { plate: ['#000000', '#111111', '#222222'] },
    { plate: ['url(x)'] },
    { favorites: [42] },
    { equip: { frame: 'neon' } },
    { displayName: 'a\u0007' },
    { about: 'x'.repeat(301) },
    { status: 'dnd' },
    { extra: 1 }
  ])
    assert.equal((await json('PUT', '/api/u/profile', b, eva.access)).status, 400, JSON.stringify(b))
})

test('banner de imagen o GIF: solo imágenes de verdad, hasta 20 MB y solo entre amigos', async () => {
  const login = async (u) => (await json('POST', '/api/u/login', { username: u, password: `secreto-${u}-1` })).body
  const ana = await login('ana')
  const luis = await login('luis')
  const up = (buf, token, type = 'image/gif') =>
    fetch(`${BASE}/api/u/banner`, { method: 'PUT', headers: { 'Content-Type': type, Authorization: `Bearer ${token}` }, body: buf })
  // Un GIF animado mínimo (cabecera real)
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(200, 7)])
  const res = await up(gif, ana.access)
  assert.equal(res.status, 200)
  const me = await res.json()
  assert.equal(me.profile.banner.kind, 'image')
  assert.match(me.profile.banner.v, /^[0-9a-f]{16}$/)
  // Su amigo lo ve (con su tipo real); lo ve en su perfil
  const got = await fetch(`${BASE}/api/u/banner/${ana.user.id}`, { headers: { Authorization: `Bearer ${luis.access}` } })
  assert.equal(got.status, 200)
  assert.equal(got.headers.get('content-type'), 'image/gif')
  assert.equal(Buffer.from(await got.arrayBuffer()).length, gif.length)
  assert.equal((await json('GET', '/api/u/friends', null, luis.access)).body.friends.find((f) => f.id === ana.user.id).profile.banner.kind, 'image')
  // Lo que no es una imagen (aunque diga que sí) y lo que pasa de 20 MB: fuera
  assert.equal((await up(Buffer.from('<html><script>alert(1)</script></html>'), ana.access)).status, 400)
  assert.equal((await up(Buffer.from('<svg onload=alert(1)>'), ana.access, 'image/svg+xml')).status, 400)
  assert.equal((await up(Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(21 * 1024 * 1024)]), ana.access)).status, 413)
  // Encuadre (posición y zoom) del que se subió; uno que no existe, no
  const framed = await json('PUT', '/api/u/profile', { banner: { kind: 'image', v: me.profile.banner.v, x: 30, y: 60, zoom: 1.5 } }, ana.access)
  assert.equal(framed.status, 200)
  assert.equal(framed.body.profile.banner.zoom, 1.5)
  assert.equal((await json('PUT', '/api/u/profile', { banner: { kind: 'image', v: '0123456789abcdef', x: 0, y: 0, zoom: 1 } }, ana.access)).status, 409)
  assert.equal((await json('PUT', '/api/u/profile', { banner: { kind: 'image', v: me.profile.banner.v, x: 0, y: 0, zoom: 9 } }, ana.access)).status, 400)
  assert.equal((await fetch(`${BASE}/api/u/banner/${ana.user.id}`, { headers: { Authorization: `Bearer ${luis.access}` } })).status, 200)
  // Cambiar a un color lo borra
  await json('PUT', '/api/u/profile', { banner: { kind: 'color', colors: ['#112233'] } }, ana.access)
  assert.equal((await fetch(`${BASE}/api/u/banner/${ana.user.id}`, { headers: { Authorization: `Bearer ${luis.access}` } })).status, 404)
})
