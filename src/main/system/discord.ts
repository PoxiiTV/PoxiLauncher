import { connect, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'

// Presencia en Discord ("Jugando a PoxiLauncher" y, con un juego abierto, cuál y desde cuándo).
// Se habla con el Discord del PC por su tubería local (\\.\pipe\discord-ipc-N), sin librerías: cada mensaje
// es [tipo (4 bytes) | longitud (4 bytes) | JSON]. Si Discord no está abierto no pasa nada: se reintenta.

const RETRY_MS = 60_000

export interface Activity {
  details?: string
  state?: string
  startedAt?: number
  largeImage?: string
  largeText?: string
}

/** Un mensaje en el formato de Discord (pura, para poder probarla) */
export function frame(op: number, data: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(data), 'utf8')
  const head = Buffer.alloc(8)
  head.writeInt32LE(op, 0)
  head.writeInt32LE(json.length, 4)
  return Buffer.concat([head, json])
}

/** La actividad tal como la espera Discord (pura) */
export function toDiscord(a: Activity): Record<string, unknown> {
  return {
    ...(a.details ? { details: a.details.slice(0, 128) } : {}),
    ...(a.state ? { state: a.state.slice(0, 128) } : {}),
    ...(a.startedAt ? { timestamps: { start: Math.floor(a.startedAt / 1000) } } : {}),
    assets: {
      large_image: a.largeImage ?? 'poxilauncher',
      large_text: (a.largeText ?? 'PoxiLauncher').slice(0, 128),
      ...(a.largeImage ? { small_image: 'poxilauncher', small_text: 'PoxiLauncher' } : {})
    },
    instance: false
  }
}

export function createDiscordPresence(appId: string): { set: (a: Activity | null) => void; stop: () => void } {
  let sock: Socket | null = null
  let ready = false
  let current: Activity | null = null
  let retry: NodeJS.Timeout | null = null
  let stopped = false

  const send = (): void => {
    if (!sock || !ready) return
    sock.write(
      frame(1, {
        cmd: 'SET_ACTIVITY',
        args: { pid: process.pid, activity: current ? toDiscord(current) : null },
        nonce: randomUUID()
      })
    )
  }

  const scheduleRetry = (): void => {
    if (stopped || retry) return
    retry = setTimeout(() => {
      retry = null
      void open()
    }, RETRY_MS)
    retry.unref()
  }

  const tryPipe = (n: number): Promise<Socket | null> =>
    new Promise((res) => {
      const s = connect(`\\\\?\\pipe\\discord-ipc-${n}`)
      s.once('connect', () => res(s))
      s.once('error', () => res(null))
    })

  async function open(): Promise<void> {
    if (stopped || sock) return
    // Discord abre la primera tubería libre entre la 0 y la 9
    for (let n = 0; n < 10 && !sock; n++) sock = await tryPipe(n)
    if (!sock) return scheduleRetry()
    const s = sock
    let buf = Buffer.alloc(0)
    s.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk])
      while (buf.length >= 8) {
        const len = buf.readInt32LE(4)
        if (buf.length < 8 + len) break
        const op = buf.readInt32LE(0)
        let msg: { evt?: string } = {}
        try {
          msg = JSON.parse(buf.subarray(8, 8 + len).toString('utf8'))
        } catch {
          /* mensaje raro: se ignora */
        }
        buf = buf.subarray(8 + len)
        // Listo para recibir actividades
        if (op === 1 && msg.evt === 'READY') {
          ready = true
          send()
        }
        // Discord pide cerrar (p. ej. id de aplicación incorrecto)
        if (op === 2) s.destroy()
      }
    })
    const closed = (): void => {
      if (sock === s) {
        sock = null
        ready = false
      }
      scheduleRetry()
    }
    s.on('close', closed)
    s.on('error', closed)
    s.write(frame(0, { v: 1, client_id: appId }))
  }

  void open()
  return {
    set(a) {
      current = a
      send()
    },
    stop() {
      stopped = true
      if (retry) clearTimeout(retry)
      if (sock && ready) {
        current = null
        send()
      }
      sock?.destroy()
      sock = null
    }
  }
}
