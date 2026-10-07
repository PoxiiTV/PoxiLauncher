import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Info } from 'lucide-react'
import type { Settings } from '@shared/types'
import { updateSettings, useStore } from '../../store'
import { useT } from '../../i18n'

// Las piezas de Ajustes (la capa): filas de una línea con su control a la derecha, agrupadas en tarjetas; lo que
// depende de otra opción va dentro de una tarjeta que se despliega; lo técnico, detrás de una (i).

/** La (i): un globo con el detalle técnico, que se abre al pulsar (no solo con el ratón encima: también con mando) */
export function InfoTip({ text }: { text: string }): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: Event): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', off)
    window.addEventListener('keydown', esc, true)
    return () => {
      window.removeEventListener('mousedown', off)
      window.removeEventListener('keydown', esc, true)
    }
  }, [open])
  return (
    <span ref={ref} className={`pf-info ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="pf-info-btn"
        aria-label={t('prefs.more')}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        <Info size={15} />
      </button>
      <span className="pf-pop" role="tooltip">
        {text}
      </span>
    </span>
  )
}

/** «✓ Guardado» un momento junto al control, al cambiar algo que no es un interruptor */
export function useSaved(): [boolean, () => void] {
  const [on, setOn] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return [
    on,
    () => {
      setOn(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setOn(false), 1400)
    }
  ]
}

export function Saved({ on }: { on: boolean }): React.JSX.Element {
  const t = useT()
  return (
    <span className={`pf-saved ${on ? 'show' : ''}`} aria-live="polite">
      <Check size={13} strokeWidth={3} />
      {on ? t('prefs.saved') : ''}
    </span>
  )
}

interface RowText {
  /** Para el buscador: saltar a esta fila */
  id: string
  label: string
  help?: React.ReactNode
  info?: string
  pill?: React.ReactNode
}

function Text({ label, help, info, pill }: Omit<RowText, 'id'>): React.JSX.Element {
  return (
    <div className="pf-text">
      <div className="pf-label">
        <span>{label}</span>
        {pill}
        {info && <InfoTip text={info} />}
      </div>
      {help && <div className="pf-help">{help}</div>}
    </div>
  )
}

/** Una fila: el texto a la izquierda y el control a la derecha (block: el control debajo, a todo el ancho) */
export function Row({ id, label, help, info, pill, block = false, children }: RowText & { block?: boolean; children?: React.ReactNode }): React.JSX.Element {
  return (
    <div className={`pf-row ${block ? 'block' : ''}`} data-row={id}>
      <Text label={label} help={help} info={info} pill={pill} />
      {children && <div className="pf-ctl">{children}</div>}
    </div>
  )
}

type BoolKey = { [K in keyof Settings]-?: Settings[K] extends boolean | undefined ? K : never }[keyof Settings]

export function Switch({ on, label, disabled = false, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      className={`toggle ${on ? 'on' : ''}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onChange()
      }}
    />
  )
}

/** Un interruptor de Ajustes: la fila entera se pulsa (disabled + note: depende de otra opción que está apagada) */
export function ToggleRow({ id, field, label, help, info, pill, disabled = false, note }: RowText & { field: BoolKey; disabled?: boolean; note?: string }): React.JSX.Element {
  const on = useStore((s) => !!s.settings?.[field])
  const flip = (): void => void updateSettings({ [field]: !on } as Partial<Settings>)
  return (
    <div
      className={`pf-row pf-click ${disabled ? 'off' : ''}`}
      data-row={id}
      onClick={() => !disabled && flip()}
    >
      <Text label={label} help={disabled && note ? note : help} info={info} pill={pill} />
      <div className="pf-ctl">
        <Switch on={on && !disabled} label={label} disabled={disabled} onChange={flip} />
      </div>
    </div>
  )
}

/** Botones juntos para elegir una de pocas opciones */
export function Seg<T extends string | number>({ value, options, label, onChange }: { value: T; options: { value: T; label: React.ReactNode }[]; label: string; onChange: (v: T) => void }): React.JSX.Element {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" className={value === o.value ? 'on' : ''} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Una tarjeta con filas (separadas por una línea fina) */
export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return <div className={`pf-card ${className}`}>{children}</div>
}

/** Un grupo: su título pequeño, sus tarjetas y, si hace falta, una nota al pie */
export function Group({ title, foot, children }: { title?: string; foot?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="pf-group">
      {title && <h3 className="pf-gh">{title}</h3>}
      <div className="pf-stack">{children}</div>
      {foot && (
        <p className="pf-foot">
          <Info size={14} />
          <span>{foot}</span>
        </p>
      )}
    </section>
  )
}

/**
 * Una tarjeta que se despliega (como en Windows 11): el interruptor en la cabecera y, dentro, lo que depende de él.
 * Encendida enseña sus opciones (se pueden plegar con la flecha); apagada, solo la cabecera. `summary` resume lo de
 * dentro en una línea cuando está encendida; `status`, una píldora con el estado en vivo.
 */
export function Expander({
  id,
  field,
  label,
  help,
  info,
  summary,
  status,
  disabled = false,
  note,
  children
}: RowText & {
  field: BoolKey
  summary?: React.ReactNode
  status?: React.ReactNode
  disabled?: boolean
  note?: string
  children: React.ReactNode
}): React.JSX.Element {
  const on = useStore((s) => !!s.settings?.[field]) && !disabled
  const [folded, setFolded] = useState(false)
  const open = on && !folded
  const flip = (): void => void updateSettings({ [field]: !on } as Partial<Settings>)
  return (
    <div className={`pf-xp ${open ? 'open' : ''}`} data-row={id}>
      <div className={`pf-row pf-click ${disabled ? 'off' : ''}`} onClick={() => !disabled && flip()}>
        <Text label={label} help={disabled && note ? note : on && summary ? summary : help} info={info} />
        <div className="pf-ctl">
          {on && status}
          {on && (
            <button
              type="button"
              className="pf-chev"
              aria-expanded={open}
              aria-label={label}
              onClick={(e) => {
                e.stopPropagation()
                setFolded((f) => !f)
              }}
            >
              <ChevronDown size={18} />
            </button>
          )}
          <Switch on={on} label={label} disabled={disabled} onChange={flip} />
        </div>
      </div>
      <div className="pf-dep" aria-hidden={!open}>
        <div className="pf-dep-in">{open && <div className="pf-kids">{children}</div>}</div>
      </div>
    </div>
  )
}

/** Opciones que dependen de una fila de dentro de una tarjeta (sangría y línea de color) */
export function Nested({ show, children }: { show: boolean; children: React.ReactNode }): React.JSX.Element | null {
  return show ? <div className="pf-nest">{children}</div> : null
}
