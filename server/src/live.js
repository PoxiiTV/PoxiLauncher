// Avisos en directo a la app (Server-Sent Events). No lleva datos: solo "algo ha cambiado" (una solicitud de
// amistad, un amigo que empieza a jugar, un cambio en un grupo de mods…) y la app pide lo nuevo con su sesión,
// como siempre. Un comentario cada 25 s mantiene viva la conexión (Cloudflare corta las que están calladas).

const PING_MS = 25_000
/** Conexiones abiertas por cuenta (varios PC o una app que se reconecta): las más viejas se cierran */
const MAX_PER_USER = 4

export function createLive() {
  /** id de cuenta → conexiones abiertas */
  const subs = new Map()

  return {
    open(userId, res) {
      res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' })
      res.flushHeaders()
      res.write(': hola\n\n')
      const set = subs.get(userId) ?? new Set()
      subs.set(userId, set)
      set.add(res)
      while (set.size > MAX_PER_USER) {
        const oldest = set.values().next().value
        set.delete(oldest)
        oldest.end()
      }
      const ping = setInterval(() => res.write(': ping\n\n'), PING_MS)
      res.on('close', () => {
        clearInterval(ping)
        set.delete(res)
        if (!set.size) subs.delete(userId)
      })
    },

    /** Avisa a estas cuentas (las que estén conectadas) de que algo suyo ha cambiado. `data`: solo ids (qué chat,
     * qué mensaje…), nunca contenido: la app pide lo nuevo con su sesión */
    notify(ids, what = 'friends', data = {}) {
      const payload = JSON.stringify(data)
      for (const id of new Set(ids)) for (const res of subs.get(id) ?? []) res.write(`event: ${what}\ndata: ${payload}\n\n`)
    },

    /** Cuántas conexiones hay (para las pruebas) */
    count: (id) => subs.get(id)?.size ?? 0
  }
}
