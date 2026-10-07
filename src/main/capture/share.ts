// Compartir capturas y clips en el chat: se sube el archivo al servidor, ligado a ese chat (solo lo ven sus miembros,
// y se borra a los 30 días), y se manda un mensaje que lo apunta. Las capturas van en JPEG (una PNG de 1440p pesa
// mucho); un clip de más de 60 MB se vuelve a comprimir para que quepa. Aquí también se sirven a la interfaz:
// poxi-img://media/<chat>/<id> (del disco si es tuyo o ya se bajó; los vídeos del servidor, por trozos) y
// poxi-img://capture/<id> (la miniatura de una captura tuya, para elegir cuál compartir).
import { nativeImage } from 'electron'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { z } from 'zod'
import type { ChatMessage } from '@shared/chat'
import { imageType } from '@shared/profile'
import { dataPath } from '../store'
import { rawCall, signedIn } from '../account/service'
import { sendMessage } from '../chat/service'
import { captureById, thumbPath } from './service'
import { shrinkForShare } from './recorder'

/** Lo que admite el servidor (media.js) */
const MAX_IMAGE = 10 * 1024 * 1024
const MAX_VIDEO = 60 * 1024 * 1024
const UPLOAD_MS = 10 * 60_000

const CACHE = (): string => dataPath('media')
const cacheFile = (chat: string, id: string): string => join(CACHE(), `${chat}-${id}`)
const isMp4 = (b: Buffer): boolean => b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp'
const MIMES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' } as const

type ShareError = 'gone' | 'too-big' | 'full' | 'offline' | 'invalid' | 'limit' | 'forbidden'

export async function shareCapture(chatId: string, captureId: string, text?: string): Promise<{ message?: ChatMessage; error?: ShareError }> {
  const c = captureById(captureId)
  if (!c || !existsSync(c.path)) return { error: 'gone' }
  let body: Buffer
  let type: string
  let temp: string | null = null
  if (c.kind === 'image') {
    const img = nativeImage.createFromPath(c.path)
    if (img.isEmpty()) return { error: 'gone' }
    body = img.toJPEG(90)
    if (body.length > MAX_IMAGE) body = img.toJPEG(70)
    if (body.length > MAX_IMAGE) return { error: 'too-big' }
    type = 'image/jpeg'
  } else {
    let file = c.path
    if ((await stat(file)).size > MAX_VIDEO) {
      temp = await shrinkForShare(file, c.seconds ?? 30, c.h, MAX_VIDEO)
      if (!temp) return { error: 'too-big' }
      file = temp
    }
    // ponytail: el clip entero en memoria (60 MB como mucho); por trozos desde disco si algún día se sube el límite
    body = await readFile(file)
    type = 'video/mp4'
  }
  try {
    const res = await rawCall('PUT', `/chats/${chatId}/media`, body, type, { timeoutMs: UPLOAD_MS }).catch(() => null)
    if (!res) return { error: 'offline' }
    if (!res.ok)
      return {
        error: res.status === 409 ? 'full' : res.status === 413 ? 'too-big' : res.status === 404 ? 'forbidden' : res.status === 429 ? 'limit' : 'invalid'
      }
    const up = z.object({ id: z.string().regex(/^[0-9a-f]{16}$/) }).safeParse(await res.json().catch(() => null))
    if (!up.success) return { error: 'offline' }
    // Lo tuyo se ve al momento, sin volver a bajarlo
    await mkdir(CACHE(), { recursive: true })
    await writeFile(cacheFile(chatId, up.data.id), body)
    const img = c.kind === 'image' ? nativeImage.createFromBuffer(body).getSize() : { width: c.w, height: c.h }
    const out = await sendMessage(chatId, {
      ...(text?.trim() ? { text } : {}),
      media: {
        kind: c.kind,
        id: up.data.id,
        w: img.width,
        h: img.height,
        ...(c.seconds ? { seconds: c.seconds } : {}),
        ...(c.game && c.game !== 'PoxiLauncher' ? { game: c.game.slice(0, 80) } : {})
      }
    })
    return out.message ? { message: out.message } : { error: (out.error as ShareError) ?? 'offline' }
  } finally {
    if (temp) void rm(temp, { force: true }).catch(() => undefined)
  }
}

/** Un archivo del disco, entero o el trozo que pida el reproductor (Range) */
async function fromDisk(file: string, type: string, range: string | null): Promise<Response> {
  const size = (await stat(file)).size
  const m = /^bytes=(\d*)-(\d*)$/.exec(range ?? '')
  if (!m || (!m[1] && !m[2])) {
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
      headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' }
    })
  }
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
    status: 206,
    headers: { 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' }
  })
}

/** Qué es lo guardado: mirando el principio (un vídeo no se lee entero en cada trozo que pide el reproductor) */
async function sniff(file: string): Promise<string | null> {
  const head = Buffer.alloc(12)
  const f = await open(file, 'r').catch(() => null)
  if (!f) return null
  await f.read(head, 0, 12, 0).finally(() => f.close())
  if (isMp4(head)) return 'video/mp4'
  const t = imageType(await readFile(file))
  return t ? MIMES[t] : null
}

/** poxi-img://media/<chat>/<id> */
export async function serveMedia(request: Request): Promise<Response> {
  const [, chat, id] = new URL(request.url).pathname.split('/')
  if (!z.string().uuid().safeParse(chat).success || !/^[0-9a-f]{16}$/.test(id ?? '')) return new Response(null, { status: 400 })
  const range = request.headers.get('range')
  const file = cacheFile(chat, id)
  if (existsSync(file)) {
    const type = await sniff(file)
    if (type) return fromDisk(file, type, range)
  }
  if (!signedIn()) return new Response(null, { status: 404 })
  const res = await rawCall('GET', `/chats/${chat}/media/${id}`, undefined, undefined, { headers: range ? { Range: range } : {}, timeoutMs: 0 }).catch(
    () => null
  )
  if (!res?.ok || !res.body) return new Response(null, { status: res?.status === 404 ? 404 : 502 })
  const type = res.headers.get('content-type') ?? ''
  // Un vídeo se va viendo tal cual llega (por trozos); una imagen se guarda para la próxima vez
  if (type === 'video/mp4') {
    const headers: Record<string, string> = { 'Content-Type': type, 'Accept-Ranges': 'bytes' }
    for (const h of ['content-length', 'content-range']) {
      const v = res.headers.get(h)
      if (v) headers[h] = v
    }
    return new Response(res.body, { status: res.status, headers })
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const t = imageType(buf)
  if (!t) return new Response(null, { status: 502 })
  await mkdir(CACHE(), { recursive: true })
  await writeFile(file, buf).catch(() => undefined)
  return new Response(new Uint8Array(buf), { headers: { 'Content-Type': MIMES[t], 'Cache-Control': 'max-age=2592000' } })
}

/** poxi-img://capture/<id>: la miniatura de una captura o un clip tuyo */
export async function serveCaptureThumb(request: Request): Promise<Response> {
  const id = new URL(request.url).pathname.slice(1)
  if (!z.string().uuid().safeParse(id).success || !captureById(id) || !existsSync(thumbPath(id))) return new Response(null, { status: 404 })
  return new Response(new Uint8Array(await readFile(thumbPath(id))), { headers: { 'Content-Type': 'image/jpeg' } })
}
