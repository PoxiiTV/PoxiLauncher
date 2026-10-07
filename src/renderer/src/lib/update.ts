import { invoke } from '../api'
import { getState, setState } from '../store'

// Aviso de versión nueva: al abrir la app y luego cada 10 min con ella abierta (sin tener que reiniciar).

/** Cada cuánto se pregunta al servidor si hay versión nueva con la app abierta */
export const UPDATE_EVERY_MS = 10 * 60_000
/** Versión de la que ya salió el aviso en esta sesión («Más tarde» no vuelve a sacarlo hasta otra versión) */
let shownUpdate = ''

/** Si hay versión nueva, sale el aviso; nunca mientras juegas (se vuelve a mirar en la siguiente vuelta) */
export async function offerUpdate(): Promise<void> {
  if (getState().mc?.running || getState().update) return
  const u = await invoke('system:checkUpdate').catch(() => null)
  if (!u?.available || !u.version || u.version === shownUpdate || getState().mc?.running || getState().update) return
  shownUpdate = u.version
  setState({ update: { state: 'available', version: u.version, progress: 0 } })
}
