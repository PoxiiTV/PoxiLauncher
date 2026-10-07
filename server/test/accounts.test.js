// Cuentas de punta a punta: arranca el servidor de verdad y prueba registro, inicio de sesión, amigos,
// privacidad, estado en directo y la gestión desde el panel de admin.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import bcrypt from 'bcrypt'

const PORT = 19000 + Math.floor(Math.random() * 1000)
const BASE = `http://127.0.0.1:${PORT}`
const ADMIN = 'admin-de-prueba-123'
const data = mkdtempSync(join(tmpdir(), 'poxi-accounts-'))
let server

before(async () => {
  server = spawn(process.execPath, ['src/server.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: data,
      ADMIN_PASSWORD_HASH: await bcrypt.hash(ADMIN, 4),
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

const randomUUIDLike = () => '00000000-0000-4000-8000-000000000000'

const call = async (method, path, body, token, extra = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
    body: body ? JSON.stringify(body) : undefined
  })
  return { status: res.status, body: await res.json().catch(() => null), res }
}

test('cuentas, amigos, privacidad, estado en directo y panel de admin', async () => {
  // Registro: nombre único (sin distinguir mayúsculas) y contraseña de al menos 8
  const ana = await call('POST', '/api/u/register', { username: 'Ana', password: 'secreto-ana-1', accept: true })
  assert.equal(ana.status, 200)
  assert.equal(ana.body.user.username, 'Ana')
  assert.equal((await call('POST', '/api/u/register', { username: 'ana', password: 'otra-clave-1', accept: true })).status, 409)
  assert.equal((await call('POST', '/api/u/register', { username: 'luis', password: 'corta', accept: true })).status, 400)
  // Sin aceptar los términos y la privacidad (casilla de 14 años o más) no se crea la cuenta
  assert.equal((await call('POST', '/api/u/register', { username: 'luis', password: 'secreto-luis-1' })).status, 400)
  const pepe = await call('POST', '/api/u/register', { username: 'pepe', password: 'secreto-pepe-1', accept: true })
  assert.equal(pepe.status, 200)

  // Inicio de sesión
  assert.equal((await call('POST', '/api/u/login', { username: 'pepe', password: 'mal' })).status, 401)
  const login = await call('POST', '/api/u/login', { username: 'PEPE', password: 'secreto-pepe-1' })
  assert.equal(login.status, 200)
  let pepeTok = login.body.access
  const anaTok = ana.body.access

  // Sin ser amigos, no se ve nada
  assert.deepEqual((await call('GET', '/api/u/friends', null, anaTok)).body.friends, [])

  // Solicitud y aceptación
  const req = await call('POST', '/api/u/friends/request', { username: 'pepe' }, anaTok)
  assert.equal(req.body.outgoing[0].username, 'pepe')
  const inc = (await call('GET', '/api/u/friends', null, pepeTok)).body.incoming
  assert.equal(inc[0].username, 'Ana')
  await call('POST', `/api/u/friends/${inc[0].id}/accept`, null, pepeTok)

  // Estado en directo: pepe juega a Minecraft y Ana lo ve (con su instancia, por ser su amiga)
  const mc = { name: 'Survival', version: '1.21.1', loader: 'fabric' }
  await call('POST', '/api/u/heartbeat', { mc }, pepeTok)
  const seen = (await call('POST', '/api/u/heartbeat', {}, anaTok)).body.friends[0]
  assert.equal(seen.username, 'pepe')
  assert.equal(seen.state, 'playing')
  assert.equal(seen.gameName, 'Minecraft')
  assert.deepEqual(seen.mc, mc)

  // Apodos: Ana le pone uno a pepe; solo lo ve ella, y se puede quitar
  const nick = await call('PUT', `/api/u/friends/${seen.id}/nickname`, { nickname: '  Pepito 🐸 ' }, anaTok)
  assert.equal(nick.status, 200)
  assert.equal(nick.body.friends[0].nickname, 'Pepito 🐸')
  assert.equal(nick.body.friends[0].username, 'pepe')
  assert.equal((await call('GET', '/api/u/friends', null, pepeTok)).body.friends[0].nickname, undefined)
  assert.equal((await call('PUT', `/api/u/friends/${seen.id}/nickname`, { nickname: 'x'.repeat(33) }, anaTok)).status, 400)
  assert.equal((await call('PUT', `/api/u/friends/${seen.id}/nickname`, { nickname: 'a\nb' }, anaTok)).status, 400)
  assert.equal((await call('PUT', `/api/u/friends/${randomUUIDLike()}/nickname`, { nickname: 'Nadie' }, anaTok)).status, 404)
  const cleared = await call('PUT', `/api/u/friends/${seen.id}/nickname`, { nickname: '' }, anaTok)
  assert.equal(cleared.body.friends[0].nickname, undefined)
  await call('PUT', `/api/u/friends/${seen.id}/nickname`, { nickname: 'Pepito' }, anaTok)

  // Datos raros: rechazados
  assert.equal((await call('POST', '/api/u/heartbeat', { mc: 'x' }, anaTok)).status, 400)
  assert.equal((await call('POST', '/api/u/heartbeat', { gameId: 42 }, anaTok)).status, 400)
  assert.equal((await call('GET', '/api/u/friends', null, 'token-falso')).status, 401)

  // ——— Panel de admin ———
  const adm = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN })
  })
  const cookie = adm.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  const admin = (method, path, body) => call(method, path, body, null, { Cookie: cookie })
  assert.equal((await call('GET', '/api/accounts')).status, 401)
  const list = (await admin('GET', '/api/accounts')).body
  assert.deepEqual(list.map((u) => u.username), ['Ana', 'pepe'])
  assert.ok(list.every((u) => !('hash' in u)))
  const pepeId = list.find((u) => u.username === 'pepe').id

  // Contraseña temporal: cierra sus sesiones y obliga a cambiarla
  assert.equal((await admin('POST', `/api/accounts/${pepeId}/password`, { password: 'temporal-123' })).status, 200)
  assert.equal((await call('GET', '/api/u/me', null, pepeTok)).status, 401)
  const tmp = await call('POST', '/api/u/login', { username: 'pepe', password: 'temporal-123' })
  assert.equal(tmp.body.user.mustChange, true)
  // La app enseña "Miembro desde" en Mi cuenta
  assert.ok(tmp.body.user.createdAt > 0)
  const changed = await call('POST', '/api/u/password', { current: 'temporal-123', next: 'nueva-clave-pepe' }, tmp.body.access)
  assert.equal(changed.body.user.mustChange, false)
  pepeTok = changed.body.access

  // Cambiar nombre, bloquear y desbloquear
  assert.equal((await admin('POST', `/api/accounts/${pepeId}/rename`, { username: 'Ana' })).status, 409)
  assert.equal((await admin('POST', `/api/accounts/${pepeId}/rename`, { username: 'pepe_pro' })).status, 200)
  await admin('POST', `/api/accounts/${pepeId}/block`, { blocked: true })
  assert.equal((await call('POST', '/api/u/login', { username: 'pepe_pro', password: 'nueva-clave-pepe' })).status, 401)
  await admin('POST', `/api/accounts/${pepeId}/block`, { blocked: false })
  assert.equal((await call('POST', '/api/u/login', { username: 'pepe_pro', password: 'nueva-clave-pepe' })).status, 200)

  // Fuerza bruta: tras 5 fallos seguidos, esa cuenta espera
  for (let i = 0; i < 5; i++) await call('POST', '/api/u/login', { username: 'Ana', password: 'mal' })
  assert.equal((await call('POST', '/api/u/login', { username: 'Ana', password: 'secreto-ana-1' })).status, 429)

  // Borrar: desaparece también de los amigos de los demás
  assert.equal((await admin('DELETE', `/api/accounts/${pepeId}`)).status, 200)
  assert.deepEqual((await call('GET', '/api/u/friends', null, anaTok)).body.friends, [])

  // Todo queda en el historial (lo último primero); sin sesión de admin no se ve
  const audit = (await admin('GET', '/api/accounts/audit')).body
  assert.deepEqual(
    audit.map((a) => a.action),
    ['delete', 'unblock', 'block', 'rename', 'password']
  )
  assert.equal((await call('GET', '/api/accounts/audit')).status, 401)
})
