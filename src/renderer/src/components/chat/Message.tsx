import { createContext, memo, useContext, useState } from 'react'
import { Flag, Pencil, Pin, Reply, SmilePlus, Trash2 } from 'lucide-react'
import {
  asEmote,
  emoteUrl,
  onlyEmoji,
  packStickerUrl,
  parseInline,
  parseMessage,
  plainText,
  userStickerUrl,
  QUICK_REACTIONS,
  type ChatMessage,
  type Inline
} from '@shared/chat'
import type { UserProfile } from '@shared/profile'
import { useStore } from '../../store'
import { useT } from '../../i18n'
import { Avatar } from '../Account'
import { UserName } from '../Profile'
import { EmojiPicker } from './Pickers'
import { InviteCard } from './Invite'
import { MediaView } from './Media'

/** Lo que lleva un mensaje sin texto, en corto (citas, fijados, «respondiendo a…») */
export const attachmentKey = (m: Pick<ChatMessage, 'gif' | 'sticker' | 'invite' | 'media'>): string =>
  m.gif ? 'chat.gif' : m.sticker ? 'chat.sticker' : m.invite ? 'chat.invite.preview' : m.media ? `chat.media.${m.media.kind}` : 'chat.gif'

/** Quién es cada miembro del chat (nombre que se ve, foto, perfil) */
export interface Who {
  id: string
  name: string
  /** Su usuario real (las menciones van con él) y otros nombres con los que lo puedes llamar */
  login?: string
  aliases?: string[]
  avatar?: string | null
  profile?: UserProfile
}

/** Texto con formato: cada trozo con su etiqueta (nunca HTML) */
/** El icono de un grupo: un emoji o un emote de la app (como imagen) */
export function GroupIcon({ icon, big = false }: { icon: string | null | undefined; big?: boolean }): React.JSX.Element {
  const e = asEmote(icon)
  return (
    <span className={`cl-group-icon ${big ? 'big' : ''}`}>
      {e ? <img src={emoteUrl(e.id, big ? 4 : 2)} alt={e.name} draggable={false} /> : icon || '👥'}
    </span>
  )
}

/** usuario (minúsculas) → el nombre con el que tú ves a esa persona: las menciones se pintan así */
export const MentionNames = createContext<Map<string, string>>(new Map())

function InlineView({ parts, mentions }: { parts: Inline[]; mentions: Set<string> }): React.JSX.Element {
  const names = useContext(MentionNames)
  const [open, setOpen] = useState<number[]>([])
  return (
    <>
      {parts.map((p, i) => {
        switch (p.t) {
          case 'text':
            return <span key={i}>{p.v}</span>
          case 'code':
            return (
              <code key={i} className="cm-code">
                {p.v}
              </code>
            )
          case 'emote':
            return (
              <img
                key={i}
                className="cm-emote"
                src={emoteUrl(p.id, 2)}
                srcSet={`${emoteUrl(p.id, 4)} 2x`}
                alt={`:${p.name}:`}
                title={`:${p.name}:`}
                draggable={false}
              />
            )
          case 'mention':
            return (
              <span key={i} className={`cm-mention ${mentions.has(p.v.toLowerCase()) ? 'me' : ''}`}>
                @{names.get(p.v.toLowerCase()) ?? p.v}
              </span>
            )
          case 'bold':
            return (
              <b key={i}>
                <InlineView parts={p.c} mentions={mentions} />
              </b>
            )
          case 'italic':
            return (
              <em key={i}>
                <InlineView parts={p.c} mentions={mentions} />
              </em>
            )
          case 'under':
            return (
              <u key={i}>
                <InlineView parts={p.c} mentions={mentions} />
              </u>
            )
          case 'strike':
            return (
              <s key={i}>
                <InlineView parts={p.c} mentions={mentions} />
              </s>
            )
          case 'spoiler':
            return (
              <button key={i} className={`spoiler ${open.includes(i) ? 'open' : ''}`} onClick={() => setOpen((o) => [...o, i])}>
                <InlineView parts={p.c} mentions={mentions} />
              </button>
            )
        }
      })}
    </>
  )
}

export function MessageText({ text, mentions }: { text: string; mentions: Set<string> }): React.JSX.Element {
  if (onlyEmoji(text))
    return (
      <div className="cm-text cm-jumbo">
        <InlineView parts={parseInline(text.trim())} mentions={mentions} />
      </div>
    )
  return (
    <div className="cm-text">
      {parseMessage(text).map((b, i) =>
        b.t === 'code' ? (
          <pre key={i} className="cm-pre">
            {b.v}
          </pre>
        ) : b.t === 'quote' ? (
          <blockquote key={i} className="cm-quote">
            <InlineView parts={b.c} mentions={mentions} />
          </blockquote>
        ) : (
          <p key={i}>
            <InlineView parts={b.c} mentions={mentions} />
          </p>
        )
      )}
    </div>
  )
}

const stickerSrc = (m: ChatMessage): string | null =>
  m.sticker?.kind === 'pack'
    ? packStickerUrl(m.sticker.code)
    : m.sticker?.kind === 'klipy'
      ? m.sticker.url
      : m.sticker?.kind === 'user'
        ? userStickerUrl(m.sticker.owner, m.sticker.id)
        : null

export interface MessageProps {
  /** El chat (para sus capturas y clips) */
  chat: string
  m: ChatMessage
  who: Who | undefined
  head: boolean
  mine: boolean
  me: string
  members: Map<string, Who>
  replyTo: ChatMessage | undefined
  pinned: boolean
  seen: boolean
  time24: boolean
  mentions: Set<string>
  onReply: (m: ChatMessage) => void
  onEdit: (m: ChatMessage) => void
  onDelete: (m: ChatMessage) => void
  onReact: (m: ChatMessage, emoji: string) => void
  onPin: (m: ChatMessage) => void
  onJump: (id: number) => void
  /** Denunciar el mensaje (solo los de otros) */
  onReport: (m: ChatMessage) => void
  /** Es de alguien que has bloqueado: sale oculto hasta que pulses «Ver» */
  hidden: boolean
}

export const Message = memo(function Message({
  chat,
  m,
  who,
  head,
  mine,
  me,
  members,
  replyTo,
  pinned,
  seen,
  time24,
  mentions,
  onReply,
  onEdit,
  onDelete,
  onReact,
  onPin,
  onJump,
  onReport,
  hidden
}: MessageProps): React.JSX.Element {
  const t = useT()
  const lang = useStore((s) => s.settings?.lang ?? 'es')
  const [picking, setPicking] = useState<HTMLElement | null>(null)
  const [shown, setShown] = useState(false)
  const time = new Date(m.at).toLocaleTimeString(lang === 'es' ? 'es-ES' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: !time24 })
  const name = who?.name ?? '…'
  const sticker = stickerSrc(m)
  // Te mencionan: se resalta como en Discord
  const mentionsMe = !mine && !!m.text && [...mentions].some((n) => m.text!.toLowerCase().includes(`@${n}`))
  return (
    <div id={`cm-${m.id}`} className={`cm ${head ? 'head' : ''} ${mine ? 'mine' : ''} ${mentionsMe ? 'mentioned' : ''} ${m.deleted ? 'deleted' : ''}`}>
      {head ? (
        <span className="cm-ava">
          <Avatar name={name} userId={who?.id} version={who?.avatar} profile={who?.profile} />
        </span>
      ) : (
        <span className="cm-time-side num">{time}</span>
      )}
      <div className="cm-body">
        {replyTo && (
          <button className="cm-replyto" onClick={() => onJump(replyTo.id)}>
            <Reply size={12} />
            <b>{members.get(replyTo.from)?.name ?? '…'}</b>
            <span>{replyTo.deleted ? t('chat.deleted') : replyTo.text ? plainText(replyTo.text, 90) : t(attachmentKey(replyTo))}</span>
          </button>
        )}
        {head && (
          <div className="cm-meta">
            <b className="cm-name">
              <UserName name={name} profile={who?.profile} />
            </b>
            <span className="cm-time num">{time}</span>
            {pinned && <Pin size={11} className="cm-pinned" aria-label={t('chat.pinned')} />}
          </div>
        )}
        <div className="cm-content">
          {m.deleted ? (
            <div className="cm-text cm-gone">{t('chat.deleted')}</div>
          ) : hidden && !shown ? (
            <div className="cm-text cm-gone">
              {t('moderation.hidden')}{' '}
              <button className="link-btn" onClick={() => setShown(true)}>
                {t('moderation.show')}
              </button>
            </div>
          ) : (
            <>
              {m.text && <MessageText text={m.text} mentions={mentions} />}
              {m.gif && <img className="cm-gif" src={m.gif.url} alt="GIF" loading="lazy" style={{ aspectRatio: `${m.gif.w} / ${m.gif.h}` }} />}
              {sticker && <img className="cm-sticker" src={sticker} alt={t('chat.sticker')} loading="lazy" />}
              {m.invite && <InviteCard m={m} mine={mine} name={name} />}
              {m.media && <MediaView chat={chat} media={m.media} />}
              {m.edited && <span className="cm-edited">{t('chat.edited')}</span>}
            </>
          )}
        </div>
        {m.reactions && (
          <div className="cm-reactions">
            {Object.entries(m.reactions).map(([e, ids]) => (
              <button
                key={e}
                className={`cm-reaction ${ids.includes(me) ? 'on' : ''}`}
                onClick={() => onReact(m, e)}
                title={ids.map((id) => (id === me ? t('chat.you') : (members.get(id)?.name ?? '…'))).join(', ')}
              >
                <span>{e}</span> <b className="num">{ids.length}</b>
              </button>
            ))}
          </div>
        )}
        {seen && <div className="cm-seen">{t('chat.seen')}</div>}
      </div>
      {!m.deleted && (
        <div className="cm-tools" role="toolbar">
          {QUICK_REACTIONS.slice(0, 4).map((e) => (
            <button key={e} className="cm-tool emoji" onClick={() => onReact(m, e)} aria-label={e}>
              {e}
            </button>
          ))}
          <button className="cm-tool" onClick={(e) => setPicking(e.currentTarget)} aria-label={t('chat.react')} title={t('chat.react')}>
            <SmilePlus size={16} />
          </button>
          <button className="cm-tool" onClick={() => onReply(m)} aria-label={t('chat.reply')} title={t('chat.reply')}>
            <Reply size={16} />
          </button>
          <button className={`cm-tool ${pinned ? 'on' : ''}`} onClick={() => onPin(m)} aria-label={t('chat.pin')} title={t(pinned ? 'chat.unpin' : 'chat.pin')}>
            <Pin size={16} />
          </button>
          {mine && m.text && (
            <button className="cm-tool" onClick={() => onEdit(m)} aria-label={t('chat.edit')} title={t('chat.edit')}>
              <Pencil size={16} />
            </button>
          )}
          {mine ? (
            <button className="cm-tool danger" onClick={() => onDelete(m)} aria-label={t('chat.delete')} title={t('chat.delete')}>
              <Trash2 size={16} />
            </button>
          ) : (
            <button className="cm-tool danger" onClick={() => onReport(m)} aria-label={t('moderation.reportMessage')} title={t('moderation.reportMessage')}>
              <Flag size={16} />
            </button>
          )}
        </div>
      )}
      {picking && (
        <EmojiPicker
          anchor={picking}
          onPick={(e) => {
            onReact(m, e)
            setPicking(null)
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  )
})
