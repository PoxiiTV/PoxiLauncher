import { useRef, useState } from 'react'
import { Check, LogOut, Palette, Swords, UserMinus, UserPlus } from 'lucide-react'
import { Plate, plateRow } from '../Plate'
import type { ChatInfo } from '@shared/chat'
import type { ChatStyle } from '@shared/types'
import { invoke } from '../../api'
import { navigate, toast, updateSettings, useStore } from '../../store'
import { useT } from '../../i18n'
import { Avatar } from '../Account'
import { UserName } from '../Profile'
import { Modal } from '../Overlays'
import { ColorPicker } from '../ColorPicker'
import { EmojiPicker } from './Pickers'
import { GroupIcon } from './Message'
import { emoteToken } from '@shared/chat'
import { inviteTo } from './Invite'

/** Emoji del grupo: con nuestro selector (nada del de Windows) */
function IconPick({ value, onChange }: { value: string; onChange: (v: string) => void }): React.JSX.Element {
  const t = useT()
  const [el, setEl] = useState<HTMLElement | null>(null)
  return (
    <>
      <button className="cd-icon" onClick={(e) => setEl(e.currentTarget)} title={t('chat.groupIcon')} aria-label={t('chat.groupIcon')}>
        <GroupIcon icon={value} />
      </button>
      {el && (
        <EmojiPicker
          anchor={el}
          onPick={(e) => {
            onChange(e)
            setEl(null)
          }}
          // También un emote de la app como icono
          onEmote={(e) => {
            onChange(emoteToken(e.name, e.id))
            setEl(null)
          }}
          onClose={() => setEl(null)}
        />
      )}
    </>
  )
}

/** Elegir amigos (con nuestras casillas) */
function FriendPick({ picked, onToggle, exclude = [] }: { picked: string[]; onToggle: (id: string) => void; exclude?: string[] }): React.JSX.Element {
  const t = useT()
  const friends = useStore((s) => s.account.friends).filter((f) => !exclude.includes(f.id))
  if (!friends.length) return <p className="muted">{t('chat.noFriendsLeft')}</p>
  return (
    <div className="cd-friends">
      {friends.map((f) => (
        <label key={f.id} className={`cd-friend ${picked.includes(f.id) ? 'on' : ''}`}>
          <input type="checkbox" checked={picked.includes(f.id)} onChange={() => onToggle(f.id)} />
          <Avatar name={f.username} userId={f.id} version={f.avatar} profile={f.profile} />
          <UserName name={f.username} profile={f.profile} />
        </label>
      ))}
    </div>
  )
}

/** Invitar a tu partida: a qué amigos (por su privado) y a qué grupos */
export function InviteDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const t = useT()
  const groups = useStore((s) => s.chats.filter((c) => c.kind === 'group'))
  const [friends, setFriends] = useState<string[]>([])
  const [chats, setChats] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const toggle = (list: string[], id: string): string[] => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  return (
    <Modal
      title={t('chat.invite.dialog')}
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || (!friends.length && !chats.length)}
            onClick={async () => {
              setBusy(true)
              if (await inviteTo({ friends, chats })) onClose()
              setBusy(false)
            }}
          >
            <Swords size={15} /> {t('chat.invite.send')}
          </button>
        </>
      }
    >
      <p className="muted cd-hint">{t('chat.invite.dialogSub')}</p>
      <div className="pe-sub">{t('chat.invite.friends')}</div>
      <FriendPick picked={friends} onToggle={(id) => setFriends((p) => toggle(p, id))} />
      {groups.length > 0 && (
        <>
          <div className="pe-sub">{t('chat.invite.groups')}</div>
          <div className="cd-friends">
            {groups.map((g) => (
              <label key={g.id} className={`cd-friend ${chats.includes(g.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={chats.includes(g.id)} onChange={() => setChats((p) => toggle(p, g.id))} />
                <GroupIcon icon={g.icon} />
                {g.name}
              </label>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}

export function GroupDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const t = useT()
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const create = async (): Promise<void> => {
    setBusy(true)
    const c = await invoke('chat:group', name.trim(), icon || null, picked).catch(() => null)
    setBusy(false)
    if (!c) return void toast({ kind: 'error', key: 'chat.err.group' })
    onClose()
    navigate({ name: 'chat', id: c.id })
  }
  return (
    <Modal
      title={t('chat.newGroup')}
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" disabled={busy || !name.trim() || !picked.length} onClick={() => void create()}>
            {t('chat.createGroup')}
          </button>
        </>
      }
    >
      <div className="cd-row">
        <IconPick value={icon} onChange={setIcon} />
        <input className="cd-input" value={name} maxLength={40} autoFocus placeholder={t('chat.groupName')} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="pe-sub">{t('chat.pickFriends')}</div>
      <FriendPick picked={picked} onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))} />
    </Modal>
  )
}

export function GroupSettingsDialog({ chat, onClose }: { chat: ChatInfo; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const me = useStore((s) => s.account.user)!
  const friends = useStore((s) => s.account.friends)
  const [name, setName] = useState(chat.name ?? '')
  const [icon, setIcon] = useState(chat.icon ?? '')
  const [adding, setAdding] = useState<string[]>([])
  const owner = chat.owner === me.id
  const save = async (): Promise<void> => {
    if (name.trim() !== chat.name || icon !== (chat.icon ?? '')) await invoke('chat:patch', chat.id, { name: name.trim(), icon }).catch(() => false)
    if (adding.length && !(await invoke('chat:addMembers', chat.id, adding).catch(() => false))) toast({ kind: 'error', key: 'chat.err.group' })
    onClose()
  }
  return (
    <Modal
      title={t('chat.groupSettings')}
      onClose={onClose}
      actions={
        <>
          <button
            className="btn btn-danger"
            onClick={async () => {
              await invoke('chat:removeMember', chat.id, me.id).catch(() => false)
              onClose()
              navigate({ name: 'chat' })
            }}
          >
            <LogOut size={15} /> {t('chat.leave')}
          </button>
          <button className="btn btn-primary" disabled={!name.trim()} onClick={() => void save()}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="cd-row">
        <IconPick value={icon} onChange={setIcon} />
        <input className="cd-input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="pe-sub">{t('chat.members', { n: chat.members.length })}</div>
      <div className="cd-members">
        {chat.members.map((id) => {
          const f = id === me.id ? null : friends.find((x) => x.id === id)
          const nm = id === me.id ? me.profile?.displayName || me.username : (f?.username ?? '…')
          return (
            <div key={id} className={`cd-member ${plateRow(id === me.id ? me.profile : f?.profile)}`}>
              <Plate profile={id === me.id ? me.profile : f?.profile} />
              <Avatar name={nm} userId={id} version={id === me.id ? me.avatar : f?.avatar} profile={id === me.id ? me.profile : f?.profile} />
              <UserName name={nm} profile={id === me.id ? me.profile : f?.profile} />
              {chat.owner === id && <span className="cd-owner">👑</span>}
              {owner && id !== me.id && (
                <button
                  className="btn btn-ghost btn-sm btn-icon"
                  onClick={() => void invoke('chat:removeMember', chat.id, id)}
                  title={t('chat.kick')}
                  aria-label={t('chat.kick')}
                >
                  <UserMinus size={15} />
                </button>
              )}
            </div>
          )
        })}
      </div>
      <div className="pe-sub">
        <UserPlus size={13} /> {t('chat.addFriends')}
      </div>
      <FriendPick exclude={chat.members} picked={adding} onToggle={(id) => setAdding((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))} />
    </Modal>
  )
}

// El blanco: tus mensajes sin color
const ACCENTS = ['#ffffff', '#9dff3f', '#3b82f6', '#06b6d4', '#22c55e', '#f59e0b', '#f97316', '#ef4444', '#ec4899']
const BGS = ['#0f0c1d', '#1e1b4b', '#0c4a6e', '#064e3b', '#3f1d38', '#431407', '#111827']

/** Aspecto del chat (solo en tu PC): como Discord o como WhatsApp, tamaño, color, fondo y avisos */
export function ChatStyleDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const t = useT()
  const s = useStore((x) => x.settings)!
  const st = s.chatStyle
  const set = (patch: Partial<ChatStyle>): void => void updateSettings({ chatStyle: { ...st, ...patch } })
  const accentBtn = useRef<HTMLButtonElement>(null)
  const [picking, setPicking] = useState(false)
  const seg = <T extends string>(value: T, options: T[], label: (v: T) => string, onPick: (v: T) => void): React.JSX.Element => (
    <div className="seg">
      {options.map((o) => (
        <button key={o} className={value === o ? 'on' : ''} onClick={() => onPick(o)}>
          {label(o)}
        </button>
      ))}
    </div>
  )
  const toggle = (on: boolean, label: string, onChange: (v: boolean) => void): React.JSX.Element => (
    <div className="pe-switch">
      <span>{label}</span>
      <button className={`toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />
    </div>
  )
  return (
    <Modal
      title={t('chat.style.title')}
      onClose={onClose}
      actions={
        <button className="btn btn-primary" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <div className="cs">
        <div className="pe-sub">{t('chat.style.layout')}</div>
        {seg(
          st.layout,
          ['list', 'bubbles'],
          (v) => t(`chat.style.layouts.${v}`),
          (layout) => set({ layout })
        )}
        <div className="pe-sub">{t('chat.style.density')}</div>
        {seg(
          st.density,
          ['cozy', 'compact'],
          (v) => t(`chat.style.densities.${v}`),
          (density) => set({ density })
        )}
        <div className="pe-sub">{t('chat.style.size')}</div>
        {seg(
          st.size,
          ['s', 'm', 'l'],
          (v) => t(`chat.style.sizes.${v}`),
          (size) => set({ size })
        )}
        <div className="pe-sub">{t('chat.style.accent')}</div>
        <div className="swatches pe-swatches">
          {ACCENTS.map((c) => (
            <button
              key={c}
              className={`swatch pe-swatch ${st.accent === c ? 'on' : ''}`}
              style={{ background: c }}
              onClick={() => set({ accent: c })}
              aria-label={c}
            >
              {st.accent === c && <Check size={13} strokeWidth={3} />}
            </button>
          ))}
          <button ref={accentBtn} className="swatch pe-swatch pe-swatch-custom" onClick={() => setPicking(true)} aria-label={t('chat.style.accent')}>
            <Palette size={14} />
          </button>
          {picking && <ColorPicker value={st.accent} anchor={accentBtn.current} onChange={(accent) => set({ accent })} onClose={() => setPicking(false)} />}
        </div>
        <div className="pe-sub">{t('chat.style.bg')}</div>
        <div className="swatches pe-swatches">
          <button
            className={`swatch pe-swatch cs-none ${st.bg.kind === 'none' ? 'on' : ''}`}
            onClick={() => set({ bg: { kind: 'none' } })}
            aria-label={t('chat.style.noBg')}
          >
            ∅
          </button>
          {BGS.map((c) => (
            <button
              key={c}
              className={`swatch pe-swatch ${st.bg.kind === 'color' && st.bg.colors[0] === c ? 'on' : ''}`}
              style={{ background: c }}
              onClick={() => set({ bg: { kind: 'color', colors: [c, '#000000'] } })}
              aria-label={c}
            />
          ))}
        </div>
        {toggle(st.avatars, t('chat.style.avatars'), (avatars) => set({ avatars }))}
        {toggle(st.time24, t('chat.style.time24'), (time24) => set({ time24 }))}
        {toggle(s.chatNotify, t('chat.style.notify'), (v) => void updateSettings({ chatNotify: v }))}
        {toggle(s.chatSounds, t('chat.style.sounds'), (v) => void updateSettings({ chatSounds: v }))}
      </div>
    </Modal>
  )
}
