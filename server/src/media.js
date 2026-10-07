import { randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { imageType } from './banners.js'

// Capturas y clips compartidos en el chat: cada archivo va con su chat (solo lo ven sus miembros) y con quien lo subió.
// Imágenes hasta 10 MB y vídeos MP4 hasta 60 MB; cada cuenta puede tener 1 GB a la vez y todo se borra a los 30 días
// (o al borrar el mensaje). El tipo sale de la cabecera real del archivo y el nombre lo pone el servidor.

export const MAX_IMAGE = 10 * 1024 * 1024
export const MAX_VIDEO = 60 * 1024 * 1024
export const QUOTA = 1024 * 1024 * 1024
export const TTL_MS = 30 * 24 * 3600_000
export const MEDIA_MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4' }

const validId = (id) => typeof id === 'string' && /^[0-9a-f]{16}$/.test(id)
/** Un MP4 de verdad: «ftyp» en el byte 4 */
const isMp4 = (head) => head.length >= 12 && head.toString('ascii', 4, 8) === 'ftyp'

export function createMedia(dataDir) {
  const root = join(dataDir, 'media')
  const indexFile = join(root, 'index.json')
  /** id → { chat, owner, type, bytes, at } */
  let index = {}
  let saving = Promise.resolve()
  const fileOf = (id, type) => join(root, `${id}.${type}`)
  const save = () => {
    saving = saving.then(async () => {
      await writeFile(`${indexFile}.tmp`, JSON.stringify(index))
      await rename(`${indexFile}.tmp`, indexFile)
    })
    return saving
  }
  const used = (owner) => Object.values(index).reduce((n, m) => (m.owner === owner ? n + m.bytes : n), 0)
  const add = async (id, m) => {
    index[id] = m
    await save()
    return { id }
  }

  async function drop(id) {
    const m = index[id]
    if (!m) return
    delete index[id]
    await rm(fileOf(id, m.type), { force: true })
  }

  return {
    async init() {
      await mkdir(root, { recursive: true })
      index = JSON.parse(await readFile(indexFile, 'utf8').catch(() => '{}'))
      await this.sweep()
    },

    /** Una imagen (ya en memoria, es pequeña): { id } o { error } */
    async saveImage(owner, chat, buf) {
      const type = Buffer.isBuffer(buf) && buf.length <= MAX_IMAGE ? imageType(buf) : null
      if (!type || type === 'gif') return { error: 'Imagen no válida' }
      if (used(owner) + buf.length > QUOTA) return { error: 'Sin espacio', status: 409 }
      const id = randomBytes(8).toString('hex')
      await writeFile(`${fileOf(id, type)}.tmp`, buf)
      await rename(`${fileOf(id, type)}.tmp`, fileOf(id, type))
      return add(id, { chat, owner, type, bytes: buf.length, at: Date.now() })
    },

    /** Un vídeo, directo del cuerpo de la petición al disco (sin tenerlo entero en memoria) */
    async saveVideo(owner, chat, req) {
      const size = Number(req.get('content-length'))
      if (!Number.isFinite(size) || size <= 0) return { error: 'Falta el tamaño', status: 411 }
      if (size > MAX_VIDEO) return { error: 'Máximo 60 MB', status: 413 }
      if (used(owner) + size > QUOTA) return { error: 'Sin espacio', status: 409 }
      const id = randomBytes(8).toString('hex')
      const tmp = `${fileOf(id, 'mp4')}.tmp`
      let bytes = 0
      const ok = await new Promise((resolve) => {
        const out = createWriteStream(tmp)
        req.on('data', (c) => {
          bytes += c.length
          // Manda más de lo que dijo: se corta
          if (bytes > size || bytes > MAX_VIDEO) {
            req.unpipe(out)
            out.destroy()
            resolve(false)
          }
        })
        req.on('aborted', () => resolve(false))
        out.on('error', () => resolve(false))
        out.on('finish', () => resolve(bytes === size))
        req.pipe(out)
      })
      const head = Buffer.alloc(12)
      if (ok) {
        const f = await open(tmp, 'r')
        await f.read(head, 0, 12, 0).finally(() => f.close())
      }
      if (!ok || !isMp4(head)) {
        await rm(tmp, { force: true })
        return { error: 'Vídeo no válido' }
      }
      await rename(tmp, fileOf(id, 'mp4'))
      return add(id, { chat, owner, type: 'mp4', bytes, at: Date.now() })
    },

    /** Para servirlo: la ruta y el tipo, si es de ese chat */
    get(chat, id) {
      const m = validId(id) ? index[id] : null
      return m && m.chat === chat ? { file: fileOf(id, m.type), type: m.type } : null
    },

    /** ¿Lo subió esa cuenta a ese chat? (para mandarlo en un mensaje) */
    owns(owner, chat, id, kind) {
      const m = validId(id) ? index[id] : null
      return !!m && m.owner === owner && m.chat === chat && (kind === 'video') === (m.type === 'mp4')
    },

    remove: (id) => (validId(id) ? drop(id).then(save) : undefined),

    /** Lo de más de 30 días fuera */
    async sweep() {
      const old = Object.entries(index)
        .filter(([, m]) => Date.now() - m.at > TTL_MS)
        .map(([id]) => id)
      for (const id of old) await drop(id)
      if (old.length) await save()
    },

    /** Al borrar una cuenta, lo que subió */
    async forget(owner) {
      const mine = Object.entries(index)
        .filter(([, m]) => m.owner === owner)
        .map(([id]) => id)
      for (const id of mine) await drop(id)
      if (mine.length) await save()
    },

    used
  }
}
