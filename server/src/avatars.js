import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// Fotos de perfil. Solo se aceptan WebP pequeños y quietos (la app recorta y convierte cualquier foto a WebP de
// 256×256 antes de subirla), comprobados por su cabecera real: nunca se fía del tipo que diga la petición. Cada
// foto se guarda con el id de su cuenta (lo genera el servidor: el usuario no elige nombres ni rutas).

export const MAX_BYTES = 150 * 1024
const MIN_SIDE = 32
const MAX_SIDE = 512

const le16 = (b, o) => b[o] | (b[o + 1] << 8)
const le24 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)
const tag = (b, o) => b.toString('ascii', o, o + 4)

/** Medidas de un WebP válido y sin animación, o null si no lo es (pura, testeable) */
export function webpSize(b) {
  if (!Buffer.isBuffer(b) || b.length < 30 || b.length > MAX_BYTES) return null
  if (tag(b, 0) !== 'RIFF' || tag(b, 8) !== 'WEBP') return null
  // El tamaño que declara el archivo tiene que ser el real (nada escondido detrás)
  if (b.readUInt32LE(4) + 8 !== b.length) return null
  let w
  let h
  const chunk = tag(b, 12)
  if (chunk === 'VP8 ') {
    // Fotograma clave con su código de inicio
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null
    w = le16(b, 26) & 0x3fff
    h = le16(b, 28) & 0x3fff
  } else if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null
    w = 1 + (((b[22] & 0x3f) << 8) | b[21])
    h = 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6))
  } else if (chunk === 'VP8X') {
    // Sin animación (bit 1 de las opciones)
    if (b[20] & 0x02) return null
    w = 1 + le24(b, 24)
    h = 1 + le24(b, 27)
  } else return null
  if (w < MIN_SIDE || h < MIN_SIDE || w > MAX_SIDE || h > MAX_SIDE) return null
  return { w, h }
}

export function createAvatars(dataDir) {
  const dir = join(dataDir, 'avatars')
  // Los ids de cuenta son UUID: así el nombre del archivo nunca puede salirse de la carpeta
  const fileOf = (id) => (/^[0-9a-f-]{36}$/.test(id) ? join(dir, `${id}.webp`) : null)

  return {
    /** Guarda la foto de una cuenta. Devuelve su versión (huella corta) o null si la imagen no vale. */
    async save(id, buf) {
      const file = fileOf(id)
      if (!file || !webpSize(buf)) return null
      await mkdir(dir, { recursive: true })
      await writeFile(`${file}.tmp`, buf)
      await rename(`${file}.tmp`, file)
      return createHash('sha256').update(buf).digest('hex').slice(0, 16)
    },
    async remove(id) {
      const file = fileOf(id)
      if (file) await rm(file, { force: true })
    },
    /** Contenido de la foto (solo si existe) */
    async read(id) {
      const file = fileOf(id)
      return file && existsSync(file) ? readFile(file) : null
    }
  }
}
