import { randomUUID } from 'node:crypto'
import { WebSocketServer } from 'ws'

// Túnel para jugar a Minecraft con amigos sin abrir puertos: quien aloja (un mundo abierto a LAN o un servidor en
// su PC) abre un canal de control; cada amigo que entra abre un canal de datos y el anfitrión abre otro para esa
// conexión; aquí se unen los dos y los bytes pasan tal cual. Solo pueden entrar amigos del anfitrión.
//
//   /api/u/tunnel/host          anfitrión: canal de control (recibe { type: 'ready', id } y { type: 'open', conn })
//   /api/u/tunnel/join/:id      amigo: datos de una conexión nueva a ese túnel
//   /api/u/tunnel/accept/:conn  anfitrión: datos de esa conexión (se une con la del amigo)

const MAX_TUNNELS_PER_USER = 2
const MAX_CONNS_PER_TUNNEL = 16
/** Lo que se guarda de un amigo mientras el anfitrión contesta (el saludo de Minecraft es pequeño) */
const MAX_PENDING_BYTES = 1024 * 1024
const ACCEPT_TIMEOUT_MS = 15_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function createTunnels(accounts) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PENDING_BYTES })
  /** id → { id, owner, control, conns: Set<connId> } */
  const tunnels = new Map()
  /** connId → { tunnel, guest, pending: Buffer[], bytes, timer } */
  const conns = new Map()

  const userOf = (req) => accounts.auth(/^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1])
  const reject = (socket, code, text) => {
    // Respuesta HTTP completa (con Content-Length): si no, el túnel de Cloudflare la da por mala y devuelve 502
    socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${text.length}\r\n\r\n${text}`)
    socket.destroy()
  }
  const closeConn = (id) => {
    const c = conns.get(id)
    if (!c) return
    conns.delete(id)
    clearTimeout(c.timer)
    c.tunnel.conns.delete(id)
    c.guest.close()
    c.host?.close()
  }

  function host(ws, user) {
    const t = { id: randomUUID(), owner: user.id, control: ws, conns: new Set() }
    tunnels.set(t.id, t)
    ws.send(JSON.stringify({ type: 'ready', id: t.id }))
    ws.on('close', () => {
      tunnels.delete(t.id)
      for (const c of [...t.conns]) closeConn(c)
    })
    // El anfitrión no manda nada por el control: si lo hace, fuera
    ws.on('message', () => ws.close())
  }

  function join(ws, user, tunnelId) {
    const t = tunnels.get(tunnelId)
    const owner = t && accounts.user(t.owner)
    if (!t || !owner || !owner.friends.includes(user.id) || t.conns.size >= MAX_CONNS_PER_TUNNEL) return ws.close(4003)
    const id = randomUUID()
    const c = { tunnel: t, guest: ws, host: null, pending: [], bytes: 0, timer: setTimeout(() => closeConn(id), ACCEPT_TIMEOUT_MS) }
    conns.set(id, c)
    t.conns.add(id)
    ws.on('message', (data) => {
      if (c.host) return c.host.send(data)
      c.bytes += data.length
      if (c.bytes > MAX_PENDING_BYTES) return closeConn(id)
      c.pending.push(data)
    })
    ws.on('close', () => closeConn(id))
    t.control.send(JSON.stringify({ type: 'open', conn: id }))
  }

  function accept(ws, user, connId) {
    const c = conns.get(connId)
    if (!c || c.host || c.tunnel.owner !== user.id) return ws.close(4003)
    clearTimeout(c.timer)
    c.host = ws
    for (const d of c.pending) ws.send(d)
    c.pending = []
    ws.on('message', (data) => c.guest.send(data))
    ws.on('close', () => closeConn(connId))
  }

  return {
    /** Para el evento "upgrade" del servidor HTTP; devuelve false si la ruta no es del túnel */
    upgrade(req, socket, head) {
      const m = /^\/api\/u\/tunnel\/(host|join|accept)(?:\/([^/?]+))?(?:\?.*)?$/.exec(req.url ?? '')
      if (!m) return false
      const user = userOf(req)
      if (!user) return reject(socket, 401, 'Unauthorized'), true
      const [, kind, id] = m
      if (kind === 'host' && [...tunnels.values()].filter((t) => t.owner === user.id).length >= MAX_TUNNELS_PER_USER) return reject(socket, 429, 'Too Many'), true
      if (kind !== 'host' && !UUID.test(id ?? '')) return reject(socket, 400, 'Bad Request'), true
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.on('error', () => ws.close())
        if (kind === 'host') host(ws, user)
        else if (kind === 'join') join(ws, user, id)
        else accept(ws, user, id)
      })
      return true
    },
    /** ¿Existe este túnel y es de esta cuenta? (la presencia solo anuncia túneles de verdad) */
    ownedBy: (id, userId) => tunnels.get(id)?.owner === userId,
    stats: () => ({ tunnels: tunnels.size, conns: conns.size })
  }
}
