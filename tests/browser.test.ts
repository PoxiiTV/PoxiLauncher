import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Los enlaces se abren siempre con openAsUser (system/browser.ts): el navegador arranca como el usuario aunque la app
// corriera elevada. Abierto como administrador, Chrome resetea el perfil del usuario (se pierden las sesiones).

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []))
/** El código sin comentarios (así la explicación de system/browser.ts no cuenta) */
const code = (f: string): string => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('abrir el navegador', () => {
  it('nunca con shell.openExternal: siempre con openAsUser', () => {
    const bad = files('src').filter((f) => /openExternal\s*\(/.test(code(f)))
    expect(bad).toEqual([])
  })
})
