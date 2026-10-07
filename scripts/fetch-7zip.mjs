// Descarga 7-Zip (7z.exe + 7z.dll, versión fijada y verificada por SHA-256) a resources/bin.
// Sirve para los zips del motor de Minecraft (packs .mrpack, mundos del grupo y servidores).
// El instalador oficial es un archivo 7z: lo abre el tar.exe de Windows (libarchive), sin ejecutarlo. (Antes se usaba
// 7zr.exe, pero su dirección no lleva versión: cambia con cada 7-Zip nuevo y su huella dejaba de coincidir.)
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const INSTALLER = {
  url: 'https://www.7-zip.org/a/7z2409-x64.exe',
  sha256: 'bdd1a33de78618d16ee4ce148b849932c05d0015491c34887846d431d29f308e'
}
const OUT_DIR = join(import.meta.dirname, '..', 'resources', 'bin')
const TAR = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')

if (existsSync(join(OUT_DIR, '7z.exe')) && existsSync(join(OUT_DIR, '7z.dll'))) {
  console.log('7-Zip ya existe')
  process.exit(0)
}

const tmp = join(tmpdir(), `7zip-${Date.now()}`)
mkdirSync(tmp, { recursive: true })
try {
  const res = await fetch(INSTALLER.url)
  if (!res.ok) throw new Error(`Descarga fallida: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const hash = createHash('sha256').update(buf).digest('hex')
  if (hash !== INSTALLER.sha256) throw new Error(`SHA-256 no coincide: ${hash}`)
  writeFileSync(join(tmp, '7z-x64.exe'), buf)
  execFileSync(TAR, ['-xf', '7z-x64.exe', '7z.exe', '7z.dll'], { cwd: tmp, stdio: 'ignore' })
  mkdirSync(OUT_DIR, { recursive: true })
  for (const n of ['7z.exe', '7z.dll']) copyFileSync(join(tmp, n), join(OUT_DIR, n))
  console.log('7-Zip listo en resources/bin')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
