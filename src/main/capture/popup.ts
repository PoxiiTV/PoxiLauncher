// Avisos encima del juego (una captura guardada, un clip…): una ventana transparente, que no se puede pulsar ni coger
// el foco (como el contador de FPS), abajo a la derecha. Entra, se queda unos segundos con un sonido suave y se va; si
// salen varios seguidos, van en cola. Solo existe mientras se ve (una ventana encima del juego puede quitar G-Sync).
import { app, BrowserWindow, screen } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Un aviso cualquiera encima del juego: su imagen, la línea pequeña de arriba, el título y el texto */
export interface GamePopup {
  icon: string
  kicker: string
  title: string
  desc: string
  /** El color del brillo */
  glow: string
  /** Cuánto se queda (ms) */
  ms?: number
  /** Nombre para la captura de las pruebas */
  tag?: string
}

const W = 400
const H = 104
const MARGIN = 28
const SHOW_MS = 6000
/** Pruebas: fuera de la pantalla (no molesta a quien usa el PC) y lo que pinta, a la consola */
const smoke = !app.isPackaged && !!process.env.POXI_SMOKE

const queue: GamePopup[] = []
let win: BrowserWindow | null = null
let busy = false

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function page(a: GamePopup): string {
  const glow = a.glow
  const ms = a.ms ?? SHOW_MS
  return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden;user-select:none;font-family:'Segoe UI',system-ui,sans-serif}
.t{position:absolute;inset:8px;display:flex;align-items:center;gap:14px;padding:12px 16px 12px 12px;border-radius:18px;
background:linear-gradient(135deg,rgba(18,14,32,.94),rgba(28,22,48,.94));border:1px solid rgba(255,255,255,.12);
box-shadow:0 12px 32px -8px rgba(0,0,0,.7),0 0 0 1px ${glow}33,0 0 28px -6px ${glow}88;color:#fff;
animation:in .5s cubic-bezier(.23,1,.32,1) both,out .4s cubic-bezier(.4,0,1,1) ${ms - 400}ms both}
.i{width:64px;height:64px;border-radius:12px;flex:none;background:#2a2340 center/cover;box-shadow:0 0 0 2px ${glow}}
.x{min-width:0;flex:1}
.k{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:${glow}}
.n{font-size:16px;font-weight:800;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.d{font-size:12px;opacity:.72;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@keyframes in{from{opacity:0;transform:translateY(24px) scale(.96)}to{opacity:1;transform:none}}
@keyframes out{to{opacity:0;transform:translateY(12px) scale(.98)}}
</style><div class="t"><div class="i" style="background-image:url('${esc(a.icon)}')"></div><div class="x">
<div class="k">${esc(a.kicker)}</div>
<div class="n">${esc(a.title)}</div><div class="d">${esc(a.desc)}</div></div></div>
<script>try{const c=new AudioContext();const o=c.createGain();o.gain.value=.0001;o.connect(c.destination);
[[880,0],[1318.5,.09]].forEach(([f,t])=>{const s=c.createOscillator();s.type='sine';s.frequency.value=f;s.connect(o);s.start(c.currentTime+t);s.stop(c.currentTime+t+.5)});
o.gain.exponentialRampToValueAtTime(.12,c.currentTime+.02);o.gain.exponentialRampToValueAtTime(.0001,c.currentTime+.6)}catch(e){}</script>`
}

function place(): Electron.Rectangle {
  if (smoke) return { x: -6000, y: -6000, width: W, height: H }
  // En la pantalla principal
  const b = screen.getPrimaryDisplay().bounds
  return { x: b.x + b.width - W - MARGIN, y: b.y + b.height - H - MARGIN, width: W, height: H }
}

let current: GamePopup | null = null
let timer: NodeJS.Timeout | null = null
/** Mientras juegas la ventana se queda preparada (oculta: no se dibuja encima del juego) y sale al instante */
let keep = false

function create(): BrowserWindow {
  if (!win || win.isDestroyed()) {
    win = new BrowserWindow({
      ...place(),
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, autoplayPolicy: 'no-user-gesture-required' }
    })
    win.setIgnoreMouseEvents(true)
    win.setAlwaysOnTop(true, 'screen-saver')
  }
  return win
}

async function next(): Promise<void> {
  timer = null
  const a = queue.shift()
  current = a ?? null
  if (!a) {
    if (win && !win.isDestroyed()) {
      if (keep) win.hide()
      else win.destroy()
    }
    if (!keep) win = null
    busy = false
    return
  }
  busy = true
  const w = create()
  await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page(a))}`).catch(() => undefined)
  if (w.isDestroyed()) return void next()
  w.showInactive()
  if (smoke) {
    void w.webContents
      .executeJavaScript('document.body.innerText.replace(/\\s+/g, " ")')
      .then((t) => console.log(`[${a.tag ?? 'aviso'}] aviso`, t))
      .catch(() => undefined)
    // Y cómo se ve, junto a las capturas de la prueba
    const dir = (process.env.POXI_SMOKE ?? '').split(';')[0]
    setTimeout(
      () =>
        void w.webContents
          .capturePage()
          .then((img) => writeFileSync(join(dir, `${a.tag ?? 'aviso'}-popup.png`), img.toPNG()))
          .catch(() => undefined),
      1200
    )
  }
  timer = setTimeout(() => void next(), a.ms ?? SHOW_MS)
}

/** `replace`: si lo que se ve es del mismo tipo (otra captura), se cambia ya en vez de esperar su turno */
export function showGamePopup(p: GamePopup, replace = false): void {
  if (replace && busy && timer && current?.tag === p.tag) {
    clearTimeout(timer)
    queue.unshift(p)
    return void next()
  }
  queue.push(p)
  if (!busy) void next()
}

/** Al empezar una partida: la ventana del aviso, preparada y oculta. Al acabar, fuera */
export function keepPopupReady(on: boolean): void {
  keep = on
  if (on) {
    const w = create()
    if (!busy) void w.loadURL('about:blank').catch(() => undefined)
  } else if (!busy && win && !win.isDestroyed()) {
    win.destroy()
    win = null
  }
}
