// Packs de Minecraft compartidos de punta a punta: crear, invitar, cambiar, volver atrás todo el grupo, unirse a un
// amigo y ver dónde juega. Arranca el servidor de verdad.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import bcrypt from 'bcrypt'

const PORT = 20000 + Math.floor(Math.random() * 1000)
const BASE = `http://127.0.0.1:${PORT}`
const data = mkdtempSync(join(tmpdir(), 'poxi-mcpacks-'))
/** Token de publicar: también abre la API del panel (como el panel con su sesión) */
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

const item = (projectId, versionId, title = projectId) => ({ kind: 'mod', projectId, versionId, title, file: `${title}.jar` })

test('packs de Minecraft: compartir, cambiar, volver atrás y unirse a un amigo', async () => {
  const ana = (await json('POST', '/api/u/register', { username: 'ana', password: 'secreto-ana-1', accept: true })).body
  const pepe = (await json('POST', '/api/u/register', { username: 'pepe', password: 'secreto-pepe-1', accept: true })).body
  const luis = (await json('POST', '/api/u/register', { username: 'luis', password: 'secreto-luis-1', accept: true })).body
  const eva = (await json('POST', '/api/u/register', { username: 'eva', password: 'secreto-eva-1', accept: true })).body
  await json('POST', '/api/u/friends/request', { username: 'pepe' }, ana.access)
  await json('POST', `/api/u/friends/${ana.user.id}/accept`, null, pepe.access)
  await json('POST', '/api/u/friends/request', { username: 'luis' }, pepe.access)
  await json('POST', `/api/u/friends/${pepe.user.id}/accept`, null, luis.access)

  const info = { name: 'Aventura', mc: '1.21.1', loader: 'fabric', loaderVersion: '0.19.5', icon: null }
  const made = await json('POST', '/api/u/mc/packs', { info, items: [item('AANN1111', 'VVVV0001', 'sodium')] }, ana.access)
  assert.equal(made.status, 200)
  const id = made.body.pack.id
  assert.equal(made.body.pack.rev, 1)

  // Datos raros: fuera
  assert.equal((await json('POST', '/api/u/mc/packs', { info: { ...info, icon: 'javascript:alert(1)' }, items: [] }, ana.access)).status, 400)
  assert.equal((await json('POST', '/api/u/mc/packs', { info, items: [{ ...item('x', 'y'), file: 'a.jar' }] }, ana.access)).status, 400)

  // Solo se invita a amigos; el invitado lo ve y lo acepta
  assert.equal((await json('POST', `/api/u/mc/packs/${id}/invite`, { friendId: eva.user.id }, ana.access)).status, 403)
  assert.equal((await json('POST', `/api/u/mc/packs/${id}/invite`, { friendId: pepe.user.id }, ana.access)).status, 200)
  const beat = (tok, body = {}) => json('POST', '/api/u/heartbeat', body, tok)
  assert.equal((await beat(pepe.access)).body.mcPacks[0].invited, true)
  assert.equal((await json('POST', `/api/u/mc/packs/${id}/accept`, null, pepe.access)).status, 200)

  // Cambios de un miembro: suben la revisión y el resto lo ve
  const ops = { ops: [{ op: 'set', item: item('BBNN2222', 'VVVV0002', 'iris') }, { op: 'set', item: item('AANN1111', 'VVVV0003', 'sodium') }], note: { key: 'install', params: { name: 'Iris' } } }
  assert.equal((await json('POST', `/api/u/mc/packs/${id}/items`, ops, pepe.access)).body.pack.rev, 2)
  let seen = (await beat(ana.access)).body.mcPacks[0]
  assert.equal(seen.rev, 2)
  assert.deepEqual(seen.items.map((x) => x.versionId).sort(), ['VVVV0002', 'VVVV0003'])
  assert.equal(seen.history[0].by.username, 'pepe')
  // Un extraño no puede tocarlo
  assert.equal((await json('POST', `/api/u/mc/packs/${id}/items`, ops, eva.access)).status, 403)

  // Volver atrás todo el grupo a la revisión 1
  const back = await json('POST', `/api/u/mc/packs/${id}/rollback`, { rev: 1 }, ana.access)
  assert.equal(back.body.pack.rev, 3)
  assert.deepEqual(back.body.pack.items.map((x) => x.versionId), ['VVVV0001'])

  // Pepe juega en un servidor: sus amigos ven dónde (para unirse); quien no es su amigo, no
  const mc = { name: 'Aventura', version: '1.21.1', loader: 'fabric', packId: id, server: { host: 'mc.ejemplo.es', port: 25565 } }
  await beat(pepe.access, { mc })
  const byLuis = (await json('GET', '/api/u/friends', null, luis.access)).body.friends.find((f) => f.username === 'pepe')
  assert.equal(byLuis.state, 'playing')
  assert.deepEqual(byLuis.mc, mc)
  assert.equal((await beat(pepe.access, { mc: { ...mc, server: { host: 'mal host', port: 1 } } })).status, 400)

  // Luis se une (es amigo de Pepe, que está dentro) sin invitación; Eva no puede
  assert.equal((await json('POST', `/api/u/mc/packs/${id}/join`, null, luis.access)).status, 200)
  assert.equal((await json('POST', `/api/u/mc/packs/${id}/join`, null, eva.access)).status, 403)
  assert.equal((await beat(luis.access)).body.mcPacks[0].members.length, 3)

  // Al salir todos, el pack desaparece
  for (const t of [ana, pepe, luis]) await json('DELETE', `/api/u/mc/packs/${id}`, null, t.access)
  assert.equal((await beat(ana.access)).body.mcPacks.length, 0)
})

test('mundo del grupo: uno lo aloja cada vez, solo zips y se baja igual que se subió', async () => {
  const ana = (await json('POST', '/api/u/login', { username: 'ana', password: 'secreto-ana-1' })).body
  const pepe = (await json('POST', '/api/u/login', { username: 'pepe', password: 'secreto-pepe-1' })).body
  const eva = (await json('POST', '/api/u/login', { username: 'eva', password: 'secreto-eva-1' })).body
  const info = { name: 'Mundo', mc: '1.21.1', loader: 'vanilla' }
  const id = (await json('POST', '/api/u/mc/packs', { info, items: [] }, ana.access)).body.pack.id
  await json('POST', `/api/u/mc/packs/${id}/invite`, { friendId: pepe.user.id }, ana.access)
  await json('POST', `/api/u/mc/packs/${id}/accept`, null, pepe.access)

  // Por partes (como la app: Cloudflare corta los cuerpos de más de 100 MB)
  const put = async (token, body, parts = 2) => {
    const upload = randomUUID()
    const size = Math.ceil(body.length / parts)
    let res
    for (let i = 0; i < parts; i++) {
      res = await fetch(`${BASE}/api/u/mc/packs/${id}/world?part=${i}&parts=${parts}&upload=${upload}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${token}` },
        body: body.subarray(i * size, (i + 1) * size)
      })
      if (!res.ok) return res
    }
    return res
  }
  const zip = Buffer.concat([Buffer.from('PK\u0003\u0004'), randomBytes(50_000)])

  // Sin alojarlo no se puede subir; lo aloja Ana y Pepe ve que lo tiene ella
  assert.equal((await put(ana.access, zip)).status, 403)
  assert.equal((await json('POST', `/api/u/mc/packs/${id}/world/lock`, null, ana.access)).status, 200)
  const busy = await json('POST', `/api/u/mc/packs/${id}/world/lock`, null, pepe.access)
  assert.equal(busy.status, 409)
  assert.equal(busy.body.lockedBy, 'ana')

  // Solo zips; uno bueno se guarda y se baja idéntico (y Eva, que no está en el pack, no puede)
  assert.equal((await put(ana.access, Buffer.from('<html>no soy un mundo</html>'))).status, 400)
  const up = await put(ana.access, zip, 3)
  assert.equal(up.status, 200)
  assert.equal((await up.json()).pack.world.rev, 1)
  const got = await fetch(`${BASE}/api/u/mc/packs/${id}/world`, { headers: { Authorization: `Bearer ${pepe.access}` } })
  assert.ok(Buffer.from(await got.arrayBuffer()).equals(zip))
  assert.equal((await fetch(`${BASE}/api/u/mc/packs/${id}/world`, { headers: { Authorization: `Bearer ${eva.access}` } })).status, 404)

  // Ana lo suelta y ya lo puede alojar Pepe
  await json('DELETE', `/api/u/mc/packs/${id}/world/lock`, null, ana.access)
  assert.equal((await json('POST', `/api/u/mc/packs/${id}/world/lock`, null, pepe.access)).status, 200)

  // Panel: ve el pack con su mundo; sin sesión de admin, nada
  assert.equal((await json('GET', '/api/mc/packs')).status, 401)
  assert.equal((await json('GET', '/api/mc/packs', null, pepe.access)).status, 401)
  const listed = (await json('GET', '/api/mc/packs', null, DEPLOY)).body.find((p) => p.id === id)
  assert.equal(listed.world.size, zip.length)
  assert.deepEqual(listed.members.map((m) => m.username).sort(), ['ana', 'pepe'])
  assert.equal(listed.hosting.username, 'pepe')

  // Borrar el mundo: el pack sigue, y el siguiente mundo lleva una revisión MAYOR (si no, nadie se lo bajaría)
  assert.equal((await json('DELETE', `/api/mc/packs/${id}/world`, null, DEPLOY)).status, 200)
  assert.equal((await json('DELETE', `/api/mc/packs/${id}/world`, null, DEPLOY)).status, 404)
  assert.equal((await fetch(`${BASE}/api/u/mc/packs/${id}/world`, { headers: { Authorization: `Bearer ${ana.access}` } })).status, 404)
  assert.equal((await json('POST', `/api/u/mc/packs/${id}/world/lock`, null, ana.access)).status, 200)
  assert.equal((await (await put(ana.access, zip)).json()).pack.world.rev, 2)

  // Borrar el pack: desaparece para sus miembros, con su mundo
  assert.equal((await json('DELETE', '/api/mc/packs/no-es-un-id', null, DEPLOY)).status, 404)
  assert.equal((await json('DELETE', `/api/mc/packs/${id}`, null, DEPLOY)).status, 200)
  const left = (await json('POST', '/api/u/heartbeat', {}, pepe.access)).body.mcPacks
  assert.ok(!left.some((p) => p.id === id))
  assert.ok(!existsSync(join(data, 'mcworlds', `${id}.zip`)))
})
