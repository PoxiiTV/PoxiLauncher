import { contextBridge, ipcRenderer } from 'electron'

// Puente mínimo: la interfaz solo puede invocar canales conocidos y escuchar eventos push.
const CHANNEL = /^(app|account|mc|mods|catalog|settings|downloads|library|saves|steam|system|window|dlss5|launch|fps|journal|party|wrapped|achievements|chat|overlay|capture|drops|month|invite):[a-zA-Z]+$/
const EVENTS = new Set(['catalog', 'catalogStatus', 'downloads', 'library', 'settings', 'playing', 'toast', 'update', 'confirmClose', 'nav', 'account', 'mods', 'modsProgress', 'minecraft', 'minecraftCode', 'minecraftContent', 'minecraftTask', 'minecraftServerLog', 'steam', 'dlss5', 'launchDoctor', 'fps', 'journal', 'achievements', 'chats', 'chatEvent', 'chatToast', 'chatSound', 'chatOpen', 'fpsLive', 'overlay', 'captures', 'clipStatus', 'invite'])

contextBridge.exposeInMainWorld('api', {
  invoke: (channel: string, ...args: unknown[]) => {
    // Rechazo (no excepción): así un canal mal escrito nunca tumba la interfaz
    if (!CHANNEL.test(channel)) return Promise.reject(new Error('Canal no permitido'))
    return ipcRenderer.invoke(channel, ...args)
  },
  on: (event: string, cb: (data: unknown) => void) => {
    if (!EVENTS.has(event)) throw new Error('Evento no permitido')
    const listener = (_e: unknown, data: unknown): void => cb(data)
    ipcRenderer.on(`push:${event}`, listener)
    return () => ipcRenderer.removeListener(`push:${event}`, listener)
  }
})
