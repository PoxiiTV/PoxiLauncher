import { Box, CircleUserRound, MessageCircle, Settings } from 'lucide-react'
import type { Route } from '../store'
import { navigate, openSettings, useStore } from '../store'
import { useT } from '../i18n'
import { Avatar, FriendsPanel } from './Account'
import { UserName } from './Profile'

export function Sidebar(): React.JSX.Element {
  const t = useT()
  const route = useStore((s) => s.route.name)
  const me = useStore((s) => s.account.user)
  // Mensajes sin leer (sin contar los chats silenciados)
  const unread = useStore((s) => s.chats.reduce((n, c) => n + (s.settings?.chatMuted.includes(c.id) ? 0 : c.unread), 0))
  const offline = useStore((s) => s.account.offline)
  // Jugando a Minecraft: tu estado lo dice (la instancia abierta)
  const playingName = useStore((s) => (s.mc?.running ? (s.mc.instances.find((i) => i.id === s.mc!.running)?.name ?? 'Minecraft') : ''))
  const playing = !!playingName
  // Mi cuenta, como en Discord: con sesión, tu foto, tu nombre y tu estado debajo; sin sesión, "Mi cuenta"
  const accountItem = (): React.JSX.Element =>
    me ? (
    <button
      key="account"
      className={`nav-item nav-me ${route === 'account' ? 'active' : ''}`}
      onClick={() => navigate({ name: 'account' })}
      title={t('nav.account')}
    >
      <Avatar
        name={me.username}
        userId={me.id}
        version={me.avatar}
        state={offline ? 'offline' : playing ? 'playing' : 'online'}
        profile={me.profile}
        className="nav-avatar"
      />
      <span className="nav-me-text">
        <b>
          <UserName name={me.profile?.displayName || me.username} profile={me.profile} />
        </b>
        <small className={offline ? 'off' : playing ? 'playing' : 'on'}>
          {offline
            ? t('account.page.stateOffline')
            : playing
              ? t('account.page.statePlaying', { game: playingName })
              : me.profile?.custom
                ? `${me.profile.custom.emoji} ${me.profile.custom.text}`.trim()
                : t('account.page.stateOnline')}
        </small>
      </span>
    </button>
  ) : (
    item('account', CircleUserRound)
  )

  // Dentro de una instancia de Minecraft sigue marcada la sección Minecraft
  const section = route === 'mcInstance' ? 'minecraft' : route
  const settingsOpen = useStore((s) => !!s.settingsOpen)
  const item = (name: Route['name'], Icon: typeof Box, badge?: number): React.JSX.Element => (
    <button
      key={name}
      data-nav={name}
      className={`nav-item ${section === name ? 'active' : ''}`}
      onClick={() => navigate({ name } as Route)}
    >
      <Icon size={19} />
      {t(`nav.${name}`)}
      {!!badge && <span className="badge num">{badge}</span>}
    </button>
  )

  return (
    <nav className="sidebar">
      {item('minecraft', Box)}
      {item('chat', MessageCircle, unread)}
      <FriendsPanel />
      {/* Ajustes no es una página: es una capa a pantalla completa por encima de todo */}
      <button data-nav="settings" className={`nav-item ${settingsOpen ? 'active' : ''}`} onClick={() => openSettings()}>
        <Settings size={19} />
        {t('nav.settings')}
      </button>
      {/* Tu cuenta abajo del todo, como en Discord */}
      {accountItem()}
    </nav>
  )
}
