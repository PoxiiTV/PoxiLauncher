// Todas las peticiones salientes del proceso principal pasan por aquí, con lista blanca.
import { app, net } from 'electron'
import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { once } from 'node:events'

/** Nuestro servidor (cuentas, amigos, chat, packs y túnel): la dirección base. Las actualizaciones van aparte (MAIN_VITE_UPDATE_URL) */
export const UPDATE_BASE = ((import.meta.env.MAIN_VITE_SERVER_URL as string | undefined) ?? '').replace(/\/+$/, '')
const UPDATE_HOST = UPDATE_BASE ? new URL(UPDATE_BASE).hostname : ''

const ALLOWED = [
  // Minecraft: cuenta Microsoft (Microsoft, Xbox y Mojang) y skins. Las descargas del juego las hace XMCL
  // directamente a los servidores oficiales de Mojang.
  'login.microsoftonline.com',
  'user.auth.xboxlive.com',
  'xsts.auth.xboxlive.com',
  'api.minecraftservices.com',
  'textures.minecraft.net',
  // Minecraft: mods, resource packs, shaders y modpacks (Modrinth)
  'api.modrinth.com',
  'cdn.modrinth.com',
  // Archivos de modpacks .mrpack: Modrinth solo admite estos hosts de descarga (GitHub redirige a sus servidores de archivos)
  'github.com',
  'gitlab.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  // Servidores de Minecraft desde una instancia: server.jar oficial y los de los loaders
  'piston-data.mojang.com',
  'launcher.mojang.com',
  'meta.fabricmc.net',
  'meta.quiltmc.org',
  'maven.minecraftforge.net',
  'maven.neoforged.net',
  // Clips: FFmpeg (se descarga al encenderlos)
  'www.gyan.dev',
  ...(UPDATE_HOST ? [UPDATE_HOST] : [])
]

export function isAllowedUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  const h = u.hostname.toLowerCase()
  return ALLOWED.some((a) => (a.startsWith('.') ? h.endsWith(a) : h === a))
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * DNS cifrado (Cloudflare y Google) para las peticiones de la app. Las operadoras suelen bloquear webs
 * cambiando la respuesta de su DNS; así no pueden verla ni tocarla. Solo afecta a la app, no a Windows.
 */
export function enableSecureDns(): void {
  app.configureHostResolver({
    secureDnsMode: 'secure',
    secureDnsServers: ['https://cloudflare-dns.com/dns-query', 'https://dns.google/dns-query']
  })
}

/**
 * fetch por la red de Chromium (con el DNS cifrado). Si esa vía falla por red (por ejemplo, una red que
 * no deja usar DNS cifrado), se intenta con la de siempre (el DNS de Windows).
 */
async function webFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await net.fetch(url, init)
  } catch (e) {
    if (init.signal?.aborted) throw e
    return fetch(url, init)
  }
}

/** Petición a nuestro servidor (cuentas y amigos) */
export function serverFetch(
  path: string,
  init: { method: string; headers?: Record<string, string>; body?: string | Uint8Array<ArrayBuffer>; timeoutMs?: number }
): Promise<Response> {
  if (!UPDATE_BASE) return Promise.reject(new Error('Sin servidor'))
  const { timeoutMs = 15_000, ...rest } = init
  return webFetch(`${UPDATE_BASE}${path}`, {
    ...rest,
    headers: { 'User-Agent': UA, ...init.headers },
    // 0: sin límite (un vídeo que se va viendo, una subida grande)
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined
  })
}

/** Conexión larga a nuestro servidor (avisos en directo): sin límite de tiempo; se corta con `signal` */
export function serverStream(path: string, headers: Record<string, string>, signal: AbortSignal): Promise<Response> {
  if (!UPDATE_BASE) return Promise.reject(new Error('Sin servidor'))
  return webFetch(`${UPDATE_BASE}${path}`, { method: 'GET', headers: { 'User-Agent': UA, Accept: 'text/event-stream', ...headers }, signal })
}

/**
 * Sube un archivo grande a nuestro servidor sin cargarlo en memoria (mundos compartidos de Minecraft), en partes de
 * 32 MB: Cloudflare gratis corta los cuerpos de más de 100 MB. Devuelve la respuesta de la última parte.
 */
export async function serverUpload(path: string, file: string, headers: Record<string, string>): Promise<Response> {
  if (!UPDATE_BASE) throw new Error('Sin servidor')
  const PART = 32 * 1024 * 1024
  const { size } = await stat(file)
  const parts = Math.max(1, Math.ceil(size / PART))
  const upload = randomUUID()
  let res: Response | null = null
  for (let i = 0; i < parts; i++) {
    const start = i * PART
    const end = Math.min(size, start + PART) - 1
    const sep = path.includes('?') ? '&' : '?'
    res = await fetch(`${UPDATE_BASE}${path}${sep}part=${i}&parts=${parts}&upload=${upload}`, {
      method: 'PUT',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/octet-stream', 'Content-Length': String(end - start + 1), ...headers },
      body: Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream,
      duplex: 'half'
    } as RequestInit)
    if (!res.ok) return res
  }
  return res!
}

/** Baja un archivo grande de nuestro servidor a disco (mundos compartidos de Minecraft) */
export async function serverDownload(path: string, file: string, headers: Record<string, string>): Promise<boolean> {
  if (!UPDATE_BASE) return false
  const res = await webFetch(`${UPDATE_BASE}${path}`, { headers: { 'User-Agent': UA, ...headers } })
  if (!res.ok || !res.body) return false
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file))
  return true
}

/**
 * fetch con lista blanca, timeout y reintentos con espera creciente en 429/5xx/red. Con `body`, es un POST (o el
 * método que se diga: PUT, DELETE…).
 */
export async function safeFetch(
  url: string,
  tries = 4,
  headers: Record<string, string> = {},
  body?: string | FormData,
  method?: string
): Promise<Response> {
  if (!isAllowedUrl(url)) throw new Error(`Host no permitido: ${url}`)
  let lastErr: unknown
  for (let i = 0; i < tries; i++) {
    try {
      const res = await webFetch(url, {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        body,
        headers: { 'User-Agent': UA, ...headers },
        signal: AbortSignal.timeout(20_000)
      })
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`)
      } else {
        return res
      }
    } catch (e) {
      lastErr = e
    }
    await sleep(800 * 2 ** i)
  }
  throw lastErr
}

/**
 * Descarga un archivo grande a disco sin cargarlo en memoria. Sin límite de tiempo total: solo se corta si pasa
 * medio minuto sin llegar nada.
 */
export async function downloadTo(url: string, file: string, onProgress: (done: number, total: number) => void, idleMs = 30_000): Promise<void> {
  if (!isAllowedUrl(url)) throw new Error(`Host no permitido: ${url}`)
  const idle = new AbortController()
  let timer = setTimeout(() => idle.abort(), idleMs)
  try {
    const res = await webFetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: idle.signal })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const total = Number(res.headers.get('content-length')) || 0
    const out = createWriteStream(file)
    let done = 0
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        clearTimeout(timer)
        timer = setTimeout(() => idle.abort(), idleMs)
        done += chunk.length
        if (!out.write(chunk)) await once(out, 'drain')
        onProgress(done, total)
      }
    } finally {
      await new Promise<void>((r) => out.end(r))
    }
    if (total && done < total) throw new Error('Descarga incompleta')
  } finally {
    clearTimeout(timer)
  }
}
