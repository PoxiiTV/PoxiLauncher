// Clips: mientras juegas (y con los clips encendidos), FFmpeg graba la pantalla en un búfer de trozos de 2 s que se van
// sobreescribiendo, con la gráfica si puede (NVENC, AMF o Quick Sync) para no quitarle rendimiento al juego. Al pedir un
// clip se juntan los últimos trozos en un MP4 sin volver a comprimir (al instante). El audio del sistema llega de una
// ventana oculta (audiocap) por la entrada de FFmpeg. FFmpeg no viene con la app: se descarga al encender los clips.
import { app, BrowserWindow, desktopCapturer, screen, session, type Display } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, createReadStream, existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  AUDIO_RATE,
  CLIP_ENCODERS,
  SEGMENT_SECONDS,
  captureFileName,
  clipSegments,
  concatList,
  outHeight,
  recordArgs,
  type CaptureItem,
  type ClipDevices,
  type ClipEncoder,
  type ClipStatus,
  type RecordPlan
} from '@shared/capture'
import { translate } from '@shared/i18n'
import { emit } from '../events'
import { downloadTo } from '../net'
import { dataPath } from '../store'
import { getSettings, onSettingsChange } from '../settings'
import { run7z } from '../system/sevenzip'
import { mcPlaying, onMcPlaying } from '../minecraft/service'
import { showGamePopup } from './popup'
import { overlayInfo } from '../overlay/service'
import { captureDir, remember, saveThumb, sizeOf } from './service'
import { listDevices, loopback, type ClipScreen } from './devices'

// FFmpeg de gyan.dev (el que enlaza ffmpeg.org para Windows), versión fija y comprobada
const FFMPEG = {
  version: '9.0.2',
  url: 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.7z',
  sha256: '4705843ccaaf54257c16ad90f3e952ece33c17df964ecf7bfdbb0f49c7171077'
}
const ffDir = (): string => dataPath('ffmpeg', FFMPEG.version)
const ffExe = (): string => join(ffDir(), 'ffmpeg.exe')
const bufDir = (): string => dataPath('clipbuf')

const trace = (msg: string): void => {
  try {
    appendFileSync(dataPath('clips.log'), `${new Date().toISOString()} ${msg}\n`)
  } catch {
    /* sin registro no pasa nada */
  }
}

// ——— Estado (para Ajustes) ———
let status: ClipStatus = { state: 'off' }
const setStatus = (s: ClipStatus): void => {
  status = s
  emit('clipStatus', s)
}
export const clipStatus = (): ClipStatus => status
/** ¿Se puede sacar un clip ahora mismo? (si no, mantener la tecla hace una captura normal) */
export const clipReady = (): boolean => !!rec

// ——— FFmpeg: descargarlo y verificarlo ———
const sha256 = (file: string): Promise<string> =>
  new Promise((res, rej) => {
    const h = createHash('sha256')
    createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('end', () => res(h.digest('hex')))
      .on('error', rej)
  })

let installing: Promise<boolean> | null = null
export function ensureFfmpeg(): Promise<boolean> {
  if (existsSync(ffExe())) return Promise.resolve(true)
  installing ??= install().finally(() => (installing = null))
  return installing
}

async function install(): Promise<boolean> {
  const dir = ffDir()
  const file = join(dataPath('ffmpeg'), 'ffmpeg.7z')
  try {
    await mkdir(dir, { recursive: true })
    let last = -1
    setStatus({ state: 'download', pct: 0 })
    await downloadTo(FFMPEG.url, `${file}.part`, (done, total) => {
      const pct = total ? Math.floor((done / total) * 100) : 0
      if (pct !== last) setStatus({ state: 'download', pct: (last = pct) })
    })
    if ((await sha256(`${file}.part`)) !== FFMPEG.sha256) throw new Error('SHA-256 no coincide')
    await rename(`${file}.part`, file)
    if (!(await run7z(['e', '-y', file, '*/bin/ffmpeg.exe', `-o${dir}`], dir)) || !existsSync(ffExe())) throw new Error('no se pudo extraer')
    trace(`FFmpeg ${FFMPEG.version} listo`)
    return true
  } catch (e) {
    trace(`FFmpeg no se pudo preparar: ${(e as Error).message}`)
    setStatus({ state: 'error' })
    return false
  } finally {
    await rm(file, { force: true }).catch(() => undefined)
    await rm(`${file}.part`, { force: true }).catch(() => undefined)
  }
}

const runFf = (args: string[]): Promise<{ ok: boolean; err: string }> =>
  new Promise((res) => {
    const p = spawn(ffExe(), args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr?.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-2000)))
    p.on('exit', (code) => res({ ok: code === 0, err }))
    p.on('error', (e) => res({ ok: false, err: e.message }))
  })

/** La mejor forma de grabar de este PC (la gráfica si se deja), una vez por sesión */
let encoder: ClipEncoder | null = null
async function pickEncoder(): Promise<ClipEncoder> {
  for (const e of CLIP_ENCODERS) {
    const r = await runFf(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=640x360:d=0.2', '-c:v', e, '-f', 'null', '-'])
    if (r.ok) return e
  }
  return 'libx264'
}

// ——— El audio del sistema (ventana oculta) ———
let audioWin: BrowserWindow | null = null
let onPcm: ((b: Buffer) => void) | null = null
let audioHandler = false

function startAudio(): void {
  if (audioWin) return
  const partition = 'poxi-audiocap'
  if (!audioHandler) {
    audioHandler = true
    // Solo esta ventana (su propia sesión) lo pide: se le da el sonido del sistema («loopback»). Electron exige también
    // una imagen: se le da la de la propia ventana oculta (no se usa), no la pantalla, que con la app como administrador
    // no arranca («Could not start video source») y dejaba los clips sin sonido
    session.fromPartition(partition).setDisplayMediaRequestHandler((r, cb) => cb(r.frame ? { video: r.frame, audio: 'loopback' } : {}))
  }
  const w = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  audioWin = w
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  w.webContents.on('render-process-gone', () => audioFailed('la ventana del audio se ha cerrado'))
  w.on('closed', () => {
    if (audioWin === w) audioWin = null
  })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void w.loadURL(`${process.env.ELECTRON_RENDERER_URL}/audiocap.html`)
  else void w.loadFile(join(__dirname, '../renderer/audiocap.html'))
}

// ——— O el de un dispositivo concreto (si se ha elegido uno en Ajustes) ———
let loopProc: ReturnType<typeof loopback> | null = null

function stopAudio(): void {
  onPcm = null
  if (audioWin && !audioWin.isDestroyed()) audioWin.destroy()
  audioWin = null
  const l = loopProc
  loopProc = null
  l?.kill()
}

/** Un trozo de audio de la ventana oculta */
export const pushPcm = (b: Uint8Array): void => onPcm?.(Buffer.from(b.buffer, b.byteOffset, b.byteLength))

/** Sin audio del sistema: se sigue grabando solo la imagen */
export function audioFailed(why: string): void {
  trace(`audio: ${why}`)
  if (!plan?.audio) return
  stopAudio()
  noAudio = true
  restart()
}

// ——— Grabar ———
let rec: ChildProcess | null = null
let plan: RecordPlan | null = null
/** La pantalla que se está grabando (para el tamaño y la miniatura del clip) */
let recScreen: ClipScreen | null = null
let noAudio = false
let starting = false
let retries = 0

// Pruebas: grabar como si hubiera una partida
const smokePlay = !app.isPackaged && !!process.env.POXI_SMOKE_CLIPS
const playingSomething = (): boolean => smokePlay || !!mcPlaying()
const wanted = (): boolean => getSettings().clips && playingSomething()

async function start(): Promise<void> {
  if (rec || starting || !wanted()) return
  starting = true
  try {
    if (!(await ensureFfmpeg())) return
    encoder ??= await pickEncoder()
    if (!wanted()) return
    const s = getSettings()
    await rm(bufDir(), { recursive: true, force: true })
    await mkdir(bufDir(), { recursive: true })
    // La pantalla elegida (por su nombre de Windows: FFmpeg las numera a su manera) o la principal; y la salida de audio
    // elegida, si sigue conectada (si no, la predeterminada)
    const devs = await listDevices()
    const scr = devs.screens.find((x) => x.name === s.clipScreen) ?? devs.screens.find((x) => x.x === 0 && x.y === 0) ?? devs.screens[0] ?? null
    const device = s.clipAudioDevice && devs.audio.some((a) => a.id === s.clipAudioDevice) ? s.clipAudioDevice : ''
    if (!wanted()) return
    const d = screen.getPrimaryDisplay()
    recScreen = scr
    const p: RecordPlan = {
      encoder,
      quality: s.clipQuality,
      fps: s.clipFps,
      audio: s.clipAudio && !noAudio,
      output: scr?.idx ?? 0,
      audioIn: { format: 's16le', rate: AUDIO_RATE },
      srcH: scr?.h ?? Math.round(d.size.height * d.scaleFactor),
      seconds: s.clipSeconds,
      dir: bufDir()
    }
    // El audio primero: FFmpeg arranca con el primer trozo (así imagen y sonido empiezan a la vez)
    const first = p.audio ? await firstAudio(device) : null
    const firstPcm = first?.pcm ?? null
    if (first) p.audioIn = first.audioIn
    if (p.audio && !firstPcm) {
      trace('audio: no llega nada, se graba sin sonido')
      p.audio = false
      noAudio = true
      stopAudio()
    }
    if (!wanted()) return
    const child = spawn(ffExe(), recordArgs(p), { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] })
    rec = child
    plan = p
    let err = ''
    child.stderr?.on('data', (b: Buffer) => (err = (err + b.toString()).slice(-2000)))
    child.stdin?.on('error', () => undefined)
    if (p.audio) {
      child.stdin?.write(firstPcm)
      onPcm = (b) => child.stdin?.write(b)
    }
    child.on('exit', (code) => {
      if (rec !== child) return
      rec = null
      plan = null
      onPcm = null
      trace(`FFmpeg se ha parado (${code}) ${err.trim().replace(/\s+/g, ' ').slice(0, 600)}`)
      // Se ha caído solo: se vuelve a intentar un par de veces
      if (wanted() && retries++ < 3) setTimeout(() => void start(), 3000)
      else setStatus({ state: wanted() ? 'error' : 'ready' })
    })
    trace(`grabando: pantalla ${scr?.name ?? '?'} (${p.output}) ${p.encoder} ${outHeight(p.quality, p.srcH)}p ${p.fps} fps ${p.seconds} s${p.audio ? ` con audio ${device ? `de ${device} (${p.audioIn.rate} Hz)` : 'del sistema'}` : ''}`)
    setStatus({ state: 'recording', encoder: p.encoder })
  } catch (e) {
    trace(`no se pudo empezar a grabar: ${(e as Error).message}`)
    setStatus({ state: 'error' })
  } finally {
    starting = false
  }
}

/** Arranca el audio (la ventana oculta, o el dispositivo elegido) y espera al primer trozo (máx. 8 s: el del dispositivo
 * tarda un poco más en prepararse) */
function firstAudio(device: string): Promise<{ pcm: Buffer; audioIn: RecordPlan['audioIn'] } | null> {
  return new Promise((res) => {
    let audioIn: RecordPlan['audioIn'] = { format: 's16le', rate: AUDIO_RATE }
    const t = setTimeout(() => {
      onPcm = null
      res(null)
    }, 8000)
    onPcm = (b) => {
      clearTimeout(t)
      onPcm = null
      res({ pcm: b, audioIn })
    }
    if (!device) return startAudio()
    const proc = loopback(
      device,
      (rate) => (audioIn = { format: 'f32le', rate }),
      (b) => onPcm?.(b),
      () => {
        if (loopProc === proc) audioFailed('el dispositivo de audio ha dejado de contestar')
      }
    )
    loopProc = proc
  })
}

function stop(): void {
  const child = rec
  rec = null
  plan = null
  stopAudio()
  if (child) {
    child.stdin?.end()
    child.kill()
  }
  setStatus({ state: existsSync(ffExe()) ? 'ready' : 'off' })
}

function restart(): void {
  stop()
  retries = 0
  void start()
}

/** Guarda en Vídeos\PoxiLauncher\<instancia> los últimos segundos del búfer */
export async function saveClip(): Promise<CaptureItem | null> {
  const p = plan
  if (!rec || !p) return null
  const names = (await readdir(p.dir)).filter((n) => n.endsWith('.ts'))
  const segs = await Promise.all(names.map(async (name) => ({ path: join(p.dir, name), mtime: (await stat(join(p.dir, name))).mtimeMs })))
  const pick = clipSegments(segs, p.seconds)
  if (!pick.length) return null
  const game = overlayInfo().game?.name || 'PoxiLauncher'
  const at = new Date()
  const out = join(captureDir('videos', game), `${captureFileName(game, at)}.mp4`)
  // Copia de los trozos elegidos: FFmpeg sigue grabando y podría sobreescribir alguno mientras se juntan
  const tmp = join(dataPath('clipbuf-save'), randomUUID())
  await mkdir(tmp, { recursive: true })
  try {
    const files: string[] = []
    for (const [i, s] of pick.entries()) {
      const f = join(tmp, `${String(i).padStart(3, '0')}.ts`)
      await copyFile(s.path, f)
      files.push(f)
    }
    await writeFile(join(tmp, 'list.txt'), concatList(files))
    const aac = p.audio ? ['-bsf:a', 'aac_adtstoasc'] : []
    const r = await runFf([
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      join(tmp, 'list.txt'),
      '-c',
      'copy',
      ...aac,
      '-movflags',
      '+faststart',
      out
    ])
    if (!r.ok || !existsSync(out)) {
      trace(`el clip no se pudo guardar: ${r.err.trim().slice(0, 400)}`)
      return null
    }
  } finally {
    void rm(tmp, { recursive: true, force: true }).catch(() => undefined)
  }
  const h = outHeight(p.quality, p.srcH)
  const d = screen.getPrimaryDisplay()
  // La proporción y la miniatura, de la pantalla que se graba
  const sw = recScreen?.w ?? d.size.width
  const sh = recScreen?.h ?? d.size.height
  const shown = displayOf(recScreen)
  const c: CaptureItem = {
    id: randomUUID(),
    kind: 'video',
    path: out,
    gameId: null,
    game,
    at: at.getTime(),
    w: Math.round((h * sw) / sh / 2) * 2,
    h,
    seconds: pick.length * SEGMENT_SECONDS,
    bytes: sizeOf(out)
  }
  // La miniatura: cómo está la pantalla ahora (el clip acaba justo antes)
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 480, height: 270 } }).catch(() => [])
  const thumb = [sources.find((x) => shown && x.display_id === String(shown.id)) ?? sources[0]].filter(Boolean)
  if (thumb[0] && !thumb[0].thumbnail.isEmpty()) saveThumb(c.id, thumb[0].thumbnail)
  remember(c)
  const lang = getSettings().lang
  showGamePopup(
    {
      icon: thumb[0]?.thumbnail.resize({ width: 128 }).toDataURL() ?? '',
      kicker: `🎬 ${translate(lang, 'capture.clip', { n: c.seconds ?? p.seconds })}`,
      title: game,
      desc: translate(lang, 'capture.clipHint', {}),
      glow: '#f472b6',
      ms: 3500,
      tag: 'clip'
    },
    true
  )
  return c
}

/** La pantalla de Electron que es esa de Windows (por su posición en píxeles de verdad) */
function displayOf(x: ClipScreen | null): Display | undefined {
  if (!x) return undefined
  return screen.getAllDisplays().find((d) => {
    const r = screen.dipToScreenRect(null, d.bounds)
    return r.x === x.x && r.y === x.y
  })
}

/** Pantallas y salidas de audio para Ajustes (las pantallas, con el nombre que les da Windows en Configuración) */
export async function clipDevices(): Promise<ClipDevices> {
  const { screens, audio } = await listDevices()
  return {
    screens: screens.map((x) => ({
      name: x.name,
      label: `${displayOf(x)?.label || x.name.replace(/^\\\\\.\\/, '')} · ${x.w}×${x.h}`,
      primary: x.x === 0 && x.y === 0
    })),
    audio
  }
}

// Empieza o acaba una partida, o cambian los ajustes de los clips
const onPlaying = (): void => {
  if (wanted()) {
    retries = 0
    noAudio = false
    void start()
  } else if (rec || starting) stop()
}
onMcPlaying(onPlaying)
onSettingsChange((s, patch) => {
  if (!['clips', 'clipSeconds', 'clipQuality', 'clipFps', 'clipAudio', 'clipScreen', 'clipAudioDevice'].some((k) => k in patch)) return
  // Al encender los clips se descarga FFmpeg ya (en Ajustes se ve el progreso), sin esperar a la partida
  if (s.clips) void ensureFfmpeg().then((ok) => ok && !rec && setStatus({ state: 'ready' }))
  if ('clipAudio' in patch || 'clipAudioDevice' in patch) noAudio = false
  if (rec || wanted()) restart()
  else if (!s.clips) setStatus({ state: existsSync(ffExe()) ? 'ready' : 'off' })
})
app.whenReady().then(() => {
  if (existsSync(ffExe())) status = { state: 'ready' }
  // Los clips vienen encendidos: FFmpeg se descarga al poco de abrir (sin estorbar el arranque), para que la primera
  // partida ya tenga clips
  else if (getSettings().clips && !smokePlay) setTimeout(() => void ensureFfmpeg().then((ok) => ok && !rec && setStatus({ state: 'ready' })), 20_000)
  if (smokePlay) onPlaying()
})
app.on('will-quit', stop)

/** Un clip que no cabe en el chat (60 MB): se vuelve a comprimir con la calidad justa para que quepa (y, si hace falta,
 * más pequeño). Devuelve el archivo nuevo (temporal) o null */
export async function shrinkForShare(file: string, seconds: number, h: number, maxBytes: number): Promise<string | null> {
  if (!(await ensureFfmpeg())) return null
  encoder ??= await pickEncoder()
  // Un 5 % de margen para el contenedor, menos el audio
  const kbps = Math.floor((maxBytes * 8 * 0.95) / 1000 / Math.max(1, seconds)) - 160
  if (kbps < 500) return null
  const outH = kbps < 4000 ? Math.min(h, 720) : kbps < 8000 ? Math.min(h, 1080) : h
  const dir = dataPath('clipbuf-save')
  await mkdir(dir, { recursive: true })
  const out = join(dir, `${randomUUID()}.mp4`)
  const r = await runFf([
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    file,
    '-vf',
    `scale=-2:${outH}`,
    '-c:v',
    encoder,
    '-b:v',
    `${kbps}k`,
    '-maxrate',
    `${kbps}k`,
    '-bufsize',
    `${kbps * 2}k`,
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    out
  ])
  if (!r.ok || !existsSync(out)) {
    trace(`no se pudo encoger el clip: ${r.err.trim().slice(0, 300)}`)
    await rm(out, { force: true })
    return null
  }
  return out
}
