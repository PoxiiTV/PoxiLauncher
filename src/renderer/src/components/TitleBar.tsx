import { useState } from 'react'
import { Minus, Square, X, ArrowLeft } from 'lucide-react'
import { invoke } from '../api'
import { goBack, useStore } from '../store'
import { useT } from '../i18n'
import { Logo } from './Logo'
import logoIcon from '../assets/logo.svg'
import eggSound from '../assets/easter/idle2.mp3'
import eggEmoji from '../assets/easter/emoji.png'
import { Modal } from './Overlays'

export function TitleBar(): React.JSX.Element {
  const t = useT()
  const canBack = useStore((s) => s.history.length > 0)
  const [egg, setEgg] = useState(false)

  return (
    <header className="titlebar">
      <div className="brand">
        <Logo size={24} />
        <span>
          Poxi<b>Launcher</b>
        </span>
        {/* Con el estilo Minecraft (lo cambia el CSS de la zona): el logo y la letra de Minecraft */}
        <span className="brand-mc" aria-hidden>
          {/* Easter egg: el logo se puede pulsar (la barra de arriba sirve para arrastrar la ventana: él no) */}
          <img
            className="no-drag brand-egg"
            src={logoIcon}
            alt=""
            draggable={false}
            onClick={() => {
              void new Audio(eggSound).play().catch(() => undefined)
              setEgg(true)
            }}
          />
          <span>
            Poxi<b>Launcher</b>
          </span>
        </span>
      </div>
      <button className="btn btn-ghost btn-icon btn-sm no-drag" onClick={goBack} disabled={!canBack} aria-label={t('common.back')}>
        <ArrowLeft size={17} />
      </button>
      <div className="spacer" />
      {egg && (
        <Modal
          className="egg-modal"
          title=""
          onClose={() => setEgg(false)}
          actions={
            <button className="btn btn-primary" onClick={() => setEgg(false)}>
              {t('easter.close')}
            </button>
          }
        >
          <div className="egg">
            <img src={eggEmoji} alt="" draggable={false} />
            <b>{t('easter.found')}</b>
          </div>
        </Modal>
      )}
      <div className="win-controls">
        <button onClick={() => void invoke('window:minimize')} aria-label="Minimizar">
          <Minus size={16} />
        </button>
        <button onClick={() => void invoke('window:maximize')} aria-label="Maximizar">
          <Square size={13} />
        </button>
        <button className="close" onClick={() => void invoke('window:close')} aria-label="Cerrar">
          <X size={17} />
        </button>
      </div>
    </header>
  )
}
