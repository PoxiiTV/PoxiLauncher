import { BrowserWindow, Notification } from 'electron'
import { translate } from '@shared/i18n'
import { emit } from '../events'
import { getSettings } from '../settings'

/** Aviso dentro de la app y, si la ventana no está a la vista, notificación de Windows. */
export function notify(key: string, params: Record<string, string> = {}, kind: 'info' | 'success' | 'error' = 'info'): void {
  emit('toast', { kind, key, params })
  const s = getSettings()
  const focused = BrowserWindow.getAllWindows().some((w) => w.isVisible() && w.isFocused())
  if (!s.notifications || focused || !Notification.isSupported()) return
  const n = new Notification({ title: 'PoxiLauncher', body: translate(s.lang, key, params), silent: false })
  n.on('click', () => {
    const w = BrowserWindow.getAllWindows()[0]
    if (w) {
      w.show()
      w.focus()
    }
  })
  n.show()
}
