import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Menu } from './Menu'

export interface Option<T extends string | number> {
  value: T
  label: string
}

/**
 * Desplegable propio (sustituye al <select> del sistema, que no sigue el diseño de la app).
 * Ratón o teclado: ↑/↓ para moverse, Enter/Espacio para elegir y Escape para cerrar.
 */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  prefix,
  className = '',
  menuClassName = ''
}: {
  value: T
  options: Option<T>[]
  onChange: (v: T) => void
  disabled?: boolean
  ariaLabel?: string
  /** Texto delante del valor en el botón ("Plataforma: PC"); la lista enseña solo los valores */
  prefix?: string
  className?: string
  /** Clase extra para la lista desplegable (se pinta fuera, encima de todo) */
  menuClassName?: string
}): React.JSX.Element {
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(0)
  const current = options.find((o) => o.value === value) ?? options[0]

  // Al abrir: resaltar y enseñar lo que ya está elegido
  useEffect(() => {
    if (!open) return
    const i = Math.max(0, options.findIndex((o) => o.value === value))
    setHover(i)
    requestAnimationFrame(() => list.current?.children[i]?.scrollIntoView({ block: 'nearest' }))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (v: T): void => {
    setOpen(false)
    if (v !== value) onChange(v)
    btn.current?.focus()
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (disabled) return
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault()
      setOpen(true)
      return
    }
    if (!open) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = (hover + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
      setHover(n)
      list.current?.children[n]?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(options[hover].value)
    } else if (e.key === 'Tab') setOpen(false)
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`select ${open ? 'open' : ''} ${className}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? prefix}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
      >
        <span className="select-value">
          {prefix && <span className="select-prefix">{prefix}: </span>}
          {current?.label}
        </span>
        <ChevronDown size={16} className="select-chevron" />
      </button>
      {open && (
        <Menu anchor={btn.current} onClose={() => setOpen(false)} align="left" matchWidth closeOnClick={false} className={`select-menu ${menuClassName}`}>
          <div ref={list} role="listbox" aria-label={ariaLabel}>
            {options.map((o, i) => (
              <button
                key={String(o.value)}
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={`${o.value === value ? 'selected' : ''} ${i === hover ? 'hover' : ''}`}
                onMouseEnter={() => setHover(i)}
                onClick={() => pick(o.value)}
              >
                <span>{o.label}</span>
                {o.value === value && <Check size={15} strokeWidth={3} />}
              </button>
            ))}
          </div>
        </Menu>
      )}
    </>
  )
}
