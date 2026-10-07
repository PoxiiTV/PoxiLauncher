import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Globo propio con un nombre y una línea debajo (el `title` del navegador tarda en salir y no se ve bien). Sale al
 * pasar el ratón y también al pulsar (por si se toca sin ratón). Va en un portal, encima de todo: las tarjetas
 * recortan lo que se sale de ellas.
 */
export function Tip({ label, sub, className = '', children }: { label: string; sub?: string; className?: string; children: React.ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const show = (): void => {
    const r = ref.current?.getBoundingClientRect()
    // Centrado sobre el elemento, pero sin salirse de la ventana (el globo mide como mucho 240 px)
    if (r) setAt({ x: Math.min(Math.max(r.left + r.width / 2, 132), window.innerWidth - 132), y: r.top })
  }
  // Al pulsar fuera o al hacer scroll se cierra
  useEffect(() => {
    if (!at) return
    const hide = (): void => setAt(null)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('pointerdown', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('pointerdown', hide)
    }
  }, [at])
  return (
    <span
      ref={ref}
      className={className}
      aria-label={sub ? `${label}: ${sub}` : label}
      onMouseEnter={show}
      onMouseLeave={() => setAt(null)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => (at ? setAt(null) : show())}
    >
      {children}
      {at &&
        createPortal(
          <span className="tip" role="tooltip" style={{ left: at.x, top: at.y }}>
            <b>{label}</b>
            {sub && <small>{sub}</small>}
          </span>,
          document.body
        )}
    </span>
  )
}
