// Chat de punta a punta: privados solo entre amigos, grupos, editar/borrar/reaccionar/fijar, leído, avisos en
// directo, límites y datos raros fuera. Arranca el servidor de verdad.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import bcrypt from 'bcrypt'

const PORT = 21000 + Math.floor(Math.random() * 1000)
const BASE = `http://127.0.0.1:${PORT}`
const data = mkdtempSync(join(tmpdir(), 'poxi-chat-'))
let server

async function start() {
  server = spawn(process.execPath, ['src/server.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: data,
      ...secrets,
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
}
let secrets
before(async () => {
  secrets = { ADMIN_PASSWORD_HASH: await bcrypt.hash('admin-de-prueba-123', 4), JWT_SECRET: randomBytes(32).toString('hex'), DEPLOY_TOKEN: randomBytes(24).toString('hex') }
  await start()
})
/** Reiniciar con los mismos datos (como un pm2 restart) */
async function restart() {
  // En Windows matar el proceso no le deja apagarse con calma: se da tiempo a que guarde
  await new Promise((r) => setTimeout(r, 800))
  server.kill()
  await new Promise((r) => server.once('exit', r))
  await start()
}

after(() => {
  server?.kill()
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

test('chat entre amigos', async () => {
  const reg = async (u) => (await json('POST', '/api/u/register', { username: u, password: `secreto-${u}-1`, accept: true })).body
  const a = await reg('ana')
  const b = await reg('beto')
  const c = await reg('cris')
  const befriend = async (x, y, yName) => {
    await json('POST', '/api/u/friends/request', { username: yName }, x.access)
    await json('POST', `/api/u/friends/${x.user.id}/accept`, null, y.access)
  }
  await befriend(a, b, 'beto')
  await befriend(a, c, 'cris')

  // Privados: solo entre amigos, y el mismo chat si ya existe
  const dm = (await json('POST', '/api/u/chats/dm', { userId: b.user.id }, a.access)).body.chat
  assert.equal(dm.kind, 'dm')
  assert.equal((await json('POST', '/api/u/chats/dm', { userId: a.user.id }, b.access)).body.chat.id, dm.id)
  assert.equal((await json('POST', '/api/u/chats/dm', { userId: c.user.id }, b.access)).status, 403)

  // Aviso en directo a beto (solo ids)
  const ctrl = new AbortController()
  const stream = await fetch(`${BASE}/api/u/events`, { headers: { Authorization: `Bearer ${b.access}` }, signal: ctrl.signal })
  const reader = stream.body.getReader()
  const events = []
  void (async () => {
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ done: true }))
      if (done) return
      buf += new TextDecoder().decode(value)
      for (const m of buf.matchAll(/event: (\w+)\ndata: (.*)\n\n/g)) events.push({ what: m[1], data: JSON.parse(m[2]) })
      buf = buf.slice(buf.lastIndexOf('\n\n') + 2)
    }
  })()
  await new Promise((r) => setTimeout(r, 200))

  // Mensaje: le llega y lo ve sin leer
  const sent = await json('POST', `/api/u/chats/${dm.id}/messages`, { text: '  Hola **beto** 👋  ' }, a.access)
  assert.equal(sent.status, 200)
  assert.equal(sent.body.message.text, 'Hola **beto** 👋')
  await new Promise((r) => setTimeout(r, 200))
  assert.ok(events.some((e) => e.what === 'chat' && e.data.chat === dm.id && e.data.id === sent.body.message.id))
  let mine = (await json('GET', '/api/u/chats', null, b.access)).body.chats
  assert.equal(mine[0].unread, 1)
  assert.equal(mine[0].last.text, 'Hola **beto** 👋')
  const page = (await json('GET', `/api/u/chats/${dm.id}/messages`, null, b.access)).body
  assert.equal(page.messages.length, 1)
  assert.equal((await json('POST', `/api/u/chats/${dm.id}/read/${sent.body.message.id}`, null, b.access)).status, 200)
  assert.equal((await json('GET', '/api/u/chats', null, b.access)).body.chats[0].unread, 0)
  assert.equal((await json('GET', `/api/u/chats/${dm.id}/reads`, null, a.access)).body.reads[b.user.id], sent.body.message.id)

  // Quien no está no ve nada
  assert.equal((await json('GET', `/api/u/chats/${dm.id}/messages`, null, c.access)).status, 404)
  assert.equal((await json('POST', `/api/u/chats/${dm.id}/messages`, { text: 'hola' }, c.access)).status, 404)

  // Respuesta, GIF de KLIPY y sticker incluido
  const mid = sent.body.message.id
  assert.equal((await json('POST', `/api/u/chats/${dm.id}/messages`, { text: 'dime', reply: mid }, b.access)).body.message.reply, mid)
  assert.equal((await json('POST', `/api/u/chats/${dm.id}/messages`, { gif: { url: 'https://static.klipy.com/ii/abc/1.gif', w: 200, h: 150 } }, b.access)).status, 200)
  assert.equal((await json('POST', `/api/u/chats/${dm.id}/messages`, { sticker: { kind: 'pack', code: '1f602' } }, b.access)).status, 200)
  // Invitación a tu Minecraft
  const inv = await json('POST', `/api/u/chats/${dm.id}/messages`, { invite: { kind: 'mc', name: 'Survival', version: '1.21.1', loader: 'fabric', where: 'lan' } }, b.access)
  assert.equal(inv.status, 200)
  assert.equal((await json('GET', '/api/u/chats', null, a.access)).body.chats.find((x) => x.id === dm.id).last.kind, 'invite')
  // Tras reiniciar el servidor (mensajes aún no cargados), la lista sigue sabiendo que lo último fue una invitación
  await restart()
  assert.equal((await json('GET', '/api/u/chats', null, a.access)).body.chats.find((x) => x.id === dm.id).last.kind, 'invite')
  // Datos raros fuera
  for (const body of [
    {},
    { text: '   ' },
    { text: 'x'.repeat(4001) },
    { text: 'a\u0007' },
    { gif: { url: 'https://evil.com/x.gif', w: 1, h: 1 } },
    { gif: { url: 'https://klipy.com.evil.com/x.gif', w: 1, h: 1 } },
    { sticker: { kind: 'pack', code: '../x' } },
    { text: 'hola', extra: 1 },
    { invite: { kind: 'mc', name: 'x', version: '1.21', loader: 'bukkit' } },
    { invite: { kind: 'game', game: 78980 } },
    { game: 78980 }
  ])
    assert.equal((await json('POST', `/api/u/chats/${dm.id}/messages`, body, a.access)).status, 400, JSON.stringify(body))

  // Editar solo lo tuyo; borrar deja «eliminado»; reaccionar pone y quita; fijar
  assert.equal((await json('PATCH', `/api/u/chats/${dm.id}/messages/${mid}`, { text: 'Hola beto' }, b.access)).status, 403)
  const edited = (await json('PATCH', `/api/u/chats/${dm.id}/messages/${mid}`, { text: 'Hola beto' }, a.access)).body.message
  assert.equal(edited.text, 'Hola beto')
  assert.ok(edited.edited)
  let r = (await json('POST', `/api/u/chats/${dm.id}/messages/${mid}/react`, { emoji: '🔥' }, b.access)).body.message
  assert.deepEqual(r.reactions, { '🔥': [b.user.id] })
  r = (await json('POST', `/api/u/chats/${dm.id}/messages/${mid}/react`, { emoji: '🔥' }, b.access)).body.message
  assert.equal(r.reactions, undefined)
  assert.deepEqual((await json('POST', `/api/u/chats/${dm.id}/pin/${mid}`, null, b.access)).body.pins, [mid])
  const del = (await json('DELETE', `/api/u/chats/${dm.id}/messages/${mid}`, null, a.access)).body.message
  assert.equal(del.deleted, true)
  assert.equal(del.text, undefined)
  assert.equal((await json('DELETE', `/api/u/chats/${dm.id}/messages/${mid + 1}`, null, a.access)).status, 403)

  // Grupo: solo con amigos tuyos; lo ven todos; salir y echar
  assert.equal((await json('POST', '/api/u/chats/group', { name: 'Mal', members: [c.user.id] }, b.access)).status, 403)
  const g = (await json('POST', '/api/u/chats/group', { name: 'Los del Valheim', icon: '⚔️', members: [b.user.id, c.user.id] }, a.access)).body.chat
  assert.equal(g.members.length, 3)
  assert.equal((await json('POST', `/api/u/chats/${g.id}/messages`, { text: 'Buenas' }, c.access)).status, 200)
  assert.ok((await json('GET', '/api/u/chats', null, b.access)).body.chats.some((x) => x.id === g.id))
  assert.equal((await json('PATCH', `/api/u/chats/${g.id}`, { name: 'Valheim 🛡️' }, b.access)).body.chat.name, 'Valheim 🛡️')
  // Icono: un emote de la app sí; cualquier otra cosa larga, no
  assert.equal((await json('PATCH', `/api/u/chats/${g.id}`, { icon: '<e:KEKW:01FCP0YPQ800037YGEKHNTNXY1>' }, b.access)).body.chat.icon, '<e:KEKW:01FCP0YPQ800037YGEKHNTNXY1>')
  assert.equal((await json('PATCH', `/api/u/chats/${g.id}`, { icon: '<img src=x onerror=alert(1)>' }, b.access)).status, 400)
  assert.equal((await json('DELETE', `/api/u/chats/${g.id}/members/${c.user.id}`, null, b.access)).status, 403)
  assert.equal((await json('DELETE', `/api/u/chats/${g.id}/members/${c.user.id}`, null, a.access)).status, 200)
  assert.equal((await json('GET', `/api/u/chats/${g.id}/messages`, null, c.access)).status, 404)
  assert.equal((await json('DELETE', `/api/u/chats/${g.id}/members/${b.user.id}`, null, b.access)).status, 200)

  // Stickers subidos: el tipo por su cabecera, sin duplicados, solo los tuyos en tus mensajes y los ve quien chatea contigo
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)])
  const put = (buf, type, token) => fetch(`${BASE}/api/u/stickers`, { method: 'PUT', headers: { 'Content-Type': type, Authorization: `Bearer ${token}` }, body: buf })
  const up = await (await put(png, 'image/png', a.access)).json()
  assert.match(up.id, /^[0-9a-f]{16}$/)
  assert.equal((await (await put(png, 'image/png', a.access)).json()).id, up.id)
  assert.equal((await put(Buffer.from('<svg onload=alert(1)>'.padEnd(64)), 'image/png', a.access)).status, 400)
  assert.equal((await put(Buffer.alloc(600 * 1024, 1), 'image/gif', a.access)).status, 413)
  assert.deepEqual((await json('GET', '/api/u/stickers', null, a.access)).body.stickers, [up.id])
  const mineSticker = { sticker: { kind: 'user', owner: a.user.id, id: up.id } }
  assert.equal((await json('POST', `/api/u/chats/${dm.id}/messages`, mineSticker, a.access)).status, 200)
  assert.equal((await json('POST', `/api/u/chats/${dm.id}/messages`, mineSticker, b.access)).status, 400)
  assert.equal((await json('POST', `/api/u/chats/${dm.id}/messages`, { sticker: { kind: 'user', owner: a.user.id, id: 'ffffffffffffffff' } }, a.access)).status, 400)
  const got = await fetch(`${BASE}/api/u/stickers/${a.user.id}/${up.id}`, { headers: { Authorization: `Bearer ${b.access}` } })
  assert.equal(got.status, 200)
  assert.equal(got.headers.get('content-type'), 'image/png')
  assert.equal((await json('DELETE', `/api/u/stickers/${up.id}`, null, a.access)).status, 200)
  assert.deepEqual((await json('GET', '/api/u/stickers', null, a.access)).body.stickers, [])

  // Capturas y clips: solo los miembros suben y ven, el tipo por su cabecera, vídeo por trozos y se borra con el mensaje
  const putMedia = (chatId, buf, type, token) =>
    fetch(`${BASE}/api/u/chats/${chatId}/media`, { method: 'PUT', headers: { 'Content-Type': type, Authorization: `Bearer ${token}` }, body: buf })
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(200)])
  const img = await (await putMedia(dm.id, jpg, 'image/jpeg', a.access)).json()
  assert.match(img.id, /^[0-9a-f]{16}$/)
  assert.equal((await putMedia(dm.id, jpg, 'image/jpeg', c.access)).status, 404)
  assert.equal((await putMedia(dm.id, Buffer.from('<svg onload=alert(1)>'.padEnd(64)), 'image/png', a.access)).status, 400)
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), randomBytes(5000)])
  const vid = await (await putMedia(dm.id, mp4, 'video/mp4', a.access)).json()
  assert.match(vid.id, /^[0-9a-f]{16}$/)
  assert.equal((await putMedia(dm.id, Buffer.from('esto no es un vídeo, no'), 'video/mp4', a.access)).status, 400)
  const clip = { media: { kind: 'video', id: vid.id, w: 1920, h: 1080, seconds: 30, game: 'Hades' } }
  assert.equal((await json('POST', `/api/u/chats/${dm.id}/messages`, clip, b.access)).status, 400)
  assert.equal((await json('POST', `/api/u/chats/${dm.id}/messages`, { media: { ...clip.media, kind: 'image' } }, a.access)).status, 400)
  const sentClip = await json('POST', `/api/u/chats/${dm.id}/messages`, clip, a.access)
  assert.equal(sentClip.status, 200)
  assert.equal((await json('GET', '/api/u/chats', null, b.access)).body.chats.find((x) => x.id === dm.id).last.kind, 'video')
  const part = await fetch(`${BASE}/api/u/chats/${dm.id}/media/${vid.id}`, { headers: { Authorization: `Bearer ${b.access}`, Range: 'bytes=0-99' } })
  assert.equal(part.status, 206)
  assert.equal(part.headers.get('content-type'), 'video/mp4')
  assert.equal((await part.arrayBuffer()).byteLength, 100)
  assert.equal((await fetch(`${BASE}/api/u/chats/${dm.id}/media/${vid.id}`, { headers: { Authorization: `Bearer ${c.access}` } })).status, 404)
  assert.equal((await json('DELETE', `/api/u/chats/${dm.id}/messages/${sentClip.body.message.id}`, null, a.access)).status, 200)
  assert.equal((await fetch(`${BASE}/api/u/chats/${dm.id}/media/${vid.id}`, { headers: { Authorization: `Bearer ${b.access}` } })).status, 404)

  // Límite: 40 mensajes por minuto por cuenta
  let limited = 0
  for (let i = 0; i < 45; i++) if ((await json('POST', `/api/u/chats/${g.id}/messages`, { text: `m${i}` }, a.access)).status === 429) limited++
  assert.ok(limited >= 1)

  // Al borrar una cuenta desaparece de sus chats (el privado se va entero)
  assert.equal((await json('DELETE', '/api/u/me', { password: 'secreto-beto-1' }, b.access)).status, 200)
  assert.ok(!(await json('GET', '/api/u/chats', null, a.access)).body.chats.some((x) => x.id === dm.id))
  ctrl.abort()
})

test('KLIPY: lo buscado se guarda y nunca se pasa del tope de llamadas por hora', async () => {
  const { createKlipy, HOURLY_BUDGET } = await import('../src/klipy.js')
  let n = 0
  const item = { id: 1, file: { md: { gif: { url: 'https://static.klipy.com/a.gif', width: 10, height: 10 } }, sm: { gif: { url: 'https://static.klipy.com/b.gif', width: 5, height: 5 } } } }
  const fake = async () => (n++, { ok: true, json: async () => ({ data: { data: [item] } }) })
  const k = createKlipy('clave', fake)
  // Lo mismo (con otras mayúsculas o espacios) no vuelve a llamar
  await k.search('gifs', 'Gato ', 'ES')
  await k.search('gifs', 'gato', 'ES')
  assert.equal(n, 1)
  for (let i = 0; i < HOURLY_BUDGET + 20; i++) await k.search('gifs', `q${i}`, 'ES').catch(() => null)
  assert.equal(n, HOURLY_BUDGET)
  // Lo ya guardado se sigue sirviendo sin gastar
  assert.equal((await k.search('gifs', 'gato', 'ES')).length, 1)
})

test('GIFs de KLIPY: solo direcciones de su CDN, con miniatura y la buena', async () => {
  const { pickFiles } = await import('../src/klipy.js')
  const item = {
    id: 7,
    file: {
      hd: { gif: { url: 'https://static.klipy.com/ii/a/hd.gif', width: 498, height: 280 } },
      md: { gif: { url: 'https://static.klipy.com/ii/a/md.gif', width: 320, height: 180 } },
      sm: { webp: { url: 'https://static.klipy.com/ii/a/sm.webp', width: 160, height: 90 } }
    }
  }
  assert.deepEqual(pickFiles(item), { id: '7', preview: 'https://static.klipy.com/ii/a/sm.webp', url: 'https://static.klipy.com/ii/a/md.gif', w: 320, h: 180 })
  // De otro sitio o sin medidas: fuera
  assert.equal(pickFiles({ file: { md: { gif: { url: 'https://evil.com/x.gif', width: 1, height: 1 } } } }), null)
  assert.equal(pickFiles({ file: { md: { gif: { url: 'https://static.klipy.com/x.gif' } } } }), null)
  assert.equal(pickFiles(null), null)
  // Los anuncios que mezcla KLIPY, fuera; los stickers, en WebP si lo hay
  assert.equal(pickFiles({ ...item, type: 'ad' }), null)
  const st = { id: 9, type: 'sticker', file: { md: { gif: { url: 'https://static.klipy.com/s.gif', width: 9, height: 9 }, webp: { url: 'https://static.klipy.com/s.webp', width: 9, height: 9 } }, sm: { webp: { url: 'https://static.klipy.com/t.webp', width: 4, height: 4 } } } }
  assert.equal(pickFiles(st, 'stickers').url, 'https://static.klipy.com/s.webp')
})
