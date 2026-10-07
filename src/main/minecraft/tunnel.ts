import { connect, createServer, type Server, type Socket } from 'node:net'
import WebSocket from 'ws'

// Túnel por nuestro servidor para jugar con amigos sin abrir puertos (el servidor solo une las dos puntas).
//   Anfitrión: hostTunnel(puerto local de su mundo o servidor) → id que se anuncia a sus amigos.
//   Amigo: joinTunnel(id) → un puerto en 127.0.0.1 al que su Minecraft se conecta como a un servidor normal.
// Sin Electron: recibe la dirección del servidor y cómo conseguir el token (se renueva cada 15 min).

type Token = () => Promise<string | null>

const wsUrl = (base: string, path: string): string => `${base.replace(/^http/, 'ws')}/api/u/tunnel/${path}`

async function open(base: string, path: string, token: Token): Promise<WebSocket> {
  const t = await token()
  if (!t) throw new Error('Sin sesión')
  const ws = new WebSocket(wsUrl(base, path), { headers: { Authorization: `Bearer ${t}` }, perMessageDeflate: false })
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)))
  })
  // Cloudflare cierra los WebSocket que pasan unos 100 s sin tráfico (el canal de control está callado hasta que
  // entra alguien): un ping cada 30 s los mantiene abiertos
  const keepAlive = setInterval(() => ws.readyState === WebSocket.OPEN && ws.ping(), 30_000)
  ws.once('close', () => clearInterval(keepAlive))
  return ws
}

/** Une un socket TCP con un WebSocket en los dos sentidos; si se cierra uno, se cierra el otro */
function pipe(sock: Socket, ws: WebSocket): void {
  sock.on('data', (d) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(d)
  })
  ws.on('message', (d: Buffer) => {
    if (!sock.destroyed) sock.write(d)
  })
  const close = (): void => {
    sock.destroy()
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close()
  }
  sock.on('close', close)
  sock.on('error', close)
  ws.on('close', close)
  ws.on('error', close)
}

export interface HostedTunnel {
  id: string
  close(): void
}

/** Abre el túnel hacia un puerto local (tu mundo abierto a LAN o tu servidor) */
export async function hostTunnel(base: string, token: Token, localPort: number, onClose?: () => void): Promise<HostedTunnel> {
  const control = await open(base, 'host', token)
  const id = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Sin respuesta')), 10_000)
    control.once('message', (d: Buffer) => {
      clearTimeout(timer)
      try {
        const m = JSON.parse(d.toString()) as { type: string; id?: string }
        if (m.type === 'ready' && m.id) resolve(m.id)
        else reject(new Error('Respuesta rara'))
      } catch (e) {
        reject(e as Error)
      }
    })
  })
  const open_ = new Set<Socket>()
  control.on('message', (d: Buffer) => {
    let m: { type?: string; conn?: string }
    try {
      m = JSON.parse(d.toString())
    } catch {
      return
    }
    if (m.type !== 'open' || !m.conn || !/^[0-9a-f-]{36}$/.test(m.conn)) return
    // Un amigo entra: conexión al juego local y su canal de datos en el servidor
    const sock = connect(localPort, '127.0.0.1')
    open_.add(sock)
    sock.on('close', () => open_.delete(sock))
    sock.pause()
    open(base, `accept/${m.conn}`, token)
      .then((ws) => {
        pipe(sock, ws)
        sock.resume()
      })
      .catch(() => sock.destroy())
  })
  control.on('close', () => {
    for (const s of open_) s.destroy()
    onClose?.()
  })
  return { id, close: () => control.close() }
}

export interface JoinedTunnel {
  port: number
  close(): void
}

/** Puerto local que lleva al túnel de un amigo (cada conexión de tu Minecraft es un canal nuevo) */
export async function joinTunnel(base: string, token: Token, tunnelId: string): Promise<JoinedTunnel> {
  const server: Server = createServer((sock) => {
    sock.pause()
    open(base, `join/${tunnelId}`, token)
      .then((ws) => {
        pipe(sock, ws)
        sock.resume()
      })
      .catch(() => sock.destroy())
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  return { port, close: () => server.close() }
}
