import { useEffect, useState } from 'react'
import { isNewer } from '@shared/version'
import { invoke } from '../api'
import { getState, setState, updateSettings, useStore } from '../store'
import { useT } from '../i18n'
import { changesSince, majorChanges } from '../lib/changelog'
import { Logo } from './Logo'
import { offerUpdate, UPDATE_EVERY_MS } from '../lib/update'
import { Modal } from './Overlays'
import { ForcedPassword } from './Account'
import { InviteDialog } from './Invite'
import flagEs from '../assets/flags/es.png'
import flagGb from '../assets/flags/gb.png'

/** "¡Nueva versión!" al abrir la app, con descarga y reinicio. */
function UpdateDialog(): React.JSX.Element | null {
  const t = useT()
  const update = useStore((s) => s.update)
  const whatsNewOpen = useStore((s) => !!s.whatsNew)
  // Si también hay novedades, primero esas y luego esta
  if (!update || whatsNewOpen) return null
  const close = (): void => setState({ update: null })
  const downloading = update.state === 'downloading'

  return (
    <Modal
      title=""
      onClose={downloading ? () => undefined : close}
      actions={
        update.state === 'available' ? (
          <>
            <button className="btn" onClick={close}>
              {t('update.later')}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                setState({ update: { ...update, state: 'downloading', progress: 0 } })
                void invoke('system:installUpdate')
              }}
            >
              {t('update.now')}
            </button>
          </>
        ) : update.state === 'error' ? (
          <button className="btn" onClick={close}>
            {t('common.close')}
          </button>
        ) : null
      }
    >
      <div className="dialog-hero">
        <div className="dialog-logo">
          <Logo size={64} />
        </div>
        <h2>{t('update.title', { v: update.version })}</h2>
        {update.state === 'available' && <p>{t('update.text')}</p>}
        {update.state === 'error' && <p className="err-text">{t('update.error')}</p>}
        {downloading && (
          <div className="dialog-progress">
            <div className={`progress ${update.progress ? '' : 'indeterminate'}`}>
              <i style={{ transform: `scaleX(${update.progress || 1})` }} />
            </div>
            <span className="num">{t('update.downloading', { p: Math.round(update.progress * 100) })}</span>
          </div>
        )}
      </div>
    </Modal>
  )
}

/** Novedades de la versión, la primera vez que se abre tras actualizar. */
function WhatsNew(): React.JSX.Element | null {
  const t = useT()
  const lang = useStore((s) => s.settings?.lang ?? 'es')
  const range = useStore((s) => s.whatsNew)
  if (!range) return null
  // Todo lo de la versión principal (desde su X.0.0), no solo lo último
  const items = majorChanges(range.to, lang)
  if (!items.length) return null
  const close = (): void => setState({ whatsNew: null })

  return (
    <Modal
      title=""
      onClose={close}
      actions={
        <button className="btn btn-primary" onClick={close}>
          {t('whatsNew.ok')}
        </button>
      }
    >
      <div className="dialog-hero">
        <div className="dialog-logo">
          <Logo size={64} />
        </div>
        <h2>{t('whatsNew.title', { v: range.to })}</h2>
      </div>
      <ul className="news">
        {items.map((it, i) => (
          <li key={i} style={{ animationDelay: `${120 + i * 60}ms` }}>
            <span className="news-emoji">{it.emoji}</span>
            <div>
              <b>{it.title}</b>
              {it.text && <p>{it.text}</p>}
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  )
}

/** Cerrar con descargas o una instalación en curso. */
function useStartupChecks(): void {
  const ready = useStore((s) => s.ready)
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!ready || done) return
    setDone(true)
    void (async () => {
      const { version } = await invoke('app:info')
      const seen = (await invoke('settings:get')).lastSeenVersion
      if (seen && isNewer(version, seen) && changesSince(seen, version, getState().settings?.lang ?? 'es').length)
        setState({ whatsNew: { from: seen, to: version } })
      if (seen !== version) void updateSettings({ lastSeenVersion: version })
      await offerUpdate()
    })()
  }, [ready, done])
  useEffect(() => {
    if (!ready) return
    const iv = setInterval(() => void offerUpdate(), UPDATE_EVERY_MS)
    return () => clearInterval(iv)
  }, [ready])
}

/** La primera vez que se abre la app: elegir idioma (marcado ya el del PC) */
function FirstLanguage(): React.JSX.Element | null {
  const asked = useStore((s) => s.settings?.langAsked !== false)
  const [lang, setLang] = useState<'es' | 'en'>(() => (navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en'))
  // El del PC, ya aplicado detrás mientras eliges
  useEffect(() => {
    if (!asked) void updateSettings({ lang })
  }, [asked])
  if (asked) return null
  const pick = (l: 'es' | 'en'): void => {
    setLang(l)
    void updateSettings({ lang: l })
  }
  return (
    <Modal
      className="mc-modal first-lang"
      title={lang === 'es' ? 'Elige tu idioma' : 'Choose your language'}
      onClose={() => undefined}
      actions={
        <button className="mc-btn mc-btn-emerald" onClick={() => void updateSettings({ lang, langAsked: true })}>
          {lang === 'es' ? 'Continuar' : 'Continue'}
        </button>
      }
    >
      <p className="mc-hint">{lang === 'es' ? 'Puedes cambiarlo cuando quieras en Ajustes.' : 'You can change it anytime in Settings.'}</p>
      <div className="first-lang-options" role="radiogroup">
        {(['es', 'en'] as const).map((l) => (
          <button key={l} type="button" role="radio" aria-checked={lang === l} className={lang === l ? 'on' : ''} onClick={() => pick(l)}>
            <img src={l === 'es' ? flagEs : flagGb} alt="" />
            {l === 'es' ? 'Español' : 'English'}
          </button>
        ))}
      </div>
    </Modal>
  )
}

export function AppDialogs(): React.JSX.Element {
  useStartupChecks()
  return (
    <>
      <FirstLanguage />
      <WhatsNew />
      <UpdateDialog />
      <ForcedPassword />
      <InviteDialog />
    </>
  )
}
