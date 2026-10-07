import { spawn } from 'node:child_process'

// Abrir una web (o un enlace steam://) con los permisos normales del usuario. Si la app corriera como administrador,
// shell.openExternal abriría el navegador también como administrador: Chrome, abierto así, no puede leer sus datos
// cifrados y resetea el perfil (cierra las sesiones de Google y borra ajustes). Por eso la orden se le pasa al
// Explorador de Windows que ya está abierto (el del usuario, sin administrador), y es él quien lo abre.
// NUNCA usar shell.openExternal: hay un test que lo impide (tests/browser.test.ts).

const ALLOWED = new Set(['https:', 'steam:'])

export function openAsUser(url: string): void {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return
  }
  if (!ALLOWED.has(u.protocol)) return
  spawn('explorer.exe', [u.href], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
}
