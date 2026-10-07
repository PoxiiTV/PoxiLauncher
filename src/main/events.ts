import { BrowserWindow } from 'electron'
import type { PushEvent } from '@shared/ipc'

export function emit<K extends keyof PushEvent>(event: K, data: PushEvent[K]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(`push:${event}`, data)
  }
}
