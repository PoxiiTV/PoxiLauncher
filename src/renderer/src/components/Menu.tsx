import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const GAP = 8
const MARGIN = 10

interface Pos {
  /** Hacia abajo: su borde de arriba; hacia arriba: su borde de abajo (así, si luego crece, no tapa el botón) */
  top?: number
  bottom?: number
  left: number
  up: boolean
  maxHeight: number
  minWidth?: number
}

/**
 * Menú desplegable anclado a un botón. Se pinta encima de todo (portal) para que ningún contenedor con
 * scroll lo recorte, se abre hacia abajo o hacia arriba según el hueco y nunca se sale de la ventana.
 * Si no cabe entero, tiene su propio scroll.
 */
export function Menu({
  anchor,
  onClose,
  children,
  align = 'right',
  matchWidth = false,
  className = '',
  closeOnClick = true
}: {
  anchor: HTMLElement | null
  onClose: () => void
  children: React.ReactNode
  /** Borde del botón con el que se alinea */
  align?: 'left' | 'right'
  /** Al menos tan ancho como el botón (desplegables) */
  matchWidth?: boolean
  className?: string
  closeOnClick?: boolean
}): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<Pos | null>(null)
  const close = useRef(onClose)
  close.current = onClose

  useLayoutEffect(() => {
    const el = ref.current
    if (!anchor || !el) return
    const a = anchor.getBoundingClientRect()
    const minWidth = matchWidth ? a.width : undefined
    if (minWidth) el.style.minWidth = `${minWidth}px`
    const w = el.offsetWidth
    const h = el.scrollHeight + 2
    const top0 = (document.querySelector('.titlebar')?.getBoundingClientRect().bottom ?? 0) + MARGIN
    const spaceBelow = window.innerHeight - MARGIN - (a.bottom + GAP)
    const spaceAbove = a.top - GAP - top0
    const up = h > spaceBelow && spaceAbove > spaceBelow
    const maxHeight = Math.max(120, up ? spaceAbove : spaceBelow)
    const x = align === 'right' ? a.right - w : a.left
    const left = Math.max(MARGIN, Math.min(x, window.innerWidth - MARGIN - w))
    // Si el contenido crece después (resultados que llegan, otra pestaña), crece alejándose del botón
    setPos(up ? { bottom: window.innerHeight - (a.top - GAP), left, up, maxHeight, minWidth } : { top: a.bottom + GAP, left, up, maxHeight, minWidth })
  }, [anchor, align, matchWidth])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !anchor?.contains(t)) close.current()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close.current()
      }
    }
    // Si la página se mueve o cambia de tamaño, el menú se cierra (no se queda flotando en otro sitio);
    // el scroll dentro del propio menú no cuenta
    const onScroll = (e: Event): void => {
      if (!ref.current?.contains(e.target as Node)) close.current()
    }
    const onResize = (): void => close.current()
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [anchor])

  return createPortal(
    <div
      ref={ref}
      className={`menu floating ${pos?.up ? 'up' : 'down'} ${pos ? 'shown' : ''} ${align} ${className}`}
      style={pos ? { top: pos.top, bottom: pos.bottom, left: pos.left, maxHeight: pos.maxHeight, minWidth: pos.minWidth } : { top: 0, left: 0 }}
      role="menu"
      onClick={closeOnClick ? () => close.current() : undefined}
    >
      {children}
    </div>,
    document.body
  )
}
