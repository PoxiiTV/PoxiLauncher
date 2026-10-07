// Sube la versión compilada (release\) al servidor de actualizaciones y la publica como actual.
// Uso: node scripts/publish.mjs [--prueba]   (lee MAIN_VITE_UPDATE_URL y POXI_DEPLOY_TOKEN del .env)
// --prueba: la sube sin hacerla la actual (las apps no se actualizan; el instalador pequeño ya funciona con ella)
import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const env = Object.fromEntries(
  readFileSync(join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')])
)
const updates = process.env.MAIN_VITE_UPDATE_URL ?? env.MAIN_VITE_UPDATE_URL
const token = process.env.POXI_DEPLOY_TOKEN ?? env.POXI_DEPLOY_TOKEN
if (!updates || !token) {
  console.error('Faltan MAIN_VITE_UPDATE_URL o POXI_DEPLOY_TOKEN en .env')
  process.exit(1)
}
// .../updates/ → base del servidor
const base = updates.replace(/\/updates\/?$/, '')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const release = join(root, 'release')
const test = process.argv.includes('--prueba')
// El instalador (pequeño) y el paquete que descarga están en release\nsis-web; el portable, en release\
const web = join(release, 'nsis-web')
const files = [
  { name: 'latest.yml', path: join(web, 'latest.yml') },
  { name: `PoxiLauncher-Setup-${version}.exe`, path: join(web, `PoxiLauncher-Setup-${version}.exe`) },
  { name: `poxilauncher-${version}-x64.nsis.7z`, path: join(web, `poxilauncher-${version}-x64.nsis.7z`) },
  { name: `PoxiLauncher-Portable-${version}.exe`, path: join(release, `PoxiLauncher-Portable-${version}.exe`) }
].filter((f) => existsSync(f.path))

// El instalador pequeño lleva dentro la dirección de su paquete: la de "publish" + "/" + nombre (la misma que queda en
// app-update.yml). Si esa dirección termina en "/", pide ".../updates//paquete" y falla (pasó con la 3.0.0).
const builtUrl = /^url:\s*(\S+)/m.exec(readFileSync(join(release, 'win-unpacked', 'resources', 'app-update.yml'), 'utf8'))?.[1] ?? ''
if (!builtUrl || builtUrl.endsWith('/')) {
  console.error(`❌ La versión se compiló con la dirección "${builtUrl}" (termina en "/"): el instalador pediría el paquete con doble barra.`)
  console.error('   Quita la barra final de MAIN_VITE_UPDATE_URL en .env y vuelve a compilar.')
  process.exit(1)
}
if (files.length < 3 || !files.some((f) => f.name.endsWith('.nsis.7z'))) {
  console.error(`No encuentro la build ${version} en release\\. Ejecuta primero build.bat`)
  process.exit(1)
}
if (!readFileSync(join(web, 'latest.yml'), 'utf8').includes(`version: ${version}`)) {
  console.error(`release\\nsis-web\\latest.yml no es de la versión ${version}. Vuelve a ejecutar build.bat`)
  process.exit(1)
}

const CHUNK = 32 * 1024 * 1024 // Cloudflare corta peticiones de más de 100 MB
const auth = { Authorization: `Bearer ${token}` }

async function call(path, init = {}) {
  const res = await fetch(`${base}/api${path}`, { ...init, headers: { ...auth, ...(init.headers ?? {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
  return data
}

// El servidor se niega a publicar un número de versión que ya se usó (Cloudflare guarda un año sus archivos). Aquí no
// se pregunta antes a Cloudflare: un "no existe" suyo se quedaría en caché y rompería la descarga recién publicada
await publish()

async function publish() {
  console.log(`${test ? 'Subiendo para probar' : 'Publicando'} PoxiLauncher ${version} en ${base}`)
  const { id } = await call('/uploads', { method: 'POST' })
  try {
    for (const f of files) {
      const size = statSync(f.path).size
      const fd = openSync(f.path, 'r')
      try {
        for (let offset = 0; offset < size; offset += CHUNK) {
          const buf = Buffer.alloc(Math.min(CHUNK, size - offset))
          readSync(fd, buf, 0, buf.length, offset)
          for (let attempt = 1; ; attempt++) {
            try {
              await call(`/uploads/${id}/files/${encodeURIComponent(f.name)}?offset=${offset}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: buf
              })
              break
            } catch (e) {
              if (attempt >= 3) throw e
              await new Promise((r) => setTimeout(r, 2000 * attempt))
            }
          }
          process.stdout.write(`\r  ${f.name}: ${Math.min(100, Math.round(((offset + buf.length) / size) * 100))}%   `)
        }
        process.stdout.write('\n')
      } finally {
        closeSync(fd)
      }
    }
    console.log('  Comprobando la huella en el servidor…')
    const r = await call(`/uploads/${id}/finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ makeCurrent: !test })
    })
    // Prueba final por Cloudflare con la dirección EXACTA que usa el instalador (solo ahora, ya subido: un 404
    // antes de subirlo se quedaría horas en la caché de Cloudflare)
    const pkg = files.find((f) => f.name.endsWith('.nsis.7z')).name
    const check = await fetch(`${builtUrl}/${pkg}`, { headers: { Range: 'bytes=0-0' } }).catch(() => null)
    if (!check || (check.status !== 206 && check.status !== 200)) {
      console.error(`❌ El instalador no puede bajar su paquete: ${builtUrl}/${pkg} → ${check?.status ?? 'sin respuesta'}`)
      process.exit(1)
    }
    console.log(`  El instalador baja su paquete: OK (${check.status})`)
    console.log(
      test
        ? `✅ Versión ${r.version} subida para probar (no es la actual: nadie se actualiza). Hazla la actual desde el panel o con publish.bat.`
        : `✅ Versión ${r.version} publicada: las apps se actualizarán solas.`
    )
  } catch (e) {
    await call(`/uploads/${id}`, { method: 'DELETE' }).catch(() => undefined)
    console.error(`❌ ${e.message}`)
    process.exit(1)
  }
}
