import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// Banners de perfil: una imagen o un GIF animado (hasta 20 MB) por cuenta. El tipo sale de la cabecera real del
// archivo (nunca del que diga la petición) y el nombre lo pone el servidor (el id de la cuenta): el usuario no elige
// rutas. Solo lo ven sus amigos (y él).

export const MAX_BANNER = 20 * 1024 * 1024

/** Tipo de imagen por su cabecera: gif, png, jpg o webp; null si no es ninguno (pura, testeable) */
export function imageType(b) {
  if (!Buffer.isBuffer(b) || b.length < 16 || b.length > MAX_BANNER) return null
  const ascii = (o, n) => b.toString('ascii', o, o + n)
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'gif'
  if (b[0] === 0x89 && ascii(1, 3) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP' && b.readUInt32LE(4) + 8 === b.length) return 'webp'
  return null
}

export const MIME = { gif: 'image/gif', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }

export function createBanners(dataDir) {
  const dir = join(dataDir, 'banners')
  const valid = (id) => /^[0-9a-f-]{36}$/.test(id)
  const fileOf = (id, type) => join(dir, `${id}.${type}`)

  return {
    /** Guarda el banner de una cuenta: { v: versión (huella corta), type } o null si no es una imagen válida */
    async save(id, buf) {
      const type = imageType(buf)
      if (!valid(id) || !type) return null
      await this.remove(id)
      await mkdir(dir, { recursive: true })
      const file = fileOf(id, type)
      await writeFile(`${file}.tmp`, buf)
      await rename(`${file}.tmp`, file)
      return { v: createHash('sha256').update(buf).digest('hex').slice(0, 16), type }
    },
    async remove(id) {
      if (!valid(id)) return
      for (const t of Object.keys(MIME)) await rm(fileOf(id, t), { force: true })
    },
    async read(id) {
      if (!valid(id)) return null
      for (const t of Object.keys(MIME)) {
        const f = fileOf(id, t)
        if (existsSync(f)) return { buf: await readFile(f), type: t }
      }
      return null
    }
  }
}
