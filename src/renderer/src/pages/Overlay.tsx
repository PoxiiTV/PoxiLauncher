import { useEffect, useMemo, useState } from 'react'
import { MessageCircle, Swords, Users, X } from 'lucide-react'
import { hotkeyLabel } from '@shared/hotkey'
import type { OverlayInfo } from '@shared/types'
import { invoke, on } from '../api'
import { useStore } from '../store'
import { useT } from '../i18n'
import { formatDuration } from '../lib/format'
import { Logo } from '../components/Logo'
import { Avatar, friendStatus } from '../components/Account'
import { UserName } from '../components/Profile'
import { inviteTo } from '../components/chat/Invite'
import { GroupIcon } from '../components/chat/Message'
import { Menu } from '../components/Menu'
import { Conversation } from './Chat'
import '../styles/overlay.css'

// El menú dentro de Minecraft: amigos (invitar) y chat, encima del juego. Se abre y se cierra con su atajo (Ajustes → Atajos), con Esc o pulsando fuera.

const close = (): void => void invoke('overlay:close')

function Panel({ icon, title, className = '', children }: { icon: React.ReactNode; title: string; className?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className={`ov-panel ${className}`}>
      <h2 className="ov-title">
        {icon} {title}
      </h2>
      {children}
    </section>
  )
}

/** Amigos: quién está y a qué juega, invitarle a tu partida o escribirle */
function FriendsPanel({ onMessage }: { onMessage: (friendId: string) => void }): React.JSX.Element {
  const t = useT()
  const friends = useStore((s) => s.account.friends)
  const me = useStore((s) => s.account.user)
  // Clic derecho en un amigo: invitar o escribirle (como en la app)
  const [menu, setMenu] = useState<{ el: HTMLElement; id: string } | null>(null)
  const sorted = useMemo(() => {
    const rank = (s: string): number => (s === 'playing' ? 0 : s === 'online' ? 1 : 2)
    return [...friends].sort((a, b) => rank(a.state) - rank(b.state) || a.username.localeCompare(b.username))
  }, [friends])
  return (
    <Panel icon={<Users size={16} />} title={t('overlay.friends')} className="ov-friends">
      {!me ? (
        <p className="ov-empty">{t('chat.signIn')}</p>
      ) : !sorted.length ? (
        <p className="ov-empty">{t('overlay.noFriends')}</p>
      ) : (
        <div className="ov-scroll">
          {sorted.map((f) => (
            <div
              key={f.id}
              className={`ov-friend ${f.state}`}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ el: e.currentTarget, id: f.id })
              }}
            >
              <Avatar name={f.username} userId={f.id} version={f.avatar} state={f.state} profile={f.profile} />
              <span className="ov-friend-text">
                <UserName name={f.username} profile={f.profile} />
                <small>{friendStatus(f, t)}</small>
              </span>
              <span className="ov-friend-actions">
                <button className="btn btn-sm btn-icon" onClick={() => void inviteTo({ friends: [f.id] })} title={t('chat.invite.button')} aria-label={t('chat.invite.button')}>
                  <Swords size={15} />
                </button>
                <button className="btn btn-sm btn-icon" onClick={() => onMessage(f.id)} title={t('chat.sendMessage')} aria-label={t('chat.sendMessage')}>
                  <MessageCircle size={15} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      {menu && (
        <Menu anchor={menu.el} onClose={() => setMenu(null)} align="left">
          <button onClick={() => void inviteTo({ friends: [menu.id] })}>
            <Swords size={16} /> {t('chat.invite.button')}
          </button>
          <button onClick={() => onMessage(menu.id)}>
            <MessageCircle size={16} /> {t('chat.sendMessage')}
          </button>
        </Menu>
      )}
    </Panel>
  )
}

/** Chat rápido: tus chats recientes y la conversación elegida (la misma que en la app) */
function ChatPanel({ chatId, setChatId }: { chatId: string | null; setChatId: (id: string) => void }): React.JSX.Element {
  const t = useT()
  const chats = useStore((s) => s.chats)
  const friends = useStore((s) => s.account.friends)
  const me = useStore((s) => s.account.user)
  const chat = chats.find((c) => c.id === chatId) ?? chats[0]
  const label = (id: string): string => {
    const c = chats.find((x) => x.id === id)!
    if (c.kind === 'group') return c.name ?? ''
    const other = c.members.find((m) => m !== me?.id)
    return friends.find((f) => f.id === other)?.username ?? '…'
  }
  return (
    <Panel icon={<MessageCircle size={16} />} title={t('overlay.chat')} className="ov-chat">
      {!chats.length ? (
        <p className="ov-empty">{t('chat.noChats')}</p>
      ) : (
        <>
          <div className="ov-chat-tabs">
            {chats.slice(0, 8).map((c) => (
              <button key={c.id} className={`ov-chat-tab ${c.id === chat?.id ? 'on' : ''}`} onClick={() => setChatId(c.id)}>
                {c.kind === 'group' ? <GroupIcon icon={c.icon} /> : null}
                <span>{label(c.id)}</span>
                {c.unread > 0 && <span className="badge num">{c.unread}</span>}
              </button>
            ))}
          </div>
          {chat && (
            <div className="ov-chat-body">
              <Conversation key={chat.id} chat={chat} />
            </div>
          )}
        </>
      )}
    </Panel>
  )
}

export function OverlayApp(): React.JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const ready = useStore((s) => s.ready)
  const [info, setInfo] = useState<OverlayInfo | null>(null)
  // Cada vez que se abre, entra con su animación
  const [shown, setShown] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [chatId, setChatId] = useState<string | null>(null)
  // Cerrado no se pinta nada: al volver a abrirlo, lo primero que se ve ya es el menú de ahora (sin parpadeo)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    void invoke('overlay:info').then(setInfo)
    return on('overlay', (e) => {
      if (e.info) setInfo(e.info)
      setVisible(e.open)
      if (e.open) {
        setShown((n) => n + 1)
        setNow(Date.now())
      }
    })
  }, [])
  // La hora y lo que llevas jugando
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 20_000)
    return () => clearInterval(iv)
  }, [])
  // Esc cierra (si no estás escribiendo: ahí Esc cancela lo que escribes)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement
      if (e.key === 'Escape' && !el.closest('textarea, input, .menu')) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // Mismo tema y color que la app
  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    root.dataset.theme = 'dark'
    root.dataset.accent = settings.accent
    root.lang = settings.lang
    root.classList.add('overlay')
  }, [settings?.accent, settings?.lang])

  // Ya pintado el menú abierto: la ventana se puede enseñar
  useEffect(() => {
    if (!visible || !ready || !settings) return
    requestAnimationFrame(() => requestAnimationFrame(() => void invoke('overlay:ready')))
  }, [visible, shown, ready, !!settings])

  if (!ready || !settings || !visible) return <></>
  const game = info?.game
  const lang = settings.lang
  return (
    <div
      className="ov-root"
      key={shown}
      // Pulsar fuera de los paneles (en el juego oscurecido) cierra
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <header className="ov-top">
        <span className="ov-brand">
          <Logo size={26} /> PoxiLauncher
          <span className="ov-beta" title={t('overlay.betaTip')}>
            {t('overlay.beta')}
          </span>
        </span>
        <span className="ov-game">
          {game ? (
            <>
              <b>{game.name}</b>
              {info?.startedAt ? <small>{t('overlay.session', { time: formatDuration((now - info.startedAt) / 1000, t) })}</small> : null}
            </>
          ) : (
            <b>{t('overlay.noGame')}</b>
          )}
        </span>
        <span className="ov-clock num">{new Date(now).toLocaleTimeString(lang === 'es' ? 'es-ES' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
        <span className="ov-hint">{t('overlay.hint', { key: hotkeyLabel(info?.hotkey ?? 'Shift+F1', lang) })}</span>
        <button className="btn btn-icon ov-close" onClick={close} aria-label={t('common.close')} title={t('common.close')}>
          <X size={18} />
        </button>
      </header>
      <div className="ov-grid">
        <FriendsPanel
          onMessage={(id) =>
            void invoke('chat:dm', id).then((c) => {
              if (c) setChatId(c.id)
            })
          }
        />
        <ChatPanel chatId={chatId} setChatId={setChatId} />
      </div>
    </div>
  )
}
