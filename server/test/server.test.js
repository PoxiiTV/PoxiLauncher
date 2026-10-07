// Prueba de punta a punta: arranca el servidor de verdad, inicia sesión, sube una versión por trozos,
// la publica y comprueba lo que recibiría la app (latest.yml, archivo completo y por rangos).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import bcrypt from 'bcrypt'

const PORT = 18000 + Math.floor(Math.random() * 1000)
const BASE = `http://127.0.0.1:${PORT}`
const PASSWORD = 'contraseña-de-prueba-123'
const TOKEN = randomBytes(24).toString('hex')
const data = mkdtempSync(join(tmpdir(), 'poxi-updates-'))
let server

before(async () => {
  server = spawn(process.execPath, ['src/server.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: data,
      ADMIN_PASSWORD_HASH: await bcrypt.hash(PASSWORD, 4),
      JWT_SECRET: randomBytes(32).toString('hex'),
      DEPLOY_TOKEN: TOKEN,
      SECURE_COOKIES: 'false'
    },
    stdio: 'ignore'
  })
  for (let i = 0; i < 50; i++) {
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

// Release falsa pero coherente: un "exe" de 5 MB y su latest.yml con la huella real
const exe = randomBytes(5 * 1024 * 1024)
const sha = createHash('sha512').update(exe).digest('base64')
const yml = (version, hash = sha) =>
  `version: ${version}\nfiles:\n  - url: PoxiLauncher-Setup-${version}.exe\n    sha512: ${hash}\n    size: ${exe.length}\npath: PoxiLauncher-Setup-${version}.exe\nsha512: ${hash}\n`

const auth = { Authorization: `Bearer ${TOKEN}` }

async function upload(version, ymlText, headers = auth) {
  const { id } = await (await fetch(`${BASE}/api/uploads`, { method: 'POST', headers })).json()
  const put = (name, offset, body) =>
    fetch(`${BASE}/api/uploads/${id}/files/${encodeURIComponent(name)}?offset=${offset}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      body
    })
  await put('latest.yml', 0, Buffer.from(ymlText))
  // Trozos de 2 MB para ejercitar el ensamblado
  for (let o = 0; o < exe.length; o += 2 * 1024 * 1024) await put(`PoxiLauncher-Setup-${version}.exe`, o, exe.subarray(o, o + 2 * 1024 * 1024))
  return fetch(`${BASE}/api/uploads/${id}/finish`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ makeCurrent: true })
  })
}

test('instalador web: se publica con su paquete y el paquete se descarga', async () => {
  const pkg = randomBytes(3 * 1024 * 1024)
  const pkgSha = createHash('sha512').update(pkg).digest('base64')
  const v = '1.5.0'
  const text = `${yml(v)}packages:\n  x64:\n    size: ${pkg.length}\n    sha512: ${pkgSha}\n    path: poxilauncher-${v}-x64.nsis.7z\n    file: poxilauncher-${v}-x64.nsis.7z\n`
  const { id } = await (await fetch(`${BASE}/api/uploads`, { method: 'POST', headers: auth })).json()
  const put = (name, body) =>
    fetch(`${BASE}/api/uploads/${id}/files/${encodeURIComponent(name)}?offset=0`, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'application/octet-stream' },
      body
    })
  assert.equal((await put('latest.yml', Buffer.from(text))).status, 200)
  assert.equal((await put(`PoxiLauncher-Setup-${v}.exe`, exe)).status, 200)
  const finish = () =>
    fetch(`${BASE}/api/uploads/${id}/finish`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ makeCurrent: false })
    })
  // Sin el paquete no se acepta (la subida sigue abierta para completarla)
  assert.equal((await finish()).status, 400)
  assert.equal((await put(`poxilauncher-${v}-x64.nsis.7z`, pkg)).status, 200)
  assert.equal((await finish()).status, 200)
  // Subida para probar: el instalador pequeño ya puede bajar el paquete, pero no es la versión actual
  const got = await fetch(`${BASE}/updates/poxilauncher-${v}-x64.nsis.7z`)
  assert.equal(got.status, 200)
  assert.ok(Buffer.from(await got.arrayBuffer()).equals(pkg))
  assert.ok(!(await (await fetch(`${BASE}/updates/latest.yml`)).text()).includes(`version: ${v}`))
  // Una versión de prueba se puede borrar (y así no se mezcla con las demás pruebas)
  assert.equal((await fetch(`${BASE}/api/releases/${v}`, { method: 'DELETE', headers: auth })).status, 200)
})

test('sin sesión no se puede gestionar nada', async () => {
  assert.equal((await fetch(`${BASE}/api/releases`)).status, 401)
  assert.equal((await fetch(`${BASE}/api/uploads`, { method: 'POST' })).status, 401)
  assert.equal((await fetch(`${BASE}/api/uploads`, { method: 'POST', headers: { Authorization: 'Bearer malo' } })).status, 401)
})

test('login con contraseña mala falla y con la buena da cookie httpOnly', async () => {
  const bad = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'nope' }) })
  assert.equal(bad.status, 401)
  const ok = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) })
  assert.equal(ok.status, 200)
  const cookies = ok.headers.getSetCookie().join(';')
  assert.match(cookies, /pg_access=.*HttpOnly/i)
  assert.match(cookies, /SameSite=Strict/i)
})

test('una subida con huella que no coincide se rechaza', async () => {
  const r = await upload('1.0.0', yml('1.0.0', 'x'.repeat(88)))
  assert.equal(r.status, 400)
  assert.match((await r.json()).error, /huella/)
})

test('publicar por trozos y servir a la app (completo y por rangos)', async () => {
  const r = await upload('1.2.3', yml('1.2.3'))
  assert.equal(r.status, 200, await r.clone().text())

  const latest = await fetch(`${BASE}/updates/latest.yml`)
  assert.equal(latest.status, 200)
  assert.match(await latest.text(), /version: 1\.2\.3/)

  const full = Buffer.from(await (await fetch(`${BASE}/updates/PoxiLauncher-Setup-1.2.3.exe`)).arrayBuffer())
  assert.equal(createHash('sha512').update(full).digest('base64'), sha)

  // La actualización diferencial pide trozos concretos (Range)
  const part = await fetch(`${BASE}/updates/PoxiLauncher-Setup-1.2.3.exe`, { headers: { Range: 'bytes=100-199' } })
  assert.equal(part.status, 206)
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), exe.subarray(100, 200))

  // Solo bajo /updates: en la raíz no se sirve nada
  assert.equal((await fetch(`${BASE}/latest.yml`)).status, 404)
  assert.equal((await fetch(`${BASE}/PoxiLauncher-Setup-1.2.3.exe`)).status, 404)
})

test('no se puede salir de la carpeta ni pedir cosas raras', async () => {
  for (const p of ['/updates/..%2F..%2Fcurrent.json', '/updates/..%5Ccurrent.json', '/updates/.env', '/', '/api/nada']) {
    const r = await fetch(BASE + p)
    assert.ok(r.status === 404 || r.status === 401 || r.status === 400, `${p} → ${r.status}`)
  }
  // Un archivo que no existe no se guarda en cachés (puede aparecer al publicar)
  assert.equal((await fetch(`${BASE}/updates/PoxiLauncher-Setup-9.9.9.exe`)).headers.get('cache-control'), 'no-store')
})

test('la versión actual no se puede borrar; otra sí, y se puede volver atrás', async () => {
  assert.equal((await upload('1.2.4', yml('1.2.4'))).status, 200)
  assert.equal((await fetch(`${BASE}/api/releases/1.2.4`, { method: 'DELETE', headers: auth })).status, 400)
  assert.equal((await fetch(`${BASE}/api/releases/1.2.3/current`, { method: 'POST', headers: auth })).status, 200)
  assert.match(await (await fetch(`${BASE}/updates/latest.yml`)).text(), /version: 1\.2\.3/)
  assert.equal((await fetch(`${BASE}/api/releases/1.2.4`, { method: 'DELETE', headers: auth })).status, 200)
  // Una versión borrada no se puede volver a publicar (Cloudflare seguiría sirviendo sus archivos viejos)
  assert.equal((await upload('1.2.4', yml('1.2.4'))).status, 409)
  const list = await (await fetch(`${BASE}/api/releases`, { headers: auth })).json()
  assert.deepEqual(list.map((x) => x.version), ['1.2.3'])
})
