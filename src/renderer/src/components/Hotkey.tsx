import { useEffect, useState } from 'react'
import { Keyboard, RotateCcw } from 'lucide-react'
import { hotkeyLabel, toAccelerator } from '@shared/hotkey'
import { updateSettings, useStore } from '../store'
import { useT } from '../i18n'

type HotkeyKey = 'overlayHotkey' | 'shotHotkey'

/** El botón del atajo: se pulsa y luego la combinación que quieras (Esc o un clic fuera cancelan) */
export function HotkeyButton({
  field,
  label,
  fallback,
  onSaved
}: {
  field: HotkeyKey
  label: string
  /** El de fábrica (para volver a él) */
  fallback: string
  onSaved?: () => void
}): React.JSX.Element {
  const t = useT()
  const lang = useStore((s) => s.settings?.lang ?? 'es')
  const value = useStore((s) => s.settings?.[field]) || fallback
  const [listening, setListening] = useState(false)
  useEffect(() => {
    if (!listening) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) return setListening(false)
      const acc = toAccelerator(e)
      if (!acc) return
      void updateSettings({ [field]: acc })
      setListening(false)
      onSaved?.()
    }
    // Pulsar fuera también cancela
    const onDown = (): void => setListening(false)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown)
    }
  }, [listening, field])
  return (
    <div className="hk">
      {value !== fallback && (
        <button
          className="btn btn-ghost btn-sm btn-icon"
          onClick={() => {
            void updateSettings({ [field]: fallback })
            onSaved?.()
          }}
          title={t('settings.hotkeys.reset')}
          aria-label={t('settings.hotkeys.reset')}
        >
          <RotateCcw size={15} />
        </button>
      )}
      <button
        className={`hk-btn ${listening ? 'on' : ''}`}
        // Que el clic que lo abre no lo cierre
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setListening((v) => !v)}
        aria-label={label}
      >
        <Keyboard size={15} />
        <span className="num">{listening ? t('settings.hotkeys.press') : hotkeyLabel(value, lang)}</span>
      </button>
    </div>
  )
}
