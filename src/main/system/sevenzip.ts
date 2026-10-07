import { app } from 'electron'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

// 7-Zip incluido con la app (resources/bin): extraer juegos, códigos de perfil de mods, copias de mundos y modpacks.

export const sevenZip = (): string =>
  app.isPackaged ? join(process.resourcesPath, 'bin', '7z.exe') : join(app.getAppPath(), 'resources', 'bin', '7z.exe')

/** Ejecuta 7-Zip y dice si ha terminado bien */
export const run7z = (args: string[], cwd: string): Promise<boolean> =>
  new Promise((res) => {
    const c = spawn(sevenZip(), args, { cwd, windowsHide: true, stdio: 'ignore' })
    c.on('exit', (code) => res(code === 0))
    c.on('error', () => res(false))
  })
