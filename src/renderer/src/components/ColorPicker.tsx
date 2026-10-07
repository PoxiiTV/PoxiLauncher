import { useEffect, useRef, useState } from 'react'
import { Pipette } from 'lucide-react'
import { useT } from '../i18n'
import { Menu } from './Menu'
import { clamp, hexToHsv, hsvToHex, parseHex, type Hsv } from '../lib/color'

// Los últimos colores elegidos (comodidad de este PC: si no se puede guardar, no pasa nada)
const RECENT = 'poxi.recentColors'
const readRecent = (): string[] => {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT) ?? '[]') as unknown
    return Array.isArray(list) ? list.filter((c): c is string => typeof c === 'string' && !!parseHex(c)).slice(0, 8) : []
  } catch {
    return []
  }
}
const saveRecent = (hex: string): void => {
  try {
    localStorage.setItem(RECENT, JSON.stringify([hex, ...readRecent().filter((c) => c !== hex)].slice(0, 8)))
  } catch {
    /* sin almacenamiento */
  }
}

/** Medio punto de selección (px): el punto nunca se sale del cuadro ni de la barra, ni en los extremos */
const EDGE = 8
/** Dónde va el punto: a `f` (0-1) del recorrido, dejando medio punto a cada lado */
const along = (f: number): string => `calc(${EDGE}px + (100% - ${EDGE * 2}px) * ${f})`

/** Arrastrar dentro de un elemento: da la posición (0-1) mientras se mueve */
function useDrag(onMove: (x: number, y: number) => void): (e: React.PointerEvent<HTMLDivElement>) => void {
  const move = useRef(onMove)
  move.current = onMove
  return (e) => {
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const at = (ev: { clientX: number; clientY: number }): void => {
      const r = el.getBoundingClientRect()
      move.current(clamp((ev.clientX - r.left - EDGE) / (r.width - EDGE * 2)), clamp((ev.clientY - r.top - EDGE) / (r.height - EDGE * 2)))
    }
    at(e)
    const onMove = (ev: PointerEvent): void => at(ev)
    const onUp = (): void => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }
}

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> }

/**
 * Selector de color propio (el de Windows/Chromium no pega con la app): cuadro de saturación y brillo, barra de
 * tono, código hex, cuentagotas y los últimos colores usados. Se abre anclado al botón, como los menús
 */
export function ColorPicker({
  value,
  anchor,
  onChange,
  onClose
}: {
  value: string
  anchor: HTMLElement | null
  onChange: (hex: string) => void
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  // El tono se guarda aparte: con gris o negro (sin saturación) no se pierde al mover el cuadro
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(parseHex(value) ?? '#ffffff'))
  const [text, setText] = useState(value)
  const [recent] = useState(readRecent)
  const last = useRef(value)
  const Dropper = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper

  const apply = (next: Hsv): void => {
    setHsv(next)
    const hex = hsvToHex(next)
    setText(hex)
    last.current = hex
    onChange(hex)
  }
  const fromHex = (hex: string): void => {
    const h = hexToHsv(hex)
    apply(h.s === 0 ? { ...h, h: hsv.h } : h)
  }
  // Al cerrar, el color queda entre los recientes
  useEffect(() => () => saveRecent(last.current), [])

  const dragSv = useDrag((x, y) => apply({ ...hsv, s: x, v: 1 - y }))
  const dragHue = useDrag((x) => apply({ ...hsv, h: x * 360 }))
  const key = (e: React.KeyboardEvent, kind: 'sv' | 'hue'): void => {
    const step = e.shiftKey ? 0.1 : 0.02
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]
    if (!d) return
    e.preventDefault()
    if (kind === 'hue') apply({ ...hsv, h: (hsv.h + (d[0] || d[1]) * 360 + 360) % 360 })
    else apply({ ...hsv, s: clamp(hsv.s + d[0]), v: clamp(hsv.v + d[1]) })
  }
  const hueColor = hsvToHex({ h: hsv.h, s: 1, v: 1 })
  const current = hsvToHex(hsv)

  return (
    <Menu anchor={anchor} onClose={onClose} align="left" closeOnClick={false} className="color-menu">
      <div
        className="cp-sv"
        style={{ backgroundColor: hueColor }}
        onPointerDown={dragSv}
        onKeyDown={(e) => key(e, 'sv')}
        tabIndex={0}
        role="slider"
        aria-label={t('color.sv')}
        aria-valuetext={current}
      >
        <span className="cp-thumb" style={{ left: along(hsv.s), top: along(1 - hsv.v), background: current }} />
      </div>
      <div
        className="cp-hue"
        onPointerDown={dragHue}
        onKeyDown={(e) => key(e, 'hue')}
        tabIndex={0}
        role="slider"
        aria-label={t('color.hue')}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
      >
        <span className="cp-thumb" style={{ left: along(hsv.h / 360), background: hueColor }} />
      </div>
      <div className="cp-row">
        <span className="cp-now" style={{ background: current }} />
        <input
          className="input cp-hex"
          value={text}
          spellCheck={false}
          maxLength={7}
          aria-label={t('color.hex')}
          onChange={(e) => {
            setText(e.target.value)
            const hex = parseHex(e.target.value)
            if (hex && e.target.value.replace('#', '').length === 6) fromHex(hex)
          }}
          onBlur={() => {
            const hex = parseHex(text)
            if (hex) fromHex(hex)
            else setText(current)
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        {Dropper && (
          <button
            className="btn btn-icon btn-sm cp-drop"
            title={t('color.dropper')}
            aria-label={t('color.dropper')}
            onClick={() =>
              void new Dropper()
                .open()
                .then((r) => fromHex(r.sRGBHex.toLowerCase()))
                .catch(() => undefined)
            }
          >
            <Pipette size={15} />
          </button>
        )}
      </div>
      {recent.length > 0 && (
        <div className="cp-recent">
          <span className="muted">{t('color.recent')}</span>
          <div>
            {recent.map((c) => (
              <button key={c} className="cp-chip" style={{ background: c }} title={c} aria-label={c} onClick={() => fromHex(c)} />
            ))}
          </div>
        </div>
      )}
    </Menu>
  )
}
