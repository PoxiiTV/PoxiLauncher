import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, Info, XCircle } from 'lucide-react'
import { useStore } from '../store'
import { useT } from '../i18n'

export function Toasts(): React.JSX.Element {
  const t = useT()
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className="toast">
          {x.kind === 'success' ? (
            <CheckCircle2 size={18} color="var(--success)" />
          ) : x.kind === 'error' ? (
            <XCircle size={18} color="var(--danger)" />
          ) : (
            <Info size={18} color="var(--accent)" />
          )}
          <span>{t(x.key, x.params)}</span>
        </div>
      ))}
    </div>
  )
}

export function Modal({
  title,
  children,
  onClose,
  actions,
  wide = false,
  className = ''
}: {
  title: string
  children?: React.ReactNode
  onClose: () => void
  actions: React.ReactNode
  wide?: boolean
  /** Estilo propio de una sección (Minecraft) */
  className?: string
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Con ventanas una dentro de otra, Escape solo cierra la de arriba
      const all = document.querySelectorAll('.modal-backdrop')
      if (e.key === 'Escape' && all[all.length - 1] === ref.current) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Fuera de donde se abre: dentro de algo con backdrop-filter (la barra lateral) quedaría recortada en ese
  // hueco. En el modo sofá va dentro de él (sus estilos y la navegación con mando cuentan con ello).
  return createPortal(
    <div ref={ref} className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''} ${className}`} role="dialog" aria-modal="true">
        {title && <h2>{title}</h2>}
        {children}
        {actions && <div className="actions">{actions}</div>}
      </div>
    </div>,
    document.querySelector('.sofa') ?? document.body
  )
}
