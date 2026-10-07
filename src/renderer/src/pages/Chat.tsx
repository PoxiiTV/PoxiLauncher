import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Plate, plateRow } from '../components/Plate'
import {
  BellOff,
  Bell,
  Camera,
  Film,
  Loader2,
  Palette,
  Pin,
  Plus,
  Search,
  Send,
  Settings2,
  Smile,
  Sticker as StickerIcon,
  Swords,
  X
} from 'lucide-react'
import {
  emoteUrl,
  isGroupHead,
  mentionKey,
  plainText,
  resolveMentions,
  showMentions,
  unEmote,
  withEmotes,
  type Emote,
  type ChatInfo,
  type ChatMessage,
  type ChatSend
} from '@shared/chat'
import { invoke, on } from '../api'
import { navigate, toast, updateSettings, useStore } from '../store'
import { useT } from '../i18n'
import { Avatar } from '../components/Account'
import { UserName } from '../components/Profile'
import { attachmentKey, GroupIcon, MentionNames, Message, type Who } from '../components/chat/Message'
import { inviteTo } from '../components/chat/Invite'
import { knownEmotes, rememberEmotes } from '../lib/emotes'
import { isLight } from '../lib/color'
import { EmojiPicker, GifPicker, StickerPicker } from '../components/chat/Pickers'
import { CapturePicker } from '../components/chat/Media'
import { ChatStyleDialog, GroupDialog, GroupSettingsDialog } from '../components/chat/Dialogs'
import { ReportDialog } from '../components/Moderation'
import '../styles/chat.css'

/** Miembros del chat con su nombre que se ve, foto y perfil (tú y tus amigos) */
function useMembers(chat: ChatInfo | undefined): Map<string, Who> {
  const me = useStore((s) => s.account.user)
  const friends = useStore((s) => s.account.friends)
  const blocked = useStore((s) => s.account.blocked)
  return useMemo(() => {
    const m = new Map<string, Who>()
    if (me)
      m.set(me.id, {
        id: me.id,
        name: me.profile?.displayName || me.username,
        login: me.username,
        avatar: me.avatar,
        profile: me.profile
      })
    for (const f of friends)
      m.set(f.id, {
        id: f.id,
        name: f.username,
        login: f.realName ?? f.username,
        aliases: [f.nickname, f.profile?.displayName, f.realName].filter((x): x is string => !!x),
        avatar: f.avatar,
        profile: f.profile
      })
    // Bloqueados: ya no son amigos, pero se sabe su nombre
    for (const b of blocked ?? []) if (!m.has(b.id)) m.set(b.id, { id: b.id, name: b.username, login: b.username })
    // Del grupo pero no amigo tuyo: sin nombre conocido
    for (const id of chat?.members ?? []) if (!m.has(id)) m.set(id, { id, name: '…' })
    return m
  }, [me, friends, blocked, chat?.members])
}

/** Título y foto de un chat: el amigo (privado) o el grupo */
function useChatFace(chat: ChatInfo, members: Map<string, Who>, me: string): { title: string; who?: Who } {
  const other = chat.kind === 'dm' ? members.get(chat.members.find((x) => x !== me) ?? '') : undefined
  return {
    title: chat.kind === 'dm' ? (other?.name ?? '…') : (chat.name ?? ''),
    who: other
  }
}

function ChatRow({ chat, active, me }: { chat: ChatInfo; active: boolean; me: string }): React.JSX.Element {
  const t = useT()
  const members = useMembers(chat)
  const { title, who } = useChatFace(chat, members, me)
  const muted = useStore((s) => s.settings?.chatMuted.includes(chat.id) ?? false)
  const friend = useStore((s) => s.account.friends.find((f) => f.id === who?.id))
  // Las menciones en la vista previa, con el nombre con el que tú ves a cada uno
  const names = useMemo(() => new Map([...members.values()].filter((w) => w.login).map((w) => [w.login!.toLowerCase(), w.name])), [members])
  const last = chat.last
  const fromBlocked = useStore((s) => !!last && !!s.account.blocked?.some((b) => b.id === last.from))
  const preview = !last
    ? t('chat.empty')
    : fromBlocked
      ? t('moderation.hidden')
      : last.deleted
      ? t('chat.deleted')
      : last.kind === 'gif'
        ? 'GIF'
        : last.kind === 'sticker'
          ? t('chat.sticker')
          : last.kind === 'invite'
              ? t('chat.invite.preview')
              : last.kind === 'image' || last.kind === 'video'
                ? t(`chat.media.${last.kind}`)
                : (last.text ?? '')
  const from = last && last.from === me ? `${t('chat.you')}: ` : last && chat.kind === 'group' ? `${members.get(last.from)?.name ?? '…'}: ` : ''
  return (
    <button
      className={`cl-row ${active ? 'on' : ''} ${chat.unread ? 'unread' : ''} ${chat.kind === 'dm' ? plateRow(who?.profile) : ''}`}
      onClick={() => navigate({ name: 'chat', id: chat.id })}
    >
      {chat.kind === 'dm' && <Plate profile={who?.profile} />}
      {chat.kind === 'dm' ? (
        <Avatar name={title} userId={who?.id} version={who?.avatar} state={friend?.state} profile={who?.profile} />
      ) : (
        <GroupIcon icon={chat.icon} />
      )}
      <span className="cl-text">
        <b>{chat.kind === 'dm' ? <UserName name={title} profile={who?.profile} /> : title}</b>
        <small>
          {from}
          {plainText(showMentions(preview, names))}
        </small>
      </span>
      <span className="cl-side">
        {muted && <BellOff size={13} />}
        {chat.unread > 0 && !muted && <span className="badge num">{chat.unread > 99 ? '99+' : chat.unread}</span>}
      </span>
    </button>
  )
}

export function ChatPage({ id }: { id?: string }): React.JSX.Element {
  const t = useT()
  const me = useStore((s) => s.account.user)
  const chats = useStore((s) => s.chats)
  const friends = useStore((s) => s.account.friends)
  const [q, setQ] = useState('')
  const [dialog, setDialog] = useState<'group' | 'style' | null>(null)
  const chat = chats.find((c) => c.id === id)
  // Sin chat elegido: el último con movimiento
  useEffect(() => {
    if (!id && chats.length) navigate({ name: 'chat', id: chats[0].id })
  }, [id, chats])
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return chats
    return chats.filter((c) => {
      const names = c.kind === 'group' ? [c.name ?? ''] : c.members.map((m) => friends.find((f) => f.id === m)?.username ?? '')
      return names.some((n) => n.toLowerCase().includes(s))
    })
  }, [q, chats, friends])

  if (!me)
    return (
      <div className="page">
        <div className="empty">
          <div className="emoji">💬</div>
          <h3>{t('chat.signIn')}</h3>
        </div>
      </div>
    )

  return (
    <div className="chat-page">
      <aside className="cl">
        <div className="cl-head">
          <h2>{t('chat.title')}</h2>
          <div className="cl-head-actions">
            <button className="btn btn-sm btn-icon" onClick={() => setDialog('style')} title={t('chat.style.title')} aria-label={t('chat.style.title')}>
              <Palette size={16} />
            </button>
            <button className="btn btn-sm btn-icon" onClick={() => setDialog('group')} title={t('chat.newGroup')} aria-label={t('chat.newGroup')}>
              <Plus size={16} />
            </button>
          </div>
        </div>
        <label className="cl-search">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('chat.search')} />
        </label>
        <div className="cl-list">
          {list.map((c) => (
            <ChatRow key={c.id} chat={c} active={c.id === id} me={me.id} />
          ))}
          {!chats.length && <p className="cl-empty">{t('chat.noChats')}</p>}
        </div>
        {/* Empezar un privado con un amigo */}
        {friends.length > 0 && (
          <div className="cl-friends">
            <div className="cl-sub">{t('chat.startWith')}</div>
            <div className="cl-friends-row">
              {friends.slice(0, 12).map((f) => (
                <button
                  key={f.id}
                  className="cl-friend"
                  title={f.username}
                  onClick={async () => {
                    const c = await invoke('chat:dm', f.id).catch(() => null)
                    if (c) navigate({ name: 'chat', id: c.id })
                  }}
                >
                  <Avatar name={f.username} userId={f.id} version={f.avatar} state={f.state} profile={f.profile} />
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>
      {chat ? <Conversation key={chat.id} chat={chat} /> : <div className="cv cv-none">{t('chat.pick')}</div>}
      {dialog === 'group' && <GroupDialog onClose={() => setDialog(null)} />}
      {dialog === 'style' && <ChatStyleDialog onClose={() => setDialog(null)} />}
    </div>
  )
}

type Picker = {
  kind: 'emoji' | 'sticker' | 'gif' | 'capture'
  el: HTMLElement
} | null

export function Conversation({ chat }: { chat: ChatInfo }): React.JSX.Element {
  const t = useT()
  const meUser = useStore((s) => s.account.user)!
  const me = meUser.id
  const style = useStore((s) => s.settings?.chatStyle)
  const muted = useStore((s) => s.settings?.chatMuted.includes(chat.id) ?? false)
  const mutedList = useStore((s) => s.settings?.chatMuted ?? [])
  const members = useMembers(chat)
  const { title, who } = useChatFace(chat, members, me)
  const friend = useStore((s) => s.account.friends.find((f) => f.id === who?.id))
  const [msgs, setMsgs] = useState<ChatMessage[]>([])
  const [more, setMore] = useState(false)
  const [reporting, setReporting] = useState<ChatMessage | null>(null)
  const blocked = useStore((s) => s.account.blocked)
  const blockedIds = useMemo(() => new Set((blocked ?? []).map((b) => b.id)), [blocked])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [reply, setReply] = useState<ChatMessage | null>(null)
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const [picker, setPicker] = useState<Picker>(null)
  const [typing, setTyping] = useState<Record<string, number>>({})
  const [reads, setReads] = useState<Record<string, number>>({})
  const [showPins, setShowPins] = useState(false)
  const [groupSettings, setGroupSettings] = useState(false)
  // Con Minecraft abierto: se puede invitar a la partida desde aquí
  const inGame = useStore((s) => !!s.mc?.running)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const stick = useRef(true)
  const lastTyping = useRef(0)

  const lastId = msgs.length ? msgs[msgs.length - 1].id : 0
  const byId = useMemo(() => new Map(msgs.map((m) => [m.id, m])), [msgs])
  // Menciones que son tú: tu nombre visible y tu usuario
  const mentions = useMemo(
    () => new Set([meUser.username.toLowerCase(), ...(meUser.profile?.displayName ? [meUser.profile.displayName.toLowerCase().replace(/\s+/g, '')] : [])]),
    [meUser]
  )

  // Abrir: los últimos mensajes, lo leído y que no avise este chat mientras lo tienes delante
  useEffect(() => {
    let alive = true
    void invoke('chat:focus', chat.id)
    void invoke('chat:messages', chat.id, {}).then((r) => {
      if (!alive || !r) return
      setMsgs(r.messages)
      setMore(r.more)
      setLoading(false)
    })
    void invoke('chat:reads', chat.id).then((r) => alive && setReads(r))
    return () => {
      alive = false
      void invoke('chat:focus', null)
    }
  }, [chat.id])

  // Lo nuevo en directo: mensajes, cambios, leídos y «escribiendo…»
  const fetchNew = useCallback(async (): Promise<void> => {
    const after = msgs.length ? msgs[msgs.length - 1].id : 0
    const r = await invoke('chat:messages', chat.id, { after }).catch(() => null)
    if (r?.messages.length) setMsgs((m) => [...m, ...r.messages.filter((x) => !m.some((y) => y.id === x.id))])
  }, [chat.id, msgs])
  const fetchNewRef = useRef(fetchNew)
  fetchNewRef.current = fetchNew
  useEffect(
    () =>
      on('chatEvent', (e) => {
        if (e.chat !== chat.id) return
        if (e.what === 'chat') {
          void fetchNewRef.current()
          if (e.user) setTyping((x) => ({ ...x, [e.user!]: 0 }))
        } else if (e.what === 'chatEdit' && e.id) {
          // Recargar ese mensaje: se pide la página desde justo antes de él
          void invoke('chat:messages', chat.id, { after: e.id - 1 }).then((r) => {
            const got = r?.messages.find((x) => x.id === e.id)
            if (got) setMsgs((m) => m.map((x) => (x.id === got.id ? got : x)))
          })
        } else if (e.what === 'chatRead' && e.user && e.id)
          setReads((r) => ({
            ...r,
            [e.user!]: Math.max(r[e.user!] ?? 0, e.id!)
          }))
        else if (e.what === 'typing' && e.user) setTyping((x) => ({ ...x, [e.user!]: Date.now() }))
      }),
    [chat.id]
  )
  // «Escribiendo…» se va solo a los 6 s
  useEffect(() => {
    const iv = setInterval(
      () =>
        setTyping((x) =>
          Object.values(x).some((v) => v && Date.now() - v > 6000) ? Object.fromEntries(Object.entries(x).filter(([, v]) => v && Date.now() - v <= 6000)) : x
        ),
      1500
    )
    return () => clearInterval(iv)
  }, [])

  // Leído hasta el último (si lo estás viendo)
  useEffect(() => {
    if (!lastId) return
    const read = (): void => void invoke('chat:read', chat.id, lastId)
    if (document.hasFocus()) read()
    // Llegó con la app en segundo plano: se marca al volver a ella
    window.addEventListener('focus', read)
    return () => window.removeEventListener('focus', read)
  }, [chat.id, lastId])

  // Pegado abajo: al llegar mensajes nuevos se baja solo (si estabas abajo)
  useLayoutEffect(() => {
    const el = list.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [msgs.length, loading])
  // Los GIFs, stickers y emotes cargan después de pintar el mensaje y lo hacen más alto: si estabas abajo, se sigue abajo
  useEffect(() => {
    const el = list.current
    if (!el) return
    const onLoad = (): void => {
      if (stick.current) el.scrollTop = el.scrollHeight
    }
    el.addEventListener('load', onLoad, true)
    return () => el.removeEventListener('load', onLoad, true)
  }, [])

  const loadOlder = async (): Promise<void> => {
    if (!more || !msgs.length) return
    const el = list.current
    const before = el ? el.scrollHeight - el.scrollTop : 0
    const r = await invoke('chat:messages', chat.id, {
      before: msgs[0].id
    }).catch(() => null)
    if (!r) return
    setMore(r.more)
    setMsgs((m) => [...r.messages.filter((x) => !m.some((y) => y.id === x.id)), ...m])
    // Que no salte: se mantiene lo que estabas viendo
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - before
    })
  }

  const send = async (body: ChatSend): Promise<void> => {
    stick.current = true
    const r = await invoke('chat:send', chat.id, {
      ...body,
      ...(reply ? { reply: reply.id } : {})
    }).catch((): { message?: ChatMessage; error?: string } => ({
      error: 'offline'
    }))
    if (r.message) {
      setMsgs((m) => (m.some((x) => x.id === r.message!.id) ? m : [...m, r.message!]))
      setReply(null)
    } else
      toast({
        kind: 'error',
        key: r.error === 'limit' ? 'chat.err.limit' : r.error === 'forbidden' ? 'chat.err.forbidden' : 'chat.err.send'
      })
  }

  // Una captura o un clip: se sube (puede tardar un poco si es un clip) y se manda
  const [sharing, setSharing] = useState(false)
  const share = async (captureId: string): Promise<void> => {
    stick.current = true
    setSharing(true)
    const r = await invoke('chat:share', chat.id, captureId).catch((): { message?: ChatMessage; error?: string } => ({ error: 'offline' }))
    setSharing(false)
    if (r.message) setMsgs((m) => (m.some((x) => x.id === r.message!.id) ? m : [...m, r.message!]))
    else
      toast({
        kind: 'error',
        key:
          r.error === 'full'
            ? 'chat.media.full'
            : r.error === 'too-big'
              ? 'chat.media.tooBig'
              : r.error === 'gone'
                ? 'chat.media.missing'
                : r.error === 'limit'
                  ? 'chat.err.limit'
                  : 'chat.err.send'
      })
  }

  const submit = async (): Promise<void> => {
    // Cada :NOMBRE: que conoces pasa a su emote (y quedan como recientes)
    const known = knownEmotes()
    // @apodo, @nombre visible… pasan a @usuario, para que le llegue la mención a quien toca
    const people = [...members.values()].filter((w) => w.login).map((w) => ({ login: w.login!, names: [w.name, ...(w.aliases ?? [])] }))
    const v = withEmotes(resolveMentions(text.trim(), people), known)
    rememberEmotes(known.filter((e) => v.includes(`:${e.id}>`)))
    if (!v) return
    if (editing) {
      const m = await invoke('chat:edit', chat.id, editing.id, v).catch(() => null)
      if (m) setMsgs((list) => list.map((x) => (x.id === m.id ? m : x)))
      setEditing(null)
      setText('')
      return
    }
    setText('')
    await send({ text: v })
  }

  // Autocompletar emotes: «:ke» sugiere los que conoces que empiezan así (Tab o clic)
  const suggestFor = /(?:^|\s):([\w\-!?.']{2,40})$/.exec(text)?.[1]
  const suggestions = useMemo(() => {
    if (!suggestFor) return []
    const q = suggestFor.toLowerCase()
    return knownEmotes()
      .filter((e) => e.name.toLowerCase().startsWith(q))
      .slice(0, 8)
  }, [suggestFor])
  const complete = (e: Emote): void => {
    setText((x) => x.replace(/:([\w\-!?.']{2,40})$/, `:${e.name}: `))
    input.current?.focus()
  }
  // Autocompletar menciones: «@sa» sugiere a la gente del chat por el nombre con el que tú la ves
  const mentionFor = /(?:^|\s)@([\p{L}\p{N}_.]{1,32})$/u.exec(text)?.[1]
  const people = useMemo(() => {
    if (!mentionFor) return []
    const q = mentionKey(mentionFor)
    return [...members.values()]
      .filter((w) => w.login && w.id !== me && [w.name, w.login, ...(w.aliases ?? [])].some((n) => mentionKey(n).startsWith(q)))
      .slice(0, 8)
  }, [mentionFor, members, me])
  const mention = (w: Who): void => {
    setText((x) => x.replace(/@([\p{L}\p{N}_.]{1,32})$/u, `@${w.name.replace(/[^\p{L}\p{N}_.]/gu, '') || w.login} `))
    input.current?.focus()
  }
  const mentionNames = useMemo(() => new Map([...members.values()].filter((w) => w.login).map((w) => [w.login!.toLowerCase(), w.name])), [members])
  /** Un mensaje con emotes para editar: vuelven a :NOMBRE: (y se recuerdan, para que al guardar sigan siendo emotes) */
  const editable = (v: string): string => {
    const r = unEmote(v)
    rememberEmotes(r.emotes)
    return r.text
  }

  const onType = (v: string): void => {
    setText(v)
    // Avisar que escribes, como mucho cada 3 s
    if (v && Date.now() - lastTyping.current > 3000) {
      lastTyping.current = Date.now()
      void invoke('chat:typing', chat.id)
    }
  }

  const react = async (m: ChatMessage, e: string): Promise<void> => {
    const got = await invoke('chat:react', chat.id, m.id, e).catch(() => null)
    if (got) setMsgs((list) => list.map((x) => (x.id === got.id ? got : x)))
  }
  const jump = (mid: number): void => {
    const el = document.getElementById(`cm-${mid}`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el?.classList.add('flash')
    setTimeout(() => el?.classList.remove('flash'), 1400)
  }

  const whoTyping = Object.entries(typing)
    .filter(([id, v]) => v && id !== me)
    .map(([id]) => members.get(id)?.name ?? '…')
  // Mi último mensaje visto (privados): «Visto» debajo
  const otherId = chat.kind === 'dm' ? chat.members.find((x) => x !== me) : undefined
  const lastMine = [...msgs].reverse().find((m) => m.from === me && !m.deleted)
  const seenId = otherId && lastMine && (reads[otherId] ?? 0) >= lastMine.id ? lastMine.id : null
  const bg = style?.bg
  const bgStyle: React.CSSProperties | undefined =
    bg?.kind === 'color'
      ? {
          background: bg.colors[1] ? `linear-gradient(160deg, ${bg.colors[0]}, ${bg.colors[1]})` : bg.colors[0]
        }
      : undefined

  return (
    <section
      className={`cv layout-${style?.layout ?? 'list'} density-${style?.density ?? 'cozy'} size-${style?.size ?? 'm'} ${style?.avatars === false ? 'no-avatars' : ''} ${isLight(style?.accent ?? '') ? 'accent-light' : ''}`}
      style={{ '--chat-accent': style?.accent ?? '#9dff3f' } as React.CSSProperties}
    >
      <MentionNames.Provider value={mentionNames}>
        <header className="cv-head">
          {chat.kind === 'dm' ? (
            <button className="cv-who" onClick={() => who && navigate({ name: 'friend', id: who.id })}>
              <Avatar name={title} userId={who?.id} version={who?.avatar} state={friend?.state} profile={who?.profile} />
              <span>
                <b>
                  <UserName name={title} profile={who?.profile} />
                </b>
                <small>
                  {who && blockedIds.has(who.id)
                    ? t('moderation.blockedShort')
                    : friend?.profile?.custom
                      ? `${friend.profile.custom.emoji} ${friend.profile.custom.text}`
                      : friend?.state === 'playing'
                        ? `🎮 ${friend.gameName ?? ''}`
                        : t(friend?.state === 'offline' ? 'chat.offline' : 'chat.online')}
                  </small>
              </span>
            </button>
          ) : (
            <button className="cv-who" onClick={() => setGroupSettings(true)}>
              <GroupIcon icon={chat.icon} />
              <span>
                <b>{title}</b>
                <small>{t('chat.members', { n: chat.members.length })}</small>
              </span>
            </button>
          )}
          <div className="cv-actions">
            <button
              className={`btn btn-sm btn-icon ${showPins ? 'on' : ''}`}
              onClick={() => setShowPins((v) => !v)}
              title={t('chat.pins')}
              aria-label={t('chat.pins')}
            >
              <Pin size={16} />
              {chat.pins.length > 0 && <span className="badge num">{chat.pins.length}</span>}
            </button>
            <button
              className="btn btn-sm btn-icon"
              onClick={() =>
                void updateSettings({
                  chatMuted: muted ? mutedList.filter((x) => x !== chat.id) : [...mutedList, chat.id]
                })
              }
              title={t(muted ? 'chat.unmute' : 'chat.mute')}
              aria-label={t(muted ? 'chat.unmute' : 'chat.mute')}
            >
              {muted ? <BellOff size={16} /> : <Bell size={16} />}
            </button>
            {chat.kind === 'group' && (
              <button
                className="btn btn-sm btn-icon"
                onClick={() => setGroupSettings(true)}
                title={t('chat.groupSettings')}
                aria-label={t('chat.groupSettings')}
              >
                <Settings2 size={16} />
              </button>
            )}
          </div>
        </header>

        {showPins && (
          <div className="cv-pins">
            <div className="cv-pins-head">
              <b>
                <Pin size={14} /> {t('chat.pins')}
              </b>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setShowPins(false)} aria-label={t('common.close')}>
                <X size={15} />
              </button>
            </div>
            {!chat.pins.length && <p className="cv-pins-empty">{t('chat.noPins')}</p>}
            {[...chat.pins].reverse().map((pid) => {
              const m = byId.get(pid)
              return (
                <button key={pid} className="cv-pin" onClick={() => jump(pid)}>
                  <b>{members.get(m?.from ?? '')?.name ?? '…'}</b>
                  <span>{(m?.text ? plainText(m.text) : null) ?? (m ? t(attachmentKey(m)) : t('chat.olderPin'))}</span>
                </button>
              )
            })}
          </div>
        )}

        <div className="cv-bg" style={bgStyle} aria-hidden />

        <div
          className="cv-list"
          ref={list}
          onScroll={(e) => {
            const el = e.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
            if (el.scrollTop < 60) void loadOlder()
          }}
        >
          {more && <div className="cv-more">{t('chat.older')}</div>}
          {!loading && !msgs.length && (
            <div className="cv-start">
              {chat.kind === 'dm' ? (
                <Avatar name={title} userId={who?.id} version={who?.avatar} profile={who?.profile} className="cv-start-ava" />
              ) : (
                <GroupIcon icon={chat.icon} big />
              )}
              <h3>{chat.kind === 'dm' ? t('chat.startDm', { name: title }) : t('chat.startGroup', { name: title })}</h3>
              <p>{t('chat.startSub')}</p>
            </div>
          )}
          {msgs.map((m, i) => {
            const prev = msgs[i - 1]
            const day = !prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString()
            return (
              <div key={m.id}>
                {day && (
                  <div className="cv-day">
                    <span>
                      {new Date(m.at).toLocaleDateString(undefined, {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long'
                      })}
                    </span>
                  </div>
                )}
                <Message
                  chat={chat.id}
                  m={m}
                  who={members.get(m.from)}
                  head={isGroupHead(prev, m) || !!m.reply}
                  mine={m.from === me}
                  me={me}
                  members={members}
                  replyTo={m.reply ? byId.get(m.reply) : undefined}
                  pinned={chat.pins.includes(m.id)}
                  seen={seenId === m.id}
                  time24={style?.time24 !== false}
                  mentions={mentions}
                  onReply={(x) => {
                    setEditing(null)
                    setReply(x)
                    input.current?.focus()
                  }}
                  onEdit={(x) => {
                    setReply(null)
                    setEditing(x)
                    setText(editable(x.text ?? ''))
                    input.current?.focus()
                  }}
                  onDelete={async (x) => {
                    const got = await invoke('chat:delete', chat.id, x.id).catch(() => null)
                    if (got) setMsgs((list) => list.map((y) => (y.id === got.id ? got : y)))
                  }}
                  onReact={(x, e) => void react(x, e)}
                  onPin={(x) => void invoke('chat:pin', chat.id, x.id)}
                  onJump={jump}
                  onReport={setReporting}
                  hidden={blockedIds.has(m.from)}
                />
              </div>
            )
          })}
        </div>

        <footer className="cv-compose">
          <div className="cv-typing">
            {whoTyping.length > 0 && <span>{t(whoTyping.length === 1 ? 'chat.typingOne' : 'chat.typingMany', { name: whoTyping.join(', ') })}</span>}
          </div>
          {(reply || editing) && (
            <div className="cv-context">
              <span>
                {editing
                  ? t('chat.editing')
                  : t('chat.replyingTo', {
                      name: members.get(reply!.from)?.name ?? '…'
                    })}
                {reply && <em>{(reply.text ? plainText(reply.text, 80) : null) ?? t(attachmentKey(reply))}</em>}
              </span>
              <button
                className="btn btn-ghost btn-sm btn-icon"
                onClick={() => {
                  setReply(null)
                  if (editing) setText('')
                  setEditing(null)
                }}
                aria-label={t('common.cancel')}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {chat.kind === 'dm' && who && blockedIds.has(who.id) ? (
            <div className="cv-blocked">
              <span>{t('moderation.blockedDm', { name: who.name })}</span>
              <button
                className="btn btn-sm"
                onClick={async () => {
                  const r = await invoke('account:unblock', who.id).catch(() => ({ ok: false }))
                  toast(r.ok ? { kind: 'info', key: 'moderation.unblocked', params: { name: who.name } } : { kind: 'error', key: 'account.err.offline' })
                }}
              >
                {t('moderation.unblock')}
              </button>
            </div>
          ) : (
            <div className="cv-boxwrap">
              {people.length > 0 && (
                <div className="cv-suggest" role="listbox">
                  {people.map((w) => (
                    <button key={w.id} role="option" onMouseDown={(ev) => ev.preventDefault()} onClick={() => mention(w)}>
                      <Avatar name={w.name} userId={w.id} version={w.avatar} profile={w.profile} />
                      <UserName name={w.name} profile={w.profile} />
                    </button>
                  ))}
                  <span className="cv-suggest-hint">Tab</span>
                </div>
              )}
              {!people.length && suggestions.length > 0 && (
                <div className="cv-suggest" role="listbox">
                  {suggestions.map((e) => (
                    <button key={e.id} role="option" onMouseDown={(ev) => ev.preventDefault()} onClick={() => complete(e)}>
                      <img src={emoteUrl(e.id, 1)} alt="" />
                      {e.name}
                    </button>
                  ))}
                  <span className="cv-suggest-hint">Tab</span>
                </div>
              )}
              <div className="cv-box">
                {inGame && (
                  <button
                    className="cv-tool cv-invite"
                    onClick={async () => {
                      stick.current = true
                      if (await inviteTo({ chats: [chat.id] })) void fetchNew()
                    }}
                    title={t('chat.invite.button')}
                    aria-label={t('chat.invite.button')}
                  >
                    <Swords size={19} />
                  </button>
                )}
                <textarea
                  ref={input}
                  rows={1}
                  value={text}
                  maxLength={4000}
                  placeholder={chat.kind === 'dm' ? t('chat.placeholderDm', { name: title }) : t('chat.placeholderGroup', { name: title })}
                  onChange={(e) => onType(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Tab' && (suggestions.length || people.length)) {
                      e.preventDefault()
                      if (people.length) mention(people[0])
                      else complete(suggestions[0])
                    } else if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void submit()
                    } else if (e.key === 'Escape') {
                      setReply(null)
                      if (editing) setText('')
                      setEditing(null)
                    } else if (e.key === 'ArrowUp' && !text) {
                      // Como en Discord: flecha arriba edita tu último mensaje
                      const mine = [...msgs].reverse().find((m) => m.from === me && m.text && !m.deleted)
                      if (mine) {
                        e.preventDefault()
                        setEditing(mine)
                        setText(editable(mine.text!))
                      }
                    }
                  }}
                  onInput={(e) => {
                    const el = e.currentTarget
                    el.style.height = 'auto'
                    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
                  }}
                />
                <button
                  className={`cv-tool ${sharing ? 'busy' : ''}`}
                  disabled={sharing}
                  onClick={(e) => setPicker({ kind: 'capture', el: e.currentTarget })}
                  title={t('chat.media.pick')}
                  aria-label={t('chat.media.pick')}
                >
                  {sharing ? <Loader2 size={19} className="spin" /> : <Camera size={19} />}
                </button>
                <button className="cv-tool" onClick={(e) => setPicker({ kind: 'gif', el: e.currentTarget })} title="GIF" aria-label="GIF">
                  <Film size={19} />
                </button>
                <button
                  className="cv-tool"
                  onClick={(e) => setPicker({ kind: 'sticker', el: e.currentTarget })}
                  title={t('chat.stickers')}
                  aria-label={t('chat.stickers')}
                >
                  <StickerIcon size={19} />
                </button>
                <button
                  className="cv-tool"
                  onClick={(e) => setPicker({ kind: 'emoji', el: e.currentTarget })}
                  title={t('chat.emoji')}
                  aria-label={t('chat.emoji')}
                >
                  <Smile size={19} />
                </button>
                <button className="cv-send" disabled={!text.trim()} onClick={() => void submit()} aria-label={t('chat.send')} title={t('chat.send')}>
                  <Send size={17} />
                </button>
              </div>
            </div>
          )}
        </footer>

        {reporting && (
          <ReportDialog user={{ id: reporting.from, name: members.get(reporting.from)?.name ?? '…' }} message={{ chat: chat.id, id: reporting.id }} onClose={() => setReporting(null)} />
        )}

        {picker?.kind === 'emoji' && (
          <EmojiPicker
            anchor={picker.el}
            onPick={(e) => {
              setText((x) => x + e)
              input.current?.focus()
            }}
            onEmote={(e) => {
              setText((x) => `${x}${x && !/\s$/.test(x) ? ' ' : ''}:${e.name}: `)
              input.current?.focus()
            }}
            onClose={() => setPicker(null)}
          />
        )}
        {picker?.kind === 'sticker' && (
          <StickerPicker
            anchor={picker.el}
            onPick={(s) => {
              setPicker(null)
              void send({ sticker: s })
            }}
            onClose={() => setPicker(null)}
          />
        )}
        {picker?.kind === 'gif' && (
          <GifPicker
            anchor={picker.el}
            onPick={(g) => {
              setPicker(null)
              void send({ gif: g })
            }}
            onClose={() => setPicker(null)}
          />
        )}
        {picker?.kind === 'capture' && (
          <CapturePicker
            anchor={picker.el}
            onPick={(c) => {
              setPicker(null)
              void share(c.id)
            }}
            onClose={() => setPicker(null)}
          />
        )}
        {groupSettings && chat.kind === 'group' && <GroupSettingsDialog chat={chat} onClose={() => setGroupSettings(false)} />}
      </MentionNames.Provider>
    </section>
  )
}

/** El aviso de un mensaje nuevo con la app a la vista (como Discord): pulsarlo abre el chat */
export function ChatToast(): React.JSX.Element | null {
  const c = useStore((s) => s.chatToast)
  const route = useStore((s) => s.route)
  const friend = useStore((s) => s.account.friends.find((f) => f.id === s.chatToast?.from))
  if (!c || (route.name === 'chat' && route.id === c.chat)) return null
  return (
    <button key={c.key} className="chat-toast" onClick={() => navigate({ name: 'chat', id: c.chat })}>
      <Avatar name={c.title} userId={friend?.id} version={friend?.avatar} profile={friend?.profile} />
      <span>
        <b>{c.title}</b>
        <small>{c.text}</small>
      </span>
    </button>
  )
}
