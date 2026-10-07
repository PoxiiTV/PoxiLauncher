import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { imageType } from './banners.js'

// Stickers subidos por cada cuenta: hasta 30 imágenes o GIFs de 512 KB. El tipo sale de la cabecera real del archivo,
// el nombre es su huella (el usuario no elige rutas) y subir el mismo dos veces no lo duplica.

export const MAX_STICKER = 512 * 1024
export const MAX_STICKERS = 30

export function createStickers(dataDir) {
  const root = join(dataDir, 'stickers')
  const validOwner = (id) => /^[0-9a-f-]{36}$/.test(id)
  const validId = (id) => /^[0-9a-f]{16}$/.test(id)
  const dirOf = (owner) => join(root, owner)
  const types = ['gif', 'png', 'jpg', 'webp']

  /** Los suyos, del más nuevo al más viejo: [{ id, type }] */
  async function list(owner) {
    if (!validOwner(owner)) return []
    const files = await readdir(dirOf(owner)).catch(() => [])
    const out = []
    for (const f of files) {
      const m = /^([0-9a-f]{16})\.(gif|png|jpg|webp)$/.exec(f)
      if (m) out.push({ id: m[1], type: m[2], at: (await stat(join(dirOf(owner), f)).catch(() => null))?.mtimeMs ?? 0 })
    }
    return out.sort((a, b) => b.at - a.at).map(({ id, type }) => ({ id, type }))
  }

  return {
    list: async (owner) => (await list(owner)).map((s) => s.id),

    /** Guarda uno: { id } o { error } */
    async save(owner, buf) {
      if (!validOwner(owner) || !Buffer.isBuffer(buf) || buf.length > MAX_STICKER) return { error: 'Máximo 512 KB' }
      const type = imageType(buf)
      if (!type) return { error: 'Imagen no válida' }
      const id = createHash('sha256').update(buf).digest('hex').slice(0, 16)
      const mine = await list(owner)
      if (mine.some((s) => s.id === id)) return { id }
      if (mine.length >= MAX_STICKERS) return { error: `Máximo ${MAX_STICKERS} stickers`, status: 409 }
      await mkdir(dirOf(owner), { recursive: true })
      const file = join(dirOf(owner), `${id}.${type}`)
      await writeFile(`${file}.tmp`, buf)
      await rename(`${file}.tmp`, file)
      return { id }
    },

    async remove(owner, id) {
      if (!validOwner(owner) || !validId(id)) return
      for (const t of types) await rm(join(dirOf(owner), `${id}.${t}`), { force: true })
    },

    async exists(owner, id) {
      return validOwner(owner) && validId(id) && (await list(owner)).some((s) => s.id === id)
    },

    async read(owner, id) {
      if (!validOwner(owner) || !validId(id)) return null
      for (const t of types) {
        const buf = await readFile(join(dirOf(owner), `${id}.${t}`)).catch(() => null)
        if (buf) return { buf, type: t }
      }
      return null
    },

    /** Al borrar la cuenta se van todos */
    forget: (owner) => (validOwner(owner) ? rm(dirOf(owner), { recursive: true, force: true }) : undefined)
  }
}
