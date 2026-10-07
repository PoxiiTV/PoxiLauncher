import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile, open } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import YAML from 'yaml'

// Estructura en disco:
//   DATA_DIR/releases/<versión>/  latest.yml + PoxiLauncher-Setup-x.exe (+ .blockmap, + Portable)
//                                 (instalador web: el Setup es pequeño y descarga el paquete poxilauncher-x-x64.nsis.7z)
//   DATA_DIR/current.json         { "version": "x.y.z" }  ← lo que reciben las apps
//   DATA_DIR/tmp/<uploadId>/      subidas en curso (por trozos)

export const MAX_CHUNK = 50 * 1024 * 1024 // Cloudflare (gratis) corta peticiones de más de 100 MB
const MAX_FILE = 1024 * 1024 * 1024
const MAX_FILES = 6
const SESSION_TTL = 6 * 60 * 60 * 1000

/** Solo nombres de archivo de release: sin rutas, sin trucos. */
export const FILE_RE = /^(latest\.yml|[A-Za-z0-9][A-Za-z0-9 ._-]{0,120}(\.exe(\.blockmap)?|\.nsis\.7z))$/
export const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(-[0-9A-Za-z.]{1,20})?$/

export function createStore(dataDir) {
  const root = resolve(dataDir)
  const releasesDir = join(root, 'releases')
  const tmpDir = join(root, 'tmp')
  const currentFile = join(root, 'current.json')
  // Versiones que se han publicado alguna vez (aunque luego se borren). Nunca se vuelve a publicar una: Cloudflare
  // guarda un año los archivos de cada versión, así que una versión borrada y resubida seguiría sirviendo la vieja
  const publishedFile = join(root, 'published.json')
  let published = new Set()
  const savePublished = async () => {
    await writeFile(publishedFile + '.tmp', JSON.stringify([...published]))
    await rename(publishedFile + '.tmp', publishedFile)
  }

  const init = async () => {
    await mkdir(releasesDir, { recursive: true })
    await mkdir(tmpDir, { recursive: true })
    await cleanupStaleUploads()
    try {
      published = new Set(JSON.parse(await readFile(publishedFile, 'utf8')))
    } catch {
      published = new Set()
    }
    // Las que ya están en disco también cuentan
    for (const v of await readdir(releasesDir).catch(() => [])) if (VERSION_RE.test(v)) published.add(v)
    await savePublished()
  }

  async function currentVersion() {
    try {
      return JSON.parse(await readFile(currentFile, 'utf8')).version ?? null
    } catch {
      return null
    }
  }

  async function setCurrent(version) {
    if (!VERSION_RE.test(version) || !existsSync(join(releasesDir, version, 'latest.yml'))) return false
    await writeFile(currentFile + '.tmp', JSON.stringify({ version }))
    await rename(currentFile + '.tmp', currentFile)
    return true
  }

  async function list() {
    const current = await currentVersion()
    const out = []
    for (const v of await readdir(releasesDir).catch(() => [])) {
      if (!VERSION_RE.test(v)) continue
      const dir = join(releasesDir, v)
      const files = []
      for (const f of await readdir(dir)) files.push({ name: f, size: (await stat(join(dir, f))).size })
      out.push({ version: v, date: (await stat(join(dir, 'latest.yml'))).mtimeMs, files, current: v === current })
    }
    return out.sort((a, b) => compareVersions(b.version, a.version))
  }

  async function remove(version) {
    if (!VERSION_RE.test(version) || version === (await currentVersion())) return false
    await rm(join(releasesDir, version), { recursive: true, force: true })
    return true
  }

  /** Archivo para /updates: latest.yml de la versión actual, o cualquier archivo de cualquier versión
   *  (la actualización diferencial pide también el .blockmap de la versión que tiene instalada el usuario). */
  async function resolveFile(name) {
    if (!FILE_RE.test(name)) return null
    if (name === 'latest.yml') {
      const v = await currentVersion()
      return v ? join(releasesDir, v, 'latest.yml') : null
    }
    for (const r of await list()) {
      const p = join(releasesDir, r.version, name)
      if (existsSync(p)) return p
    }
    return null
  }

  // ——— Subidas por trozos ———

  async function startUpload() {
    const id = randomUUID()
    await mkdir(join(tmpDir, id))
    return id
  }

  const sessionDir = (id) => (/^[0-9a-f-]{36}$/.test(id) ? join(tmpDir, id) : null)

  /** Escribe un trozo en su posición. Devuelve el tamaño actual del archivo. */
  async function writeChunk(id, name, offset, chunk) {
    const dir = sessionDir(id)
    if (!dir || !existsSync(dir)) throw httpError(404, 'Subida no encontrada')
    if (!FILE_RE.test(name)) throw httpError(400, 'Nombre de archivo no permitido')
    const files = await readdir(dir)
    if (!files.includes(name) && files.length >= MAX_FILES) throw httpError(400, 'Demasiados archivos')
    const path = join(dir, name)
    const size = existsSync(path) ? (await stat(path)).size : 0
    // Solo se permite continuar donde se quedó (o repetir el último trozo si se perdió la respuesta)
    if (offset > size) throw httpError(409, `Falta un trozo: el archivo va por ${size}`)
    if (offset + chunk.length > MAX_FILE) throw httpError(413, 'Archivo demasiado grande')
    const fh = await open(path, existsSync(path) ? 'r+' : 'w')
    try {
      await fh.write(chunk, 0, chunk.length, offset)
      await fh.truncate(offset + chunk.length)
    } finally {
      await fh.close()
    }
    return offset + chunk.length
  }

  async function cancelUpload(id) {
    const dir = sessionDir(id)
    if (dir) await rm(dir, { recursive: true, force: true })
  }

  /** Valida la subida (latest.yml + instalador con la misma huella) y la publica. */
  async function finishUpload(id, makeCurrent) {
    const dir = sessionDir(id)
    if (!dir || !existsSync(dir)) throw httpError(404, 'Subida no encontrada')
    const info = await validateRelease(dir)
    const target = join(releasesDir, info.version)
    if (existsSync(target) || published.has(info.version))
      throw httpError(409, `La versión ${info.version} ya se publicó alguna vez: sube el número de versión`)
    await rename(dir, target)
    published.add(info.version)
    await savePublished()
    if (makeCurrent) await setCurrent(info.version)
    return info
  }

  async function cleanupStaleUploads() {
    for (const d of await readdir(tmpDir).catch(() => [])) {
      const s = await stat(join(tmpDir, d)).catch(() => null)
      if (s && Date.now() - s.mtimeMs > SESSION_TTL) await rm(join(tmpDir, d), { recursive: true, force: true })
    }
  }

  return { init, list, currentVersion, setCurrent, remove, resolveFile, startUpload, writeChunk, cancelUpload, finishUpload, cleanupStaleUploads }
}

export function compareVersions(a, b) {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
  return 0
}

export function sha512Base64(path) {
  return new Promise((res, rej) => {
    const h = createHash('sha512')
    createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('error', rej)
      .on('end', () => res(h.digest('base64')))
  })
}

/**
 * Comprueba que la carpeta es una release válida de electron-builder:
 * latest.yml con versión, y cada archivo que declara existe con el mismo tamaño y SHA-512.
 */
export async function validateRelease(dir) {
  const files = await readdir(dir)
  if (!files.includes('latest.yml')) throw httpError(400, 'Falta latest.yml')
  let doc
  try {
    doc = YAML.parse(await readFile(join(dir, 'latest.yml'), 'utf8'))
  } catch {
    throw httpError(400, 'latest.yml no es válido')
  }
  const version = String(doc?.version ?? '')
  if (!VERSION_RE.test(version)) throw httpError(400, 'latest.yml no tiene una versión válida')
  const declared = Array.isArray(doc.files) && doc.files.length ? [...doc.files] : [{ url: doc.path, sha512: doc.sha512 }]
  // Instalador web: el paquete que descarga también tiene que haber llegado entero
  for (const p of Object.values(doc.packages ?? {})) declared.push({ url: p?.path ?? p?.file, sha512: p?.sha512, size: p?.size })
  for (const f of declared) {
    const name = String(f?.url ?? '')
    if (!FILE_RE.test(name) || !files.includes(name)) throw httpError(400, `Falta el archivo ${name || '(sin nombre)'}`)
    const path = join(dir, name)
    if (f.size && (await stat(path)).size !== Number(f.size)) throw httpError(400, `${name}: el tamaño no coincide (subida incompleta)`)
    if ((await sha512Base64(path)) !== f.sha512) throw httpError(400, `${name}: la huella SHA-512 no coincide (archivo corrupto)`)
  }
  return { version, files }
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status, expose: true })
}
