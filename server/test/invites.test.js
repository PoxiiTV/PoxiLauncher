// Enlaces de invitación de punta a punta (arranca el servidor de verdad).
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
const data = mkdtempSync(join(tmpdir(), 'poxi-invites-'))
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


const item = (projectId, versionId, slug) => ({ kind: 'mod', projectId, versionId, title: slug, file: `${slug}.jar` })

test('enlace de amistad: se ve sin cuenta, hace amigos y se puede anular', async () => {
  const reg = async (u) => (await json('POST', '/api/u/register', { username: u, password: `secreto-${u}-1`, accept: true })).body
  const ana = await reg('ana')
  const pepe = await reg('pepe')
  // Sin sesión no se crea; con datos raros tampoco
  assert.equal((await json('POST', '/api/u/invites', { pack: null })).status, 401)
  assert.equal((await json('POST', '/api/u/invites', { pack: 'x' }, ana.access)).status, 400)
  const made = (await json('POST', '/api/u/invites', { pack: null }, ana.access)).body.invite
  assert.match(made.code, /^[A-HJKMNP-Z2-9]{8}$/)
  assert.equal(made.max, 10)
  assert.ok(made.expires - Date.now() > 6.9 * 24 * 3600_000)
  // Pedirlo otra vez da el mismo mientras valga
  assert.equal((await json('POST', '/api/u/invites', { pack: null }, ana.access)).body.invite.code, made.code)

  // La página (sin cuenta) y lo que enseña
  assert.equal((await fetch(`${BASE}/i/${made.code}`)).status, 200)
  const seen = await json('GET', `/api/invites/${made.code}`)
  assert.equal(seen.body.by.username, 'ana')
  assert.equal(seen.body.pack, null)
  assert.equal((await json('GET', '/api/invites/AAAAAAAA')).status, 404)
  assert.equal((await json('GET', '/api/invites/nada')).status, 404)

  // Tu propio enlace no; el de otro os hace amigos (y cuenta un uso)
  assert.equal((await json('POST', `/api/u/invites/${made.code}/accept`, null, ana.access)).status, 400)
  const ok = await json('POST', `/api/u/invites/${made.code}/accept`, null, pepe.access)
  assert.deepEqual(ok.body, { friend: ana.user.id, pack: null, full: false })
  assert.deepEqual((await json('POST', '/api/u/heartbeat', {}, pepe.access)).body.friends.map((f) => f.username), ['ana'])
  assert.equal((await json('POST', '/api/u/invites', { pack: null }, ana.access)).body.invite.uses, 1)

  // Anulado: ya no vale para nadie (y solo lo anula quien lo creó)
  assert.equal((await json('DELETE', `/api/u/invites/${made.code}`, null, pepe.access)).status, 404)
  assert.equal((await json('DELETE', `/api/u/invites/${made.code}`, null, ana.access)).status, 200)
  assert.equal((await json('GET', `/api/invites/${made.code}`)).status, 404)
  // Pedir uno ahora da otro nuevo
  assert.notEqual((await json('POST', '/api/u/invites', { pack: null }, ana.access)).body.invite.code, made.code)
})

test('enlace de un pack: entra en el pack; bloqueados y quien no está dentro, no', async () => {
  const login = async (u) => (await json('POST', '/api/u/login', { username: u, password: `secreto-${u}-1` })).body
  const ana = await login('ana')
  const pepe = await login('pepe')
  const eva = (await json('POST', '/api/u/register', { username: 'eva', password: 'secreto-eva-1', accept: true })).body
  const luis = (await json('POST', '/api/u/register', { username: 'luis', password: 'secreto-luis-1', accept: true })).body
  const info = { name: 'Survival del grupo', mc: '1.21.8', loader: 'fabric', loaderVersion: '0.17.2', icon: null }
  const pack = (await json('POST', '/api/u/mc/packs', { info, items: [item('AANobbMI', 'VVVV0001', 'sodium'), item('P7dR8mSH', 'VVVV0002', 'fabric-api')] }, ana.access)).body.pack

  // Solo quien está dentro crea el enlace de su pack
  assert.equal((await json('POST', '/api/u/invites', { pack: pack.id }, eva.access)).status, 404)
  const inv = (await json('POST', '/api/u/invites', { pack: pack.id }, ana.access)).body.invite
  const seen = (await json('GET', `/api/invites/${inv.code}`)).body
  assert.deepEqual(seen.pack, { name: 'Survival del grupo', mc: '1.21.8', loader: 'fabric', icon: null, mods: 2, members: 1, full: false })

  // Eva entra: amiga de Ana y dentro del pack, con sus mods
  const ok = (await json('POST', `/api/u/invites/${inv.code}/accept`, null, eva.access)).body
  assert.deepEqual(ok, { friend: ana.user.id, pack: pack.id, full: false })
  const evaPacks = (await json('POST', '/api/u/heartbeat', {}, eva.access)).body.mcPacks
  assert.equal(evaPacks.find((p) => p.id === pack.id).items.length, 2)
  // Usarlo dos veces no gasta otro uso
  await json('POST', `/api/u/invites/${inv.code}/accept`, null, eva.access)
  assert.equal((await json('POST', '/api/u/invites', { pack: pack.id }, ana.access)).body.invite.uses, 1)

  // Si Luis tiene bloqueada a Ana (o al revés), el enlace no le sirve
  await json('POST', `/api/u/blocks/${ana.user.id}`, null, luis.access)
  assert.equal((await json('POST', `/api/u/invites/${inv.code}/accept`, null, luis.access)).status, 404)
  assert.deepEqual((await json('POST', '/api/u/heartbeat', {}, luis.access)).body.friends, [])
  void pepe
})

test('límites: 10 personas por enlace y caduca a los 7 días', async () => {
  const { createInvites } = await import('../src/invites.js')
  const users = {}
  const accounts = { user: (id) => users[id], befriend: async () => ({ ok: true }) }
  const inv = createInvites(mkdtempSync(join(tmpdir(), 'poxi-inv-unit-')), accounts, { isMember: () => true, summary: () => null })
  await inv.init()
  users.ana = { id: 'ana', username: 'ana' }
  const { invite } = await inv.create(users.ana)
  for (let i = 0; i < 10; i++) {
    users[`u${i}`] = { id: `u${i}` }
    assert.ok((await inv.accept(users[`u${i}`], invite.code)).friend)
  }
  // El 11.º, no; quien ya lo usó puede repetir sin gastar otro
  users.otro = { id: 'otro' }
  assert.equal((await inv.accept(users.otro, invite.code)).status, 404)
  assert.ok((await inv.accept(users.u3, invite.code)).friend)
  assert.equal(inv.preview(invite.code), null)

  const fresh = (await inv.create(users.ana)).invite
  assert.notEqual(fresh.code, invite.code)
  const realNow = Date.now
  Date.now = () => realNow() + 7 * 24 * 3600_000 + 1000
  try {
    assert.equal(inv.preview(fresh.code), null)
    assert.equal((await inv.accept(users.otro, fresh.code)).status, 404)
  } finally {
    Date.now = realNow
  }
})
