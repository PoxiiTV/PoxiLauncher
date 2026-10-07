import { enableSecureDns } from './net'
import { emit } from './events'
import { fixStartMenuShortcuts } from './system/shortcuts'
import { app, BrowserWindow, protocol, screen } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { isNewer } from '@shared/version'
import { startPresence } from './system/presence'
import { startAccount } from './account/service'
import { iconPath, initSystem, installFromPortable, markQuitting, setupUpdater } from './system'
import { hostingActive, stopAllHosting } from './minecraft/hosting'
import { serveBanner } from './account/service'
import { serveSticker } from './chat/service'
import { serveCaptureThumb, serveMedia } from './capture/share'
import { inviteFromArgv, registerProtocol } from './invites'

protocol.registerSchemesAsPrivileged([
  // stream: los clips del chat se van viendo por trozos (Range) sin bajarlos enteros
  { scheme: 'poxi-img', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

// Solo desarrollo: carpeta de datos aislada y capturas automáticas para pruebas
if (!app.isPackaged && process.env.POXI_USERDATA) app.setPath('userData', process.env.POXI_USERDATA)
// Solo pruebas: simular otra versión (para probar que la más nueva sustituye a la vieja)
if (!app.isPackaged && process.env.POXI_FAKE_VERSION)
  (app as unknown as { setVersion: (v: string) => void }).setVersion(process.env.POXI_FAKE_VERSION)

let mainWindow: BrowserWindow | null = null
const PORTABLE_EXE = process.env.PORTABLE_EXECUTABLE_FILE
const smokeMode = !app.isPackaged && !!process.env.POXI_SMOKE
// Pruebas: la ventana se abre fuera de la pantalla (no molesta a quien usa el PC) y se sigue pintando igual
if (smokeMode) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
// Arranque con Windows: empieza minimizada
const startHidden = process.argv.includes('--hidden')

/**
 * Tamaño al abrir, en la pantalla donde está el ratón: 1700×1000 si cabe con holgura (2K o más);
 * si no (1080p, portátiles), maximizada.
 */
function startBounds(): Electron.Rectangle & { maximize: boolean } {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const fits = area.width >= 1700 + 120 && area.height >= 1000 + 60
  const width = fits ? 1700 : Math.min(1360, area.width)
  const height = fits ? 1000 : Math.min(860, area.height)
  return {
    width,
    height,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    maximize: !fits
  }
}

function createWindow(): BrowserWindow {
  const { maximize, ...start } = startBounds()
  // Pruebas: fuera de la pantalla, y con el tamaño que se pida (POXI_SMOKE_SIZE="2000x1100")
  const forced = /^(\d+)x(\d+)$/.exec(process.env.POXI_SMOKE_SIZE ?? '')
  const bounds = smokeMode ? { ...start, ...(forced ? { width: +forced[1], height: +forced[2] } : {}), x: -6000, y: -6000 } : start
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 1080,
    minHeight: 680,
    frame: false,
    show: false,
    backgroundColor: '#0a0e08',
    icon: iconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  // El portable corre desde una carpeta temporal que se borra al cerrar: al fijarlo en la barra de tareas,
  // que Windows apunte al .exe portable de verdad y no a esa carpeta
  if (PORTABLE_EXE) {
    win.setAppDetails({
      appId: 'com.poxi.poxilauncher.portable',
      relaunchCommand: `"${PORTABLE_EXE}"`,
      relaunchDisplayName: 'PoxiLauncher',
      appIconPath: PORTABLE_EXE,
      appIconIndex: 0
    })
  }

  win.once('ready-to-show', () => {
    // Al arrancar con Windows empieza minimizada en la barra de tareas
    if (startHidden) win.showInactive()
    if (startHidden) win.minimize()
    else {
      // En pruebas, fuera de la pantalla y sin quitarle el foco a nadie
      if (maximize && !smokeMode) win.maximize()
      if (smokeMode) win.showInactive()
      else win.show()
    }
  })

  // La ventana nunca navega fuera de la app ni abre ventanas nuevas
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  // Botones laterales del ratón: algunos ratones llegan como orden de Windows y no como clic
  win.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward') emit('nav', { dir: 'back' })
    if (cmd === 'browser-forward') emit('nav', { dir: 'forward' })
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (!app.isPackaged && process.env.POXI_SMOKE) {
    // En las pruebas, los errores de la interfaz salen por la consola
    win.webContents.on('console-message', (e) => {
      if (e.level === 'error' || e.level === 'warning') console.log('[renderer]', e.message)
    })
    void smoke(win, process.env.POXI_SMOKE)
  }
  return win
}

/** POXI_SMOKE="dir;js1|js2|…": ejecuta cada paso JS en la interfaz, captura y sale. */
async function smoke(win: BrowserWindow, spec: string): Promise<void> {
  const cut = spec.indexOf(';')
  const dir = cut < 0 ? spec : spec.slice(0, cut)
  const steps = cut < 0 ? '' : spec.slice(cut + 1)
  const { writeFileSync } = await import('node:fs')
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  await wait(Number(process.env.POXI_SMOKE_WAIT ?? 8000))
  let i = 0
  for (const js of ['', ...steps.split('|').filter(Boolean)]) {
    if (js) await win.webContents.executeJavaScript(js).catch((e) => console.error('smoke js', e))
    await wait(js ? Number(process.env.POXI_SMOKE_STEP ?? 3500) : 0)
    writeFileSync(join(dir, `shot-${i++}.png`), (await win.webContents.capturePage()).toPNG())
  }
  markQuitting()
  app.exit(0)
}

const INSTANCE = (): string => join(app.getPath('userData'), 'instance.json')
/** Esta copia ha sustituido a otra más vieja que estaba abierta */
let replacedOlder = false

/**
 * Solo una copia abierta. Si ya hay otra y ESTA es más nueva, la vieja se cierra sola
 * (ver 'second-instance') y esperamos a que suelte el bloqueo; si no, la abierta pasa al frente.
 */
async function acquireLock(): Promise<boolean> {
  const me = { version: app.getVersion() }
  if (app.requestSingleInstanceLock(me)) return true
  let running = ''
  try {
    running = JSON.parse(readFileSync(INSTANCE(), 'utf8')).version
  } catch {
    /* sin datos de la otra copia */
  }
  if (!running || !isNewer(me.version, running)) return false
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (app.requestSingleInstanceLock(me)) return (replacedOlder = true)
  }
  return false
}

void acquireLock().then(async (ok) => {
  if (!ok) return app.quit()
  // Portable abierto por el actualizador de un portable viejo (hasta la 3.0.1 bajaba el portable nuevo en vez de
  // instalar): se instala en el PC, como hacen ya las versiones nuevas. Sin conexión, se abre el portable y listo.
  if (PORTABLE_EXE && replacedOlder && (await installFromPortable(app.getVersion()).then(() => true, () => false))) return app.exit(0)
  start()
})

function start(): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(INSTANCE(), JSON.stringify({ version: app.getVersion(), pid: process.pid }))

  // Enlaces poxilauncher:// (invitaciones): con la app cerrada llegan en sus argumentos; abierta, en 'second-instance'
  registerProtocol(PORTABLE_EXE)
  inviteFromArgv(process.argv)

  app.on('second-instance', (_e, argv, _cwd, data) => {
    const other = (data as { version?: string } | undefined)?.version
    if (other && isNewer(other, app.getVersion())) {
      // Se está abriendo una versión más nueva: esta se retira para dejarle paso
      markQuitting()
      app.quit()
      return
    }
    inviteFromArgv(argv)
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    // El portable y el modo desarrollo llevan identificador propio: si no, Windows mezcla sus accesos con los de
    // la versión instalada (y la barra de tareas acaba enseñando el icono y el nombre de "Electron")
    const aumid = !app.isPackaged ? 'com.poxi.poxilauncher.dev' : PORTABLE_EXE ? 'com.poxi.poxilauncher.portable' : 'com.poxi.poxilauncher'
    app.setAppUserModelId(aumid)
    // Antes de abrir la ventana: que la barra de tareas encuentre nuestro icono y nombre (no "Electron")
    try {
      fixStartMenuShortcuts(aumid, PORTABLE_EXE ?? process.execPath, !!PORTABLE_EXE)
    } catch (e) {
      console.error('Accesos del menú Inicio:', (e as Error).message)
    }
    enableSecureDns()
    // Banners de perfil, stickers, capturas y clips del chat (del servidor propio y guardados por versión)
    protocol.handle('poxi-img', (req) => {
      const host = new URL(req.url).hostname
      if (host === 'media') return serveMedia(req)
      if (host === 'capture') return serveCaptureThumb(req)
      if (host === 'sticker') return serveSticker(req)
      return serveBanner(req)
    })
    registerIpc()
    mainWindow = createWindow()

    initSystem()
    startPresence()
    startAccount()
    setupUpdater()
  })

  app.on('before-quit', () => markQuitting())
  // Cerrar es cerrar SIEMPRE: el proceso termina sí o sí, aunque algo quede colgado por dentro
  // (así no se queda la app en segundo plano)
  let exiting = false
  app.on('will-quit', (e) => {
    if (exiting) return
    exiting = true
    e.preventDefault()
    // Con un servidor de Minecraft en marcha se espera a que se pare (y suba el mundo del grupo), hasta 45 s
    const wait = hostingActive() ? 45_000 : 3000
    void Promise.race([stopAllHosting(), new Promise((r) => setTimeout(r, wait))]).finally(() => app.exit(0))
  })
  app.on('window-all-closed', () => {
    app.quit()
    setTimeout(() => app.exit(0), hostingActive() ? 50_000 : 6000).unref()
  })
}
