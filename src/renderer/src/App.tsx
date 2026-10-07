import { useEffect } from 'react'
import { WifiOff } from 'lucide-react'
import { useStore, goBack, goForward } from './store'
import { setZone } from './lib/zone'
import { useT } from './i18n'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { Toasts } from './components/Overlays'
import { AppDialogs } from './components/AppDialogs'
import { SettingsLayer } from './components/settings/Layer'
import { MyAccount } from './pages/MyAccount'
import { FriendProfile } from './pages/FriendProfile'
import { Minecraft } from './pages/Minecraft'
import { McInstancePage } from './pages/McInstance'
import { ChatPage, ChatToast } from './pages/Chat'

function Page(): React.JSX.Element {
  const route = useStore((s) => s.route)
  switch (route.name) {
    case 'account':
      return <MyAccount />
    case 'friend':
      return <FriendProfile key={route.id} id={route.id} />
    case 'chat':
      return <ChatPage id={route.id} />
    case 'minecraft':
      return <Minecraft />
    case 'mcInstance':
      return <McInstancePage key={route.id} id={route.id} />
  }
}

export function App(): React.JSX.Element {
  const t = useT()
  const ready = useStore((s) => s.ready)
  const settings = useStore((s) => s.settings)
  // Sin conexión con el servidor (cuentas, amigos, chat): Minecraft sigue funcionando
  const offline = useStore((s) => s.account.offline)

  // Botones laterales del ratón (y Alt + flechas): atrás / adelante, como en el navegador
  useEffect(() => {
    const onMouse = (e: MouseEvent): void => {
      if (e.button !== 3 && e.button !== 4) return
      e.preventDefault()
      if (e.button === 3) goBack()
      else goForward()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
      e.preventDefault()
      if (e.key === 'ArrowLeft') goBack()
      else goForward()
    }
    window.addEventListener('mouseup', onMouse)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mouseup', onMouse)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  // Tema y acento viven en <html>: cambiar es instantáneo (solo variables CSS). El estilo Minecraft va siempre (data-zone)
  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    root.dataset.theme = 'dark'
    root.dataset.accent = settings.accent
    root.lang = settings.lang
    setZone(true)
  }, [settings?.accent, settings?.lang])

  if (!ready || !settings) return <div className="ambient" />

  return (
    <>
      <div className="ambient" />
      <div className="app">
        <TitleBar />
        <Sidebar />
        <main className="main">
          {offline && (
            <div className="offline-bar">
              <WifiOff size={15} /> {t('common.offline')}
            </div>
          )}
          <Page />
        </main>
      </div>
      <AppDialogs />
      <SettingsLayer />
      <Toasts />
      <ChatToast />
    </>
  )
}
