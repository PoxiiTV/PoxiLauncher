// Capturas y clips (F12, o mantenerlo para guardar los últimos segundos): tipos, opciones y lo que se puede calcular
// sin tocar nada (nombres de archivo, qué trozos del búfer forman un clip, la tecla que hay que vigilar). Pura y con tests.

export const SHOT_HOTKEY = 'F12'
/** Cuánto hay que mantener la tecla para que sea un clip y no una captura */
export const CLIP_HOLD_MS = 3000
export const CLIP_SECONDS = [15, 30, 60, 120] as const
export type ClipSeconds = (typeof CLIP_SECONDS)[number]
export const CLIP_QUALITIES = ['native', '1080', '720'] as const
export type ClipQuality = (typeof CLIP_QUALITIES)[number]
export const CLIP_FPS = [30, 60] as const
export type ClipFps = (typeof CLIP_FPS)[number]
/** Cada trozo del búfer de grabación dura esto (s): el clip se hace juntando los últimos */
export const SEGMENT_SECONDS = 2

/** Una captura o un clip guardado */
export interface CaptureItem {
  id: string
  kind: 'image' | 'video'
  path: string
  gameId: number | null
  game: string
  at: number
  w: number
  h: number
  /** Solo los clips: duración en segundos */
  seconds?: number
  bytes: number
}

/** Un nombre de carpeta o archivo válido en Windows a partir del nombre de una instancia */
export function safeName(name: string): string {
  const s = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  return (s || 'PoxiLauncher').slice(0, 80)
}

/** «Juego 2026-09-30 17-45-12» (la hora de tu PC, sin caracteres que Windows no deje) */
export function captureFileName(game: string, at: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${safeName(game)} ${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ${p(at.getHours())}-${p(at.getMinutes())}-${p(at.getSeconds())}`
}

/** De los trozos del búfer (con su fecha), los últimos que cubren `seconds`, del más viejo al más nuevo. El que se está
 * escribiendo se deja fuera (va a medias): como para un clip se mantiene la tecla 3 s, los terminados ya llegan hasta
 * el momento en que se pulsó */
export function clipSegments<T extends { mtime: number }>(segments: T[], seconds: number): T[] {
  const need = Math.ceil(seconds / SEGMENT_SECONDS)
  return [...segments]
    .sort((a, b) => a.mtime - b.mtime)
    .slice(0, -1)
    .slice(-need)
}

/** Cuántos trozos guarda el búfer para poder sacar un clip de `seconds` (con margen) */
export const bufferSegments = (seconds: number): number => Math.ceil(seconds / SEGMENT_SECONDS) + 3

/** Los modificadores de un atajo de Electron para vigilarlo en Windows: 1 Ctrl, 2 Mayús, 4 Alt */
export function hotkeyMods(accelerator: string): number {
  const parts = accelerator.split('+').slice(0, -1)
  return (
    (parts.some((p) => /^(CommandOrControl|CmdOrCtrl|Control|Ctrl)$/.test(p)) ? 1 : 0) | (parts.includes('Shift') ? 2 : 0) | (parts.includes('Alt') ? 4 : 0)
  )
}

/** El código de Windows (VK) de la tecla principal de un atajo de Electron, para saber si se sigue pulsando */
export function mainKeyVk(accelerator: string): number | null {
  const key = accelerator.split('+').pop() ?? ''
  const f = /^F([1-9]|1[0-9]|2[0-4])$/.exec(key)
  if (f) return 0x6f + Number(f[1])
  if (/^[A-Z0-9]$/.test(key)) return key.charCodeAt(0)
  const named: Record<string, number> = {
    Space: 0x20,
    Home: 0x24,
    End: 0x23,
    PageUp: 0x21,
    PageDown: 0x22,
    Insert: 0x2d,
    Delete: 0x2e,
    Pause: 0x13,
    Scrolllock: 0x91
  }
  return named[key] ?? null
}

export type ClipEncoder = 'h264_nvenc' | 'h264_amf' | 'h264_qsv' | 'libx264'
/** Cómo van los clips: sin FFmpeg aún, descargándolo, listo (se graba al jugar), grabando o con un fallo */
export interface ClipStatus {
  state: 'off' | 'download' | 'ready' | 'recording' | 'error'
  pct?: number
  encoder?: ClipEncoder
}
/** De mejor a peor: la gráfica graba sin gastar CPU; libx264 (el procesador) si no hay otra */
export const CLIP_ENCODERS: ClipEncoder[] = ['h264_nvenc', 'h264_amf', 'h264_qsv', 'libx264']
/** Audio del sistema que llega por la entrada estándar de FFmpeg */
export const AUDIO_RATE = 48000

export interface RecordPlan {
  encoder: ClipEncoder
  quality: ClipQuality
  fps: ClipFps
  audio: boolean
  /** Pantalla que se graba (número de FFmpeg, ddagrab output_idx) */
  output: number
  /** Cómo llega el audio por la entrada estándar: el de la ventana oculta (s16le a 48 kHz) o el de un dispositivo
   * concreto (float a su frecuencia) */
  audioIn: { format: 's16le' | 'f32le'; rate: number }
  /** Alto de la pantalla en píxeles de verdad */
  srcH: number
  seconds: number
  dir: string
}

/** Alto del vídeo grabado: el de la pantalla, o el elegido si es menor */
export const outHeight = (quality: ClipQuality, srcH: number): number => (quality === 'native' ? srcH : Math.min(srcH, Number(quality)))

/** Megabits por segundo según el alto y los FPS: buena imagen sin clips enormes */
export function clipBitrate(h: number, fps: ClipFps): number {
  const base = h >= 1440 ? 16 : h >= 1080 ? 10 : 6
  return fps === 30 ? Math.round(base * 0.6) : base
}

/** Los argumentos de FFmpeg para el búfer: pantalla (ddagrab) + audio (pcm por stdin) en trozos de 2 s que se sobreescriben */
export function recordArgs(p: RecordPlan): string[] {
  const h = outHeight(p.quality, p.srcH)
  const mb = clipBitrate(h, p.fps)
  const gpuOnly = p.encoder === 'h264_nvenc' && h === p.srcH
  const a = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `ddagrab=output_idx=${p.output}:framerate=${p.fps}`]
  if (p.audio) a.push('-f', p.audioIn.format, '-ar', String(p.audioIn.rate), '-ac', '2', '-i', 'pipe:0')
  a.push('-map', '0:v')
  if (p.audio) a.push('-map', '1:a')
  // NVENC coge la imagen directamente de la gráfica (la convierte él y lo apunta en el vídeo: BT.601 de rango normal); el
  // resto pasa por la CPU: se escala allí y se convierte a BT.709 de rango normal
  if (!gpuOnly) {
    const scale = h === p.srcH ? 'scale' : `scale=-2:${h}:flags=bilinear`
    a.push('-vf', `hwdownload,format=bgra,${scale}:out_color_matrix=bt709:out_range=tv,format=nv12`)
    a.push('-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv')
  }
  const rate = ['-b:v', `${mb}M`, '-maxrate', `${Math.round(mb * 1.5)}M`, '-bufsize', `${mb * 2}M`]
  const enc: Record<ClipEncoder, string[]> = {
    h264_nvenc: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', ...rate],
    h264_amf: ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'vbr_peak', ...rate],
    h264_qsv: ['-c:v', 'h264_qsv', '-preset', 'veryfast', ...rate],
    libx264: ['-c:v', 'libx264', '-preset', 'veryfast', ...rate]
  }
  a.push(...enc[p.encoder], '-g', String(p.fps * SEGMENT_SECONDS))
  // El sonido siempre a 48 kHz (llegue como llegue): así todos los trozos se juntan sin problema
  if (p.audio) a.push('-c:a', 'aac', '-b:a', '160k', '-ar', String(AUDIO_RATE))
  a.push('-f', 'segment', '-segment_time', String(SEGMENT_SECONDS), '-segment_format', 'mpegts', '-segment_wrap', String(bufferSegments(p.seconds)))
  a.push('-reset_timestamps', '0', `${p.dir.replace(/\\/g, '/')}/seg%03d.ts`)
  return a
}

/** Pantallas y salidas de audio que se pueden grabar (para Ajustes) */
export interface ClipDevices {
  /** name: el de Windows («\\.\DISPLAY2»), que es lo que se guarda */
  screens: { name: string; label: string; primary: boolean }[]
  audio: { id: string; name: string; default: boolean }[]
}

/** La lista para el «concat» de FFmpeg (rutas con / y comillas simples escapadas) */
export const concatList = (files: string[]): string => files.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n'
