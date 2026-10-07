// Capturas y clips mientras juegas: pulsar el atajo (F12) guarda una captura de la pantalla del juego en
// Imágenes\PoxiLauncher\<juego>; mantenerlo 3 s guarda un clip con los últimos segundos (si los clips están encendidos,
// ver recorder.ts) en Vídeos\PoxiLauncher\<juego>. Se graba la pantalla, no el juego (como Medal): no se toca nada del
// juego y funciona en ventana, sin bordes y a pantalla completa. Lo guardado se apunta en una lista para compartirlo.
import { app, desktopCapturer, globalShortcut, nativeImage, screen, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CLIP_HOLD_MS, SHOT_HOTKEY, captureFileName, hotkeyMods, mainKeyVk, safeName, type CaptureItem } from '@shared/capture'
import { translate } from '@shared/i18n'
import { emit } from '../events'
import { dataPath, readJson, writeJson } from '../store'
import { getSettings, onSettingsChange } from '../settings'
import { notify } from '../system/notify'
import { mcPlaying, onMcPlaying } from '../minecraft/service'
import { keepPopupReady, showGamePopup } from './popup'
import { overlayInfo } from '../overlay/service'
import { quickShot, startWin32, watchKey } from '../overlay/win32'
import { clipReady, saveClip } from './recorder'

/** Pruebas: sin atajos de verdad; se piden por IPC */
const smoke = !app.isPackaged && !!process.env.POXI_SMOKE

// ——— Lo guardado (para compartirlo luego desde el chat) ———
const FILE = (): string => dataPath('captures.json')
const MAX_ITEMS = 200
let items: CaptureItem[] | null = null
const list = (): CaptureItem[] => (items ??= readJson<{ items: CaptureItem[] }>(FILE(), { items: [] }).items)

/** Lo guardado que aún existe, de lo más nuevo a lo más viejo */
export function captures(): CaptureItem[] {
  const all = list()
  const alive = all.filter((c) => existsSync(c.path))
  if (alive.length !== all.length) {
    items = alive
    writeJson(FILE(), { items })
  }
  return alive
}
export const captureById = (id: string): CaptureItem | undefined => list().find((c) => c.id === id)

export function remember(c: CaptureItem): void {
  items = [c, ...list()].slice(0, MAX_ITEMS)
  writeJson(FILE(), { items })
  emit('captures', captures())
}

/** Miniatura (JPEG pequeño) de una captura o un clip: para elegir qué compartir sin cargar los archivos enteros */
export function saveThumb(id: string, img: Electron.NativeImage): void {
  const dir = dataPath('captures')
  mkdirSync(dir, { recursive: true })
  writeFileSync(thumbPath(id), img.resize({ width: 480 }).toJPEG(80))
}
export const thumbPath = (id: string): string => dataPath('captures', `${id}.jpg`)

/** La carpeta de un juego dentro de Imágenes o Vídeos\PoxiLauncher */
export function captureDir(kind: 'pictures' | 'videos', game: string): string {
  const dir = join(app.getPath(kind), 'PoxiLauncher', safeName(game))
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Abre Imágenes o Vídeos\PoxiLauncher en el Explorador */
export function openCaptureFolder(kind: 'pictures' | 'videos'): void {
  const dir = join(app.getPath(kind), 'PoxiLauncher')
  mkdirSync(dir, { recursive: true })
  void shell.openPath(dir)
}

const gameName = (): string => overlayInfo().game?.name || 'PoxiLauncher'

// ——— Captura ———
/** Captura de la pantalla donde está el juego (donde está el ratón: en pleno juego, la del juego) */
export async function screenshot(): Promise<CaptureItem | null> {
  const game = gameName()
  const at = new Date()
  const path = join(captureDir('pictures', game), `${captureFileName(game, at)}.png`)
  // Rápida con el ayudante de Windows (si está en marcha: mientras juegas); si no, o si sale negra, la de Chromium
  let img = (await quickShot(path)) ? nativeImage.createFromPath(path) : null
  if (!img || img.isEmpty()) {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) }
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size }).catch(() => [])
    img = (sources.find((s) => s.display_id === String(d.id)) ?? sources[0])?.thumbnail ?? null
    if (!img || img.isEmpty()) return null
    writeFileSync(path, img.toPNG())
  }
  const { width: w, height: h } = img.getSize()
  const lang = getSettings().lang
  // El aviso primero (es lo que se nota); lo demás, después
  showGamePopup(
    {
      icon: img.resize({ width: 128 }).toDataURL(),
      kicker: `📸 ${translate(lang, 'capture.shot', {})}`,
      title: game,
      desc: translate(lang, 'capture.shareHint', {}),
      glow: '#60a5fa',
      ms: 3500,
      tag: 'captura'
    },
    true
  )
  const c: CaptureItem = { id: randomUUID(), kind: 'image', path, gameId: null, game, at: at.getTime(), w, h, bytes: sizeOf(path) }
  saveThumb(c.id, img)
  remember(c)
  return c
}

// ——— El atajo: pulsar = captura; mantener 3 s = clip ———
// La tecla se vigila con el ayudante de Windows (como Medal o Steam), no como atajo registrado: F12 no se puede
// registrar (Windows la guarda para el depurador) y así se sabe también cuándo se suelta. El juego la sigue recibiendo.
// Solo una tecla que no sepa vigilar (raras) va como atajo normal, y entonces es siempre captura.
let registered: string | null = null
let watching = false
let hold: NodeJS.Timeout | null = null

const run = (job: () => Promise<unknown>): void => void job().catch((e) => console.error('[capturas]', e))

function onKey(down: boolean): void {
  // Sin clips, la captura sale al pulsar (sin esperar a soltar)
  if (!getSettings().clips || !clipReady()) return void (down && run(screenshot))
  if (down) {
    hold ??= setTimeout(() => {
      hold = null
      run(saveClip)
    }, CLIP_HOLD_MS)
  } else if (hold) {
    // Soltada antes de los 3 s: captura
    clearTimeout(hold)
    hold = null
    run(screenshot)
  }
}

function register(): void {
  unregister()
  const key = getSettings().shotHotkey || SHOT_HOTKEY
  const vk = mainKeyVk(key)
  if (vk !== null) {
    watching = true
    startWin32()
    void watchKey(vk, hotkeyMods(key), onKey)
  } else if (globalShortcut.register(key, () => run(screenshot))) registered = key
  else notify('capture.taken', { key }, 'error')
}
function unregister(): void {
  if (registered) globalShortcut.unregister(registered)
  registered = null
  if (watching) void watchKey(0, 0, null)
  watching = false
  if (hold) clearTimeout(hold)
  hold = null
}

const playingSomething = (): boolean => !!mcPlaying()
function onPlaying(): void {
  if (smoke) return
  keepPopupReady(playingSomething())
  if (playingSomething()) register()
  else unregister()
}
onMcPlaying(onPlaying)
onSettingsChange((_s, patch) => {
  if ('shotHotkey' in patch && (registered || watching)) register()
})
app.on('will-quit', unregister)

/** Tamaño de un archivo (0 si ya no está) */
export const sizeOf = (path: string): number => {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}
