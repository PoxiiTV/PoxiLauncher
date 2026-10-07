// Túnel para jugar con amigos sin abrir puertos: solo entran amigos, los datos pasan intactos y nadie puede anunciar
// un túnel que no es suyo. Arranca el servidor de verdad.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import bcrypt from 'bcrypt'
import { createServer, connect } from 'node:net'
import WebSocket from 'ws'

const PORT = 25000 + Math.floor(Math.random() * 1000)
const BASE = `http://127.0.0.1:${PORT}`
const data = mkdtempSync(join(tmpdir(), 'poxi-tunnel-'))
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


const ws = (path, token) =>
  new Promise((resolve, reject) => {
    const s = new WebSocket(`ws://127.0.0.1:${PORT}/api/u/tunnel/${path}`, { headers: { Authorization: `Bearer ${token}` } })
    s.once('open', () => resolve(s))
    s.once('unexpected-response', (_q, r) => reject(new Error(String(r.statusCode))))
    s.once('error', reject)
  })

test('túnel: solo amigos, datos intactos y sin túneles ajenos', async (t) => {
  const ana = (await json('POST', '/api/u/register', { username: 'ana', password: 'secreto-ana-1', accept: true })).body
  const pepe = (await json('POST', '/api/u/register', { username: 'pepe', password: 'secreto-pepe-1', accept: true })).body
  const eva = (await json('POST', '/api/u/register', { username: 'eva', password: 'secreto-eva-1', accept: true })).body
  await json('POST', '/api/u/friends/request', { username: 'pepe' }, ana.access)
  await json('POST', `/api/u/friends/${ana.user.id}/accept`, null, pepe.access)

  // Sin sesión, nada
  await assert.rejects(ws('host', 'token-falso'), /401/)

  // Ana aloja: su "juego" devuelve lo que recibe en mayúsculas
  const open = []
  const game = createServer((s) => {
    open.push(s)
    s.on('data', (d) => s.write(d.toString().toUpperCase()))
  })
  await new Promise((r) => game.listen(0, '127.0.0.1', r))
  // Todo lo abierto en este proceso se cierra aunque falle algo (si no, el test no termina nunca)
  t.after(() => {
    for (const x of open) (x.terminate ?? x.destroy).call(x)
    game.close()
  })
  const control = await ws('host', ana.access)
  open.push(control)
  const id = await new Promise((r) => control.once('message', (d) => r(JSON.parse(d.toString()).id)))
  control.on('message', async (d) => {
    const m = JSON.parse(d.toString())
    const sock = connect(game.address().port, '127.0.0.1')
    const data = await ws(`accept/${m.conn}`, ana.access)
    open.push(sock, data)
    sock.on('data', (x) => data.send(x))
    data.on('message', (x) => sock.write(x))
  })

  // Pepe (amigo) entra y habla con el juego de Ana
  const guest = await ws(`join/${id}`, pepe.access)
  open.push(guest)
  const reply = new Promise((r) => guest.once('message', (d) => r(d.toString())))
  guest.send('hola')
  assert.equal(await reply, 'HOLA')

  // Eva (no es amiga) se queda fuera
  const stranger = await ws(`join/${id}`, eva.access)
  open.push(stranger)
  const code = await new Promise((r) => stranger.once('close', r))
  assert.equal(code, 4003)

  // Nadie puede anunciar como suyo el túnel de Ana
  await json('POST', '/api/u/heartbeat', { mc: { name: 'x', version: '1.21.1', loader: 'vanilla', tunnel: id } }, pepe.access)
  const seen = (await json('GET', '/api/u/friends', null, ana.access)).body.friends[0]
  assert.equal(seen.mc.tunnel, undefined)

  guest.close()
  control.close()
})
