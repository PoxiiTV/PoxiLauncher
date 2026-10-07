import { readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app, shell } from 'electron'

// La barra de tareas de Windows saca el icono y el nombre de la app del acceso del menú Inicio que lleva su
// mismo identificador (AUMID). Si hay uno que apunta a otro sitio, Windows le hace caso a ese:
//  - Electron crea "Electron.lnk" por su cuenta al mostrar un aviso sin acceso propio (pasó en pruebas).
//  - El portable se ejecuta desde una carpeta temporal que se borra al cerrar: su acceso se queda roto.
// Resultado: la app sale como "Electron" o sin icono. Al arrancar se quitan esos accesos y, en el portable,
// se deja uno bueno que apunta al .exe de verdad (así Electron no vuelve a crear el suyo).

const programsDir = (): string => join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
const same = (a: string, b: string): boolean => resolve(a).toLowerCase() === resolve(b).toLowerCase()

interface Link {
  path: string
  target: string
  aumid?: string
}

/** Qué accesos sobran y si hace falta crear el bueno. Pura, para poder probarla. */
export function planShortcuts(links: Link[], aumid: string, exe: string): { remove: string[]; create: boolean } {
  const ours = links.filter((l) => l.aumid === aumid)
  const remove = ours.filter((l) => !same(l.target, exe)).map((l) => l.path)
  return { remove, create: ours.length === remove.length }
}

export function fixStartMenuShortcuts(aumid: string, exe: string, portable: boolean): void {
  if (process.platform !== 'win32') return
  const dir = programsDir()
  const links: Link[] = []
  try {
    for (const name of readdirSync(dir)) {
      if (!name.toLowerCase().endsWith('.lnk')) continue
      const path = join(dir, name)
      try {
        const l = shell.readShortcutLink(path)
        links.push({ path, target: l.target, aumid: l.appUserModelId })
      } catch {
        /* acceso ilegible: no es nuestro */
      }
    }
  } catch {
    return
  }
  const plan = planShortcuts(links, aumid, exe)
  for (const p of plan.remove) rmSync(p, { force: true })
  // La versión instalada ya tiene el suyo (lo pone el instalador); el portable, el que creamos aquí
  if (portable && plan.create) {
    shell.writeShortcutLink(join(dir, 'PoxiLauncher Portable.lnk'), 'create', {
      target: exe,
      cwd: join(exe, '..'),
      appUserModelId: aumid,
      icon: exe,
      iconIndex: 0,
      description: 'PoxiLauncher'
    })
  }
}
