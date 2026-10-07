import { app, BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { autoUpdater } from 'electron-updater'
import { isNewer } from '@shared/version'
import { getSettings, onSettingsChange } from '../settings'
import { emit } from '../events'

export const iconPath = (): string =>
  app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'resources', 'icon.png')


// ——— Cierre: cerrar es cerrar (sin bandeja) ———

let quitting = false
export const markQuitting = (): void => {
  quitting = true
}

export function quitNow(): void {
  quitting = true
  app.quit()
}

// ——— Arrancar con Windows ———
// El inicio de sesión normal de Windows (la app no pide administrador). Empieza minimizada (--hidden)

export function applyAutostart(enabled: boolean): void {
  if (!app.isPackaged) return
  const path = process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath
  app.setLoginItemSettings({ openAtLogin: enabled, path, args: ['--hidden'] })
}

// ——— Mientras juegas: la app se aparta y, al cerrar el juego, vuelve ———
let hidden = false

export function hideWhilePlaying(): void {
  if (!getSettings().minimizeWhilePlaying) return
  BrowserWindow.getAllWindows().forEach((w) => w.minimize())
  hidden = true
}

/** Solo si la apartamos nosotros y sigue minimizada (si ya la abriste tú, no se toca) */
export function showAfterPlaying(): void {
  if (!hidden) return
  hidden = false
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isMinimized()) continue
    w.restore()
    w.focus()
  }
}

// ——— Actualizaciones de la app (servidor propio) ———
// Al abrir, la interfaz pregunta si hay versión nueva y, si el usuario acepta:
//  · instalada → electron-updater descarga el instalador y reinicia;
//  · portable  → se instala la app en el PC con el instalador de la versión nueva (ver installFromPortable).

const UPDATE_URL = import.meta.env.MAIN_VITE_UPDATE_URL as string | undefined
/** Archivo del servidor de actualizaciones (con new URL y sin "/" final, "latest.yml" se saldría de /updates) */
const updateFile = (name: string): URL => new URL(name, `${UPDATE_URL!.replace(/\/+$/, '')}/`)
const PORTABLE_FILE = process.env.PORTABLE_EXECUTABLE_FILE
let available: string | null = null
let installing = false

export function setupUpdater(): void {
  if (!app.isPackaged || !UPDATE_URL || PORTABLE_FILE) return
  autoUpdater.setFeedURL({ provider: 'generic', url: UPDATE_URL })
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.on('download-progress', (p) =>
    emit('update', { state: 'downloading', version: available ?? '', progress: p.percent / 100 })
  )
  autoUpdater.on('update-downloaded', () => {
    markQuitting()
    autoUpdater.quitAndInstall(false, true)
  })
  autoUpdater.on('error', (e) => {
    console.error('updater:', e.message)
    if (installing) emit('update', { state: 'error', version: available ?? '', progress: 0 })
    installing = false
  })
}

/** Lee la versión publicada en latest.yml (vale igual para instalada y portable). */
export async function checkUpdate(): Promise<{ available: boolean; version?: string }> {
  // Solo pruebas: simular que hay versión nueva para ver la ventana
  if (!app.isPackaged && process.env.POXI_FAKE_UPDATE) return { available: true, version: process.env.POXI_FAKE_UPDATE }
  if (!app.isPackaged || !UPDATE_URL) return { available: false }
  const res = await fetch(updateFile('latest.yml'), { signal: AbortSignal.timeout(10_000), cache: 'no-store' })
  if (!res.ok) return { available: false }
  const version = /^version:\s*['"]?([\d.]+)/m.exec(await res.text())?.[1]
  if (!version || !isNewer(version, app.getVersion())) return { available: false }
  available = version
  return { available: true, version }
}

export async function installUpdate(): Promise<void> {
  if (!available || installing || !UPDATE_URL) return
  installing = true
  const version = available
  try {
    if (PORTABLE_FILE) {
      let last = 0
      await installFromPortable(version, (progress) => {
        if (Date.now() - last < 250) return
        last = Date.now()
        emit('update', { state: 'downloading', version, progress })
      })
      markQuitting()
      app.quit()
      return
    }
    await autoUpdater.checkForUpdates()
    await autoUpdater.downloadUpdate()
  } catch (e) {
    console.error('update:', (e as Error).message)
    emit('update', { state: 'error', version, progress: 0 })
    installing = false
  }
}

/**
 * Instala la app en el PC desde el portable: baja el instalador pequeño de esa versión y lo abre en modo
 * actualización (sin preguntas: solo su progreso y, al terminar, abre la app instalada). Así queda en el menú Inicio
 * y se actualiza sola como la instalada. Quien llama cierra esta copia.
 */
export async function installFromPortable(version: string, onProgress?: (p: number) => void): Promise<void> {
  if (!UPDATE_URL) throw new Error('Sin servidor de actualizaciones')
  const name = `PoxiLauncher-Setup-${version}.exe`
  const target = join(tmpdir(), name)
  const tmp = `${target}.descargando`
  // Si deja de llegar nada durante 60 s, se corta (la ventana pasa a error y se puede cerrar)
  const abort = new AbortController()
  let idle = setTimeout(() => abort.abort(), 60_000)
  const res = await fetch(updateFile(name), { signal: abort.signal })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 0
  let done = 0
  const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream)
  body.on('data', (c: Buffer) => {
    clearTimeout(idle)
    idle = setTimeout(() => abort.abort(), 60_000)
    done += c.length
    if (total) onProgress?.(done / total)
  })
  try {
    await pipeline(body, createWriteStream(tmp))
    clearTimeout(idle)
    await rename(tmp, target)
  } catch (e) {
    await rm(tmp, { force: true })
    throw e
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(target, ['--updated'], { detached: true, stdio: 'ignore' })
    child.on('error', reject)
    child.on('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

export function initSystem(): void {
  applyAutostart(getSettings().startWithWindows)
  onSettingsChange((s, patch) => {
    if ('startWithWindows' in patch) applyAutostart(s.startWithWindows)
  })
}
