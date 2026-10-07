// Bloquear, denunciar y revisarlo desde el panel, de punta a punta (arranca el servidor de verdad). Y las páginas de
// redirecciones a la privacidad y los términos de la web.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import bcrypt from 'bcrypt'

const PORT = 22000 + Math.floor(Math.random() * 1000)
const BASE = `http://127.0.0.1:${PORT}`
const data = mkdtempSync(join(tmpdir(), 'poxi-moderation-'))
/** Token de publicar: también abre la API del panel */
const DEPLOY = randomBytes(24).toString('hex')
let server

before(async () => {
  server = spawn(process.execPath, ['src/server.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: data,
      ADMIN_PASSWORD_HASH: await bcrypt.hash('admin-de-prueba-123', 4),
      JWT_SECRET: randomBytes(32).toString('hex'),
      DEPLOY_TOKEN: DEPLOY,
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

test('bloquear: fuera de amigos, sin privados ni solicitudes, y se puede deshacer', async () => {
  const reg = async (u) => (await json('POST', '/api/u/register', { username: u, password: `secreto-${u}-1`, accept: true })).body
  const ana = await reg('ana')
  const pepe = await reg('pepe')
  await json('POST', '/api/u/friends/request', { username: 'pepe' }, ana.access)
  await json('POST', `/api/u/friends/${ana.user.id}/accept`, null, pepe.access)
  const dm = (await json('POST', '/api/u/chats/dm', { userId: pepe.user.id }, ana.access)).body.chat
  assert.equal((await json('POST', `/api/u/chats/${dm.id}/messages`, { text: 'hola' }, pepe.access)).status, 200)

  // Ana bloquea a Pepe: ya no son amigos y sale en su lista de bloqueados
  const after = await json('POST', `/api/u/blocks/${pepe.user.id}`, null, ana.access)
  assert.equal(after.status, 200)
  assert.deepEqual(after.body.friends, [])
  assert.deepEqual(after.body.blocked.map((b) => b.username), ['pepe'])
  assert.deepEqual((await json('POST', '/api/u/heartbeat', {}, pepe.access)).body.friends, [])

  // Pepe ya no puede escribirle por privado ni pedirle amistad (y no se le dice que está bloqueado)
  assert.equal((await json('POST', `/api/u/chats/${dm.id}/messages`, { text: '¿por qué?' }, pepe.access)).status, 403)
  const asked = await json('POST', '/api/u/friends/request', { username: 'ana' }, pepe.access)
  assert.equal(asked.status, 404)
  assert.match(asked.body.error, /No existe/)
  // Ni Ana a él mientras lo tenga bloqueado
  assert.match((await json('POST', '/api/u/friends/request', { username: 'pepe' }, ana.access)).body.error, /bloqueado/)
  // Bloquearse a uno mismo o a alguien que no existe, no
  assert.equal((await json('POST', `/api/u/blocks/${ana.user.id}`, null, ana.access)).status, 404)
  assert.equal((await json('POST', `/api/u/blocks/00000000-0000-4000-8000-000000000000`, null, ana.access)).status, 404)

  // Desbloquear: pueden volver a ser amigos
  const unblocked = await json('DELETE', `/api/u/blocks/${pepe.user.id}`, null, ana.access)
  assert.deepEqual(unblocked.body.blocked, [])
  assert.equal((await json('POST', '/api/u/friends/request', { username: 'ana' }, pepe.access)).status, 200)
})

test('denunciar: copia del mensaje, nada falso y el panel lo resuelve', async () => {
  const login = async (u) => (await json('POST', '/api/u/login', { username: u, password: `secreto-${u}-1` })).body
  const ana = await login('ana')
  const pepe = await login('pepe')
  const eva = (await json('POST', '/api/u/register', { username: 'eva', password: 'secreto-eva-1', accept: true })).body
  await json('POST', `/api/u/friends/${pepe.user.id}/accept`, null, ana.access)
  const dm = (await json('POST', '/api/u/chats/dm', { userId: pepe.user.id }, ana.access)).body.chat
  await json('POST', `/api/u/chats/${dm.id}/messages`, { text: 'antes' }, pepe.access)
  const bad = (await json('POST', `/api/u/chats/${dm.id}/messages`, { text: 'mensaje feo' }, pepe.access)).body.message
  const mine = (await json('POST', `/api/u/chats/${dm.id}/messages`, { text: 'mío' }, ana.access)).body.message

  const report = (b, token = ana.access) => json('POST', '/api/u/reports', b, token)
  const base = { kind: 'message', user: pepe.user.id, chat: dm.id, message: bad.id, reason: 'harassment' }
  // Sin sesión, no; con datos raros, no
  assert.equal((await report(base, null)).status, 401)
  assert.equal((await report({ ...base, reason: 'otra-cosa' })).status, 400)
  assert.equal((await report({ kind: 'message', user: pepe.user.id, reason: 'spam' })).status, 400)
  // No se puede achacar a Pepe un mensaje que es de Ana, ni denunciar en un chat del que no eres miembro
  assert.equal((await report({ ...base, message: mine.id })).status, 404)
  assert.equal((await report(base, eva.access)).status, 404)
  // La buena (dos veces: no se duplica) y una de cuenta
  assert.equal((await report({ ...base, text: 'me insulta' })).status, 200)
  assert.equal((await report(base)).status, 200)
  assert.equal((await report({ kind: 'user', user: pepe.user.id, reason: 'impersonation' }, eva.access)).status, 200)

  // Panel: sin sesión de admin, nada
  assert.equal((await json('GET', '/api/reports')).status, 401)
  assert.equal((await json('GET', '/api/reports', null, ana.access)).status, 401)
  const list = (await json('GET', '/api/reports', null, DEPLOY)).body
  assert.equal(list.open.length, 2)
  const msg = list.open.find((r) => r.kind === 'message')
  assert.equal(msg.snapshot.message.text, 'mensaje feo')
  assert.equal(msg.snapshot.message.from.username, 'pepe')
  assert.deepEqual(msg.snapshot.context.map((m) => m.text), ['hola', 'antes'])
  assert.equal(msg.by.username, 'ana')
  assert.equal(msg.text, 'me insulta')

  // Borrar el mensaje y bloquear la cuenta: el mensaje queda «eliminado» (la copia de la denuncia, no) y Pepe ya no entra
  assert.equal((await json('POST', `/api/reports/${msg.id}/resolve`, { action: 'deleteBlock' }, DEPLOY)).status, 200)
  const seen = (await json('GET', `/api/u/chats/${dm.id}/messages`, null, ana.access)).body.messages.find((m) => m.id === bad.id)
  assert.equal(seen.deleted, true)
  assert.equal(seen.text, undefined)
  assert.equal((await json('POST', '/api/u/login', { username: 'pepe', password: 'secreto-pepe-1' })).status, 401)
  // Una ya resuelta no se resuelve dos veces; la otra se descarta
  assert.equal((await json('POST', `/api/reports/${msg.id}/resolve`, { action: 'dismiss' }, DEPLOY)).status, 404)
  const other = list.open.find((r) => r.kind === 'user')
  assert.equal((await json('POST', `/api/reports/${other.id}/resolve`, { action: 'dismiss' }, DEPLOY)).status, 200)
  const done = (await json('GET', '/api/reports', null, DEPLOY)).body
  assert.equal(done.open.length, 0)
  assert.deepEqual(done.resolved.map((r) => r.resolved.action).sort(), ['deleteBlock', 'dismiss'])
  assert.equal(done.resolved.find((r) => r.kind === 'message').snapshot.message.text, 'mensaje feo')
})

test('privacidad y términos: viven en la web (las apps viejas llegan por redirección)', async () => {
  for (const page of ['privacidad', 'terminos']) {
    const res = await fetch(`${BASE}/${page}`, { redirect: 'manual' })
    assert.equal(res.status, 301)
    assert.equal(res.headers.get('location'), `https://poxilauncher.com/${page}/`)
  }
  assert.equal((await fetch(`${BASE}/legal/legal.css`)).status, 404)
})
