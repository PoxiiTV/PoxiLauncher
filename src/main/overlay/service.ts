// El menú de PoxiLauncher dentro del juego (como el Shift+Tab de Steam, con su propio atajo): una ventana transparente
// encima del juego con amigos, chat, rendimiento, logros y diario. Es la misma interfaz de la app, abierta en «modo
// menú» (?overlay), así que todo (sesión, chat, ajustes) va igual que en la ventana principal.
// En pantalla completa exclusiva Windows no deja poner nada encima (el juego se minimiza al perder el foco): entonces
// PoxiLauncher pasa el juego a ventana sin bordes (Alt+Intro y estirarlo a toda la pantalla) y abre el menú encima. Nada
// se mete dentro del juego (eso es lo que hace saltar a los anti-cheats y a los antivirus).
import { app, BrowserWindow, globalShortcut, screen } from 'electron'
import { appendFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { OVERLAY_HOTKEY } from '@shared/hotkey'
import type { OverlayInfo } from '@shared/types'
import { emit } from '../events'
import { getSettings, onSettingsChange } from '../settings'
import { notify } from '../system/notify'
import { mcPlaying, onMcPlaying } from '../minecraft/service'
import { dataPath } from '../store'
import { altEnter, bringBack, exclusiveNow, foreground, isMinimized, makeBorderless, startWin32, stopWin32, windowInfo } from './win32'

/** Registro de lo que hace el menú con el juego (userData/overlay.log): para saber por qué un juego no se deja */
function trace(msg: string): void {
  try {
    const file = dataPath('overlay.log')
    // Que no crezca sin fin
    let big = false
    try {
      big = statSync(file).size > 256 * 1024
    } catch {
      /* aún no existe */
    }
    const line = `${new Date().toISOString()} ${msg}\n`
    if (big) writeFileSync(file, line)
    else appendFileSync(file, line)
  } catch {
    /* sin disco: no pasa nada */
  }
}

/** Pruebas: la ventana se abre fuera de la pantalla (no molesta a quien usa el PC) */
const smoke = !app.isPackaged && !!process.env.POXI_SMOKE

let win: BrowserWindow | null = null
let open = false
let registered: string | null = null
/** Cuándo empezó la partida de ahora (para «llevas 1 h 20 min») */
let startedAt = 0
/** Enseñar la ventana en cuanto la interfaz haya pintado (ver `setOpen`) */
let reveal: (() => void) | null = null
/** Juegos de esta partida que van en pantalla completa exclusiva (ya pasados a sin bordes) o que no dejan hacerlo */
const fullscreenMode = new Map<string, 'borderless' | 'stuck'>()
/** Abriendo el menú (pasando el juego a sin bordes): no se abre dos veces */
let opening = false

export const overlayOpen = (): boolean => open

/** La instancia de Minecraft a la que se está jugando ahora */
export function overlayInfo(): OverlayInfo {
  const mc = mcPlaying()
  const game = mc ? { kind: 'mc' as const, id: null, name: mc.name } : null
  return { game, startedAt: game ? startedAt : 0, hotkey: getSettings().overlayHotkey || OVERLAY_HOTKEY }
}

const playingSomething = (): boolean => !!mcPlaying()

// ——— La ventana ———
function create(): BrowserWindow {
  const w = new BrowserWindow({
    show: false,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    // Aquí sí coge el teclado: para escribir en el chat
    focusable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  w.setAlwaysOnTop(true, 'screen-saver')
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  // Si pierde el foco (clic en el juego, Alt+Tab), se cierra como el de Steam
  w.on('blur', () => {
    // (en las pruebas la ventana está fuera de la pantalla y no tiene el foco)
    if (!smoke) setOpen(false)
  })
  w.on('closed', () => {
    if (win === w) win = null
    open = false
  })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void w.loadURL(`${process.env.ELECTRON_RENDERER_URL}?overlay=1`)
  else void w.loadFile(join(__dirname, '../renderer/index.html'), { query: { overlay: '1' } })
  return w
}

function place(w: BrowserWindow): void {
  // La pantalla del juego: donde está el ratón (en pleno juego, casi siempre la del juego)
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const b = d.bounds
  w.setBounds(smoke ? { x: -6000, y: -6000, width: b.width, height: b.height } : b)
}

function setOpen(v: boolean): void {
  if (v === open && (!v || win)) return
  if (!v) {
    open = false
    if (win && !win.isDestroyed()) {
      emit('overlay', { open: false })
      win.hide()
    }
    return
  }
  win ??= create()
  const w = win
  place(w)
  open = true
  const show = (): void => {
    if (w.isDestroyed() || !open) return
    // Se enseña cuando la interfaz ya ha pintado el menú de ahora (si no, Windows enseña un instante la imagen de la
    // vez anterior y se ve un parpadeo). Si tarda (primera vez), se enseña igual
    let done = false
    reveal = () => {
      if (done) return
      done = true
      reveal = null
      if (!w.isDestroyed() && open) visible(w)
    }
    emit('overlay', { open: true, info: overlayInfo() })
    setTimeout(() => reveal?.(), 700)
  }
  // La primera vez hay que esperar a que cargue la interfaz
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', show)
  else show()
}

/** La interfaz del menú avisa de que ya ha pintado: ahora sí se enseña */
export const overlayReady = (): void => reveal?.()

function visible(w: BrowserWindow): void {
  w.show()
  w.moveTop()
  w.focus()
  // Pruebas: cómo se ve, junto a las capturas de la prueba (la ventana está fuera de la pantalla)
  if (smoke) {
    const dir = (process.env.POXI_SMOKE ?? '').split(';')[0]
    let n = 0
    const shot = (): void =>
      void w.webContents
        .capturePage()
        .then((img) => writeFileSync(join(dir, `overlay-${++n}.png`), img.toPNG()))
        .catch(() => undefined)
    for (const ms of [2500, 6000, 10000]) setTimeout(() => !w.isDestroyed() && shot(), ms)
  }
}

export function toggleOverlay(): void {
  if (open) return setOpen(false)
  if (opening || (!playingSomething() && !smoke)) return
  if (smoke) return setOpen(true)
  opening = true
  void openOverGame()
    .catch((e) => {
      console.error('[menú en el juego]', e)
      setOpen(true)
    })
    .finally(() => (opening = false))
}
export const closeOverlay = (): void => setOpen(false)

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
/** ¿Se minimiza el juego? Hay juegos que tardan: se mira durante 2 s */
async function minimizesSoon(hwnd: string): Promise<boolean> {
  for (let t = 0; t < 2000; t += 200) {
    await sleep(200)
    if (await isMinimized(hwnd)) return true
  }
  return false
}

/** Abre el menú encima del juego. Si el juego va en pantalla completa exclusiva, antes lo pasa a sin bordes */
async function openOverGame(): Promise<void> {
  const fg = await foreground()
  const key = 'mc'
  trace(`atajo · juego ${key} (${overlayInfo().game?.name ?? '?'}) · delante ${fg ? `${fg.hwnd} ${await windowInfo(fg.hwnd)}` : 'sin ayudante'} · modo ${fullscreenMode.get(key) ?? 'desconocido'}`)
  // En ventana o sin bordes (o el ayudante no contesta): se abre y ya
  if (!fg?.full) return setOpen(true)
  if (fullscreenMode.get(key) === 'stuck') return void notify('overlay.exclusive', { key: overlayInfo().hotkey })
  if (fullscreenMode.get(key) === 'borderless' || (await exclusiveNow())) return toBorderless(fg.hwnd, key)
  // No se sabe: se abre y, si el juego se minimiza, es que iba en exclusiva
  setOpen(true)
  const minimized = await minimizesSoon(fg.hwnd)
  trace(`menú abierto · el juego ${minimized ? 'se ha minimizado' : 'sigue a la vista'} · ${await windowInfo(fg.hwnd)}`)
  // (al minimizarse, Windows puede quitarle el foco al menú y cerrarlo: se sigue igual, nunca se deja el juego así)
  if (minimized) {
    setOpen(false)
    await toBorderless(fg.hwnd, key)
  }
}

/** Pantalla completa exclusiva → ventana sin bordes a toda la pantalla (Alt+Intro), y el menú encima */
async function toBorderless(hwnd: string, key: string): Promise<void> {
  await altEnter(hwnd)
  await sleep(1500)
  trace(`tras Alt+Intro · ${await windowInfo(hwnd)}`)
  // No ha hecho caso de Alt+Intro: se deja el juego como estaba y se avisa
  if (await exclusiveNow()) return stuck(hwnd, key)
  await makeBorderless(hwnd)
  await sleep(400)
  trace(`sin bordes · ${await windowInfo(hwnd)}`)
  fullscreenMode.set(key, 'borderless')
  setOpen(true)
  const minimized = await minimizesSoon(hwnd)
  trace(`menú abierto otra vez · el juego ${minimized ? 'se ha vuelto a minimizar' : 'sigue a la vista'}`)
  // Se ha vuelto a minimizar: este juego no se deja (se le devuelve la pantalla y se avisa)
  if (minimized) {
    setOpen(false)
    stuck(hwnd, key)
  }
}

function stuck(hwnd: string, key: string): void {
  trace('este juego no se deja: se deja como estaba y se avisa')
  fullscreenMode.set(key, 'stuck')
  void bringBack(hwnd)
  notify('overlay.exclusive', { key: overlayInfo().hotkey })
}

// ——— El atajo (solo mientras juegas) ———
function register(): void {
  unregister()
  const key = getSettings().overlayHotkey || OVERLAY_HOTKEY
  if (globalShortcut.register(key, toggleOverlay)) registered = key
  // Otro programa ya tiene esa combinación: se dice para que se cambie en Ajustes
  else notify('overlay.taken', { key }, 'error')
}
function unregister(): void {
  if (registered) globalShortcut.unregister(registered)
  registered = null
}

// Empieza o acaba una partida: atajo, vigilancia de pantalla completa y la ventana (se cierra y se libera al acabar)
function onPlaying(): void {
  if (playingSomething()) {
    if (!startedAt) startedAt = Date.now()
    register()
    if (!smoke) startWin32()
    // Se prepara (oculto) a los 10 s de empezar: así se abre al instante. Oculto no se dibuja encima del juego
    setTimeout(() => {
      if (playingSomething() && !win) win = create()
    }, 10_000)
  } else {
    startedAt = 0
    unregister()
    stopWin32()
    fullscreenMode.clear()
    open = false
    if (win && !win.isDestroyed()) win.destroy()
    win = null
  }
}
onMcPlaying(onPlaying)
onSettingsChange((_s, patch) => {
  if ('overlayHotkey' in patch && registered) register()
})
app.on('will-quit', () => {
  unregister()
  stopWin32()
})
