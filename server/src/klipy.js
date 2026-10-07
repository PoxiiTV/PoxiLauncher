import { KLIPY_URL } from './chat.js'

// GIFs y stickers de KLIPY para el chat. El servidor hace de intermediario: la clave (KLIPY_API_KEY en el .env) nunca
// llega a la app. Sin clave, no hay buscador (la app lo dice). Solo se devuelven direcciones del CDN de KLIPY.

const BASE = 'https://api.klipy.com/api/v1'
// La clave de pruebas da 100 llamadas a la hora para todos: lo buscado se guarda horas (los resultados apenas
// cambian), lo más usado una hora, y pasado el tope propio se tira de lo guardado aunque sea viejo
const SEARCH_MS = 6 * 3600_000
const TRENDING_MS = 3600_000
const MAX_CACHE = 1000
export const HOURLY_BUDGET = 90

/** De un resultado de KLIPY: la miniatura (pequeña) y la buena, con sus medidas; null si no trae nada válido o es un
 * anuncio (KLIPY los mezcla entre los resultados). Los stickers, mejor en WebP (transparencia y menos peso) */
export function pickFiles(item, kind = 'gifs') {
  if (item?.type && !['gif', 'sticker'].includes(item.type)) return null
  const files = item?.file ?? item?.files
  if (!files || typeof files !== 'object') return null
  const formats = kind === 'stickers' ? ['webp', 'gif'] : ['gif', 'webp']
  const pick = (sizes) => {
    for (const s of sizes) {
      const f = files[s]
      for (const fmt of formats) {
        const x = f?.[fmt]
        if (x && typeof x.url === 'string' && KLIPY_URL.test(x.url) && x.width > 0 && x.height > 0) return { url: x.url, w: Math.round(x.width), h: Math.round(x.height) }
      }
    }
    return null
  }
  const full = pick(['md', 'hd', 'sm', 'xs'])
  const small = pick(['sm', 'xs', 'md'])
  if (!full || !small) return null
  return { id: String(item.id ?? item.slug ?? full.url).slice(0, 80), preview: small.url, url: full.url, w: full.w, h: full.h }
}

export function createKlipy(key, fetchFn = fetch) {
  const cache = new Map()
  /** Cuándo se hizo cada llamada de la última hora */
  let calls = []
  return {
    enabled: !!key,
    /** Buscar (o, sin texto, lo más usado ahora) GIFs o stickers */
    async search(kind, query, locale, customer = 'poxilauncher') {
      if (!key) return null
      const q = query.trim().toLowerCase()
      const k = `${kind}:${locale}:${q}`
      const hit = cache.get(k)
      if (hit && Date.now() - hit.at < (q ? SEARCH_MS : TRENDING_MS)) return hit.items
      // Sin llamadas libres: lo guardado (aunque sea viejo) o nada, pero nunca pasarse del límite de KLIPY
      calls = calls.filter((t) => Date.now() - t < 3600_000)
      if (calls.length >= HOURLY_BUDGET) {
        if (hit) return hit.items
        throw Object.assign(new Error('KLIPY: sin llamadas libres esta hora'), { budget: true })
      }
      calls.push(Date.now())
      const path = q ? `search?q=${encodeURIComponent(q)}&` : 'trending?'
      const res = await fetchFn(`${BASE}/${key}/${kind}/${path}per_page=30&page=1&customer_id=${encodeURIComponent(customer)}&locale=${locale}&content_filter=medium`, {
        signal: AbortSignal.timeout(10_000)
      })
      if (!res.ok) {
        if (hit) return hit.items
        throw new Error(`KLIPY ${res.status}`)
      }
      const body = await res.json()
      const list = body?.data?.data
      const items = (Array.isArray(list) ? list : []).map((x) => pickFiles(x, kind)).filter(Boolean)
      if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value)
      cache.delete(k)
      cache.set(k, { at: Date.now(), items })
      return items
    }
  }
}
