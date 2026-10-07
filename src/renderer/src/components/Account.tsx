import { useState } from 'react'
import { Check, UserPlus, Users, X, MessageCircle, CircleUserRound, Swords } from 'lucide-react'
import { inviteTo } from './chat/Invite'
import type { AccountResult, Friend } from '@shared/types'
import { invoke } from '../api'
import { navigate, toast, useStore } from '../store'
import { useT, type T } from '../i18n'
import { formatDuration } from '../lib/format'
import { Modal } from './Overlays'
import { Check as CheckBox } from './Moderation'
import { InviteLinkBox } from './Invite'
import { useAvatar } from '../lib/avatar'
import type { Frame, UserProfile } from '@shared/profile'
import { Plate, plateRow } from './Plate'
import { UserName } from './Profile'
import { Menu } from './Menu'

// Cuenta y amigos: iniciar sesión / crear cuenta, gestionar amigos, cambiar contraseña, borrar la cuenta y el
// panel de amigos de la barra lateral. Todo pasa por el proceso principal (que guarda la sesión cifrada).

const USERNAME = /^[a-zA-Z0-9_.]{3,20}$/

/** Estado de un amigo en una línea: "Jugando a X · 25 min", "En PoxiLauncher" o "Desconectado" */
/** Cómo ves a alguien: con el apodo que le has puesto si es tu amigo (los packs y grupos traen su nombre de verdad) */
export function useFriendName(): (p: { id: string; username: string }) => string {
  const friends = useStore((s) => s.account.friends)
  return (p) => friends.find((f) => f.id === p.id)?.username ?? p.username
}

export function friendStatus(f: Friend, t: T): string {
  if (f.state === 'playing') {
    const game = t('friends.playing', { game: f.mc ? `Minecraft ${f.mc.version} · ${t(`mc.loader.${f.mc.loader}`)}` : (f.gameName ?? '') })
    return f.since ? `${game} · ${formatDuration((Date.now() - f.since) / 1000, t)}` : game
  }
  return t(f.state === 'online' ? 'friends.online' : 'friends.offline')
}

/** Botón que pide un segundo clic para confirmar (durante 3 s) */
function ConfirmButton({ label, confirm, onConfirm, className = 'btn btn-sm' }: { label: string; confirm: string; onConfirm: () => void; className?: string }): React.JSX.Element {
  const [armed, setArmed] = useState(false)
  return (
    <button
      className={`${className} ${armed ? 'btn-danger' : ''}`}
      onClick={() => {
        if (armed) return onConfirm()
        setArmed(true)
        setTimeout(() => setArmed(false), 3000)
      }}
    >
      {armed ? confirm : label}
    </button>
  )
}

function Field({ label, hint, ...props }: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return (
    <label className="acc-field">
      <span>{label}</span>
      <input className="input" {...props} />
      {hint && <small>{hint}</small>}
    </label>
  )
}

/** Envía y pinta el error (traducido) si lo hay */
function useSubmit(): { busy: boolean; error: string; run: (fn: () => Promise<AccountResult | string | null>) => Promise<boolean>; setError: (e: string) => void } {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (fn: () => Promise<AccountResult | string | null>): Promise<boolean> => {
    setBusy(true)
    setError('')
    const r = await fn().catch((): AccountResult => ({ ok: false, error: 'offline' }))
    setBusy(false)
    // Un texto es un error de antes de enviar (comprobación en la propia ventana)
    if (typeof r === 'string') setError(r)
    else if (r && !r.ok) setError(t(`account.err.${r.error ?? 'offline'}`))
    return !!r && typeof r !== 'string' && r.ok
  }
  return { busy, error, run, setError }
}

export function SignInDialog({ onClose, initialMode = 'in' }: { onClose: () => void; initialMode?: 'in' | 'up' }): React.JSX.Element {
  const t = useT()
  const [mode, setMode] = useState<'in' | 'up'>(initialMode)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [accept, setAccept] = useState(false)
  const { busy, error, run, setError } = useSubmit()

  const submit = async (): Promise<void> => {
    const ok = await run(async () => {
      const name = username.trim()
      if (mode === 'up') {
        if (!USERNAME.test(name)) return `${t('account.username')}: ${t('account.usernameHint')}`
        if (password.length < 8) return t('account.passwordHint')
        if (password !== password2) return t('account.mismatch')
        if (!accept) return t('legal.required')
        return invoke('account:register', name, password, true)
      }
      if (!name || !password) return null
      return invoke('account:login', name, password)
    })
    if (ok) {
      toast({ kind: 'success', key: 'account.welcome', params: { name: username.trim() } })
      onClose()
    }
  }

  return (
    <Modal
      title=""
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {t(mode === 'in' ? 'account.signIn' : 'account.signUp')}
          </button>
        </>
      }
    >
      <form
        className="acc-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="acc-hero">
          <Users size={30} />
          <h2>{t(mode === 'in' ? 'account.signIn' : 'account.signUp')}</h2>
          <p>{t('account.intro')}</p>
        </div>
        <Field
          label={t('account.username')}
          hint={mode === 'up' ? t('account.usernameHint') : undefined}
          value={username}
          maxLength={20}
          autoFocus
          autoComplete="username"
          spellCheck={false}
          onChange={(e) => setUsername(e.target.value)}
        />
        <Field
          label={t('account.password')}
          hint={mode === 'up' ? t('account.passwordHint') : undefined}
          type="password"
          value={password}
          maxLength={200}
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
          onChange={(e) => setPassword(e.target.value)}
        />
        {mode === 'up' && (
          <Field
            label={t('account.password2')}
            type="password"
            value={password2}
            maxLength={200}
            autoComplete="new-password"
            onChange={(e) => setPassword2(e.target.value)}
          />
        )}
        {mode === 'up' && (
          <div className="acc-legal">
            <CheckBox on={accept} onChange={setAccept}>
              {t('legal.accept')}
            </CheckBox>
            <div className="acc-legal-links">
              <button type="button" className="link-btn" onClick={() => void invoke('app:openLegal', 'terminos')}>
                {t('legal.terms')}
              </button>
              <button type="button" className="link-btn" onClick={() => void invoke('app:openLegal', 'privacidad')}>
                {t('legal.privacy')}
              </button>
            </div>
          </div>
        )}
        {error && <p className="err-text">{error}</p>}
        {/* Enter en cualquier campo envía el formulario */}
        <button type="submit" hidden />
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            setMode(mode === 'in' ? 'up' : 'in')
            setError('')
          }}
        >
          {t(mode === 'in' ? 'account.noAccount' : 'account.haveAccount')}
        </button>
      </form>
    </Modal>
  )
}

/** Cambiar la contraseña. "forced": entró con una temporal del admin y no puede seguir sin cambiarla. */
export function PasswordDialog({ forced = false, onClose }: { forced?: boolean; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [next2, setNext2] = useState('')
  const { busy, error, run } = useSubmit()

  const submit = async (): Promise<void> => {
    const ok = await run(async () => {
      if (!current) return null
      if (next.length < 8) return t('account.passwordHint')
      if (next !== next2) return t('account.mismatch')
      return invoke('account:password', current, next)
    })
    if (ok) {
      toast({ kind: 'success', key: 'account.changed' })
      onClose()
    }
  }

  return (
    <Modal
      title={t(forced ? 'account.mustChangeTitle' : 'account.changePassword')}
      onClose={forced ? () => undefined : onClose}
      actions={
        <>
          <button className="btn" onClick={forced ? () => void invoke('account:logout') : onClose}>
            {t(forced ? 'account.logout' : 'common.cancel')}
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {t('account.changePassword')}
          </button>
        </>
      }
    >
      <form
        className="acc-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {forced && <p className="muted">{t('account.mustChangeText')}</p>}
        <Field label={t('account.current')} type="password" value={current} maxLength={200} autoFocus autoComplete="current-password" onChange={(e) => setCurrent(e.target.value)} />
        <Field label={t('account.next')} hint={t('account.passwordHint')} type="password" value={next} maxLength={200} autoComplete="new-password" onChange={(e) => setNext(e.target.value)} />
        <Field label={t('account.password2')} type="password" value={next2} maxLength={200} autoComplete="new-password" onChange={(e) => setNext2(e.target.value)} />
        {error && <p className="err-text">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

export function DeleteAccountDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const t = useT()
  const [password, setPassword] = useState('')
  const { busy, error, run } = useSubmit()
  const submit = async (): Promise<void> => {
    if (await run(async () => (password ? invoke('account:delete', password) : null))) {
      toast({ kind: 'success', key: 'account.deleted' })
      onClose()
    }
  }
  return (
    <Modal
      title={t('account.deleteTitle')}
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-danger" disabled={busy || !password} onClick={() => void submit()}>
            {t('account.delete')}
          </button>
        </>
      }
    >
      <form
        className="acc-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <p className="muted">{t('account.deleteText')}</p>
        <Field label={t('account.password')} type="password" value={password} maxLength={200} autoFocus autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="err-text">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

/** Añadir amigos, responder solicitudes y quitar amigos */
export function FriendsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const t = useT()
  const { user, friends, incoming, outgoing } = useStore((s) => s.account)
  const [name, setName] = useState('')
  const { busy, error, run } = useSubmit()

  const add = async (): Promise<void> => {
    const n = name.trim()
    const ok = await run(async () => {
      if (!n) return null
      if (n.toLowerCase() === user?.username.toLowerCase()) return t('account.err.self')
      if (friends.some((f) => (f.realName ?? f.username).toLowerCase() === n.toLowerCase())) return t('account.err.already')
      return invoke('account:addFriend', n)
    })
    if (ok) {
      toast({ kind: 'success', key: 'friends.sent', params: { name: n } })
      setName('')
    }
  }

  return (
    <Modal
      title={t('friends.manage')}
      onClose={onClose}
      actions={
        <button className="btn btn-primary" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <form
        className="acc-add"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <input className="input" value={name} maxLength={20} autoFocus spellCheck={false} placeholder={t('account.username')} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-primary" disabled={busy || !name.trim()}>
          <UserPlus size={16} /> {t('friends.send')}
        </button>
      </form>
      {error && <p className="err-text">{error}</p>}
      {/* O con un enlace (como los de Discord): quien lo abre se hace tu amigo */}
      <InviteLinkBox instanceId={null} />

      {incoming.length > 0 && (
        <div className="acc-group">
          <h3>{t('friends.requests')}</h3>
          {incoming.map((r) => (
            <div key={r.id} className="acc-row">
              <Avatar name={r.username} />
              <b>{r.username}</b>
              <button className="btn btn-sm btn-primary" onClick={() => void invoke('account:answerFriend', r.id, true)}>
                <Check size={15} /> {t('friends.accept')}
              </button>
              <button className="btn btn-sm" aria-label={t('friends.decline')} title={t('friends.decline')} onClick={() => void invoke('account:answerFriend', r.id, false)}>
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      {outgoing.length > 0 && (
        <div className="acc-group">
          <h3>{t('friends.pending')}</h3>
          {outgoing.map((r) => (
            <div key={r.id} className="acc-row">
              <Avatar name={r.username} />
              <b>{r.username}</b>
              <button className="btn btn-sm" onClick={() => void invoke('account:answerFriend', r.id, false)}>
                {t('friends.cancel')}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="acc-group">
        <h3>{t('friends.list')}</h3>
        {!friends.length && <p className="muted">{t('friends.none')}</p>}
        {friends.map((f) => (
          <div key={f.id} className="acc-row">
            <Avatar name={f.username} state={f.state} userId={f.id} version={f.avatar} />
            {/* Al pulsar, su perfil */}
            <button
              className="acc-who acc-who-link"
              onClick={() => {
                onClose()
                navigate({ name: 'friend', id: f.id })
              }}
            >
              <b>{f.username}</b>
              <small>{friendStatus(f, t)}</small>
            </button>
            <ConfirmButton
              label={t('friends.remove')}
              confirm={t('friends.remove') + '?'}
              onConfirm={() => {
                void invoke('account:removeFriend', f.id)
                toast({ kind: 'info', key: 'friends.removed', params: { name: f.username } })
              }}
            />
          </div>
        ))}
      </div>
    </Modal>
  )
}

/** Foto de perfil de la cuenta (userId + versión) o, si no tiene, la inicial de su nombre. Con su marco: el de su
 * perfil o uno concreto (`frame`, en el editor) */
export function Avatar({
  name,
  state,
  userId,
  version,
  className = '',
  frame,
  profile
}: {
  name: string
  state?: Friend['state']
  userId?: string
  version?: string | null
  className?: string
  frame?: Frame
  profile?: UserProfile
}): React.JSX.Element {
  const src = useAvatar(userId, version)
  frame ??= profile?.frame
  return (
    <span className={`avatar ${frame ? `framed frame-${frame}` : ''} ${className}`} aria-hidden>
      {src ? <img src={src} alt="" /> : name.charAt(0).toUpperCase()}
      {state && <i className={`presence ${state}`} />}
    </span>
  )
}

/** Panel de amigos de la barra lateral: quién está y a qué juega, en directo */
export function FriendsPanel(): React.JSX.Element {
  const t = useT()
  const { user, friends, incoming, offline } = useStore((s) => s.account)
  const [dialog, setDialog] = useState<'signIn' | 'friends' | null>(null)
  // Clic derecho sobre un amigo: enviarle un mensaje o ver su perfil
  const [menu, setMenu] = useState<{ el: HTMLElement; id: string } | null>(null)
  // Jugando a Minecraft: el menú del amigo ofrece invitarle a tu partida
  const inGame = useStore((s) => !!s.mc?.running)
  const online = friends.filter((f) => f.state !== 'offline').length

  return (
    <div className="friends">
      {!user ? (
        <button className="friends-join" onClick={() => setDialog('signIn')}>
          <Users size={18} />
          <span>
            <b>{t('friends.join')}</b>
            <small>{t('friends.joinSub')}</small>
          </span>
        </button>
      ) : (
        <>
          <div className="friends-head">
            <span>
              {t('friends.title')} {friends.length > 0 && <small className="num">{online}/{friends.length}</small>}
            </span>
            <button className="btn btn-sm btn-icon" aria-label={t('friends.manage')} title={t('friends.manage')} onClick={() => setDialog('friends')}>
              <UserPlus size={16} />
              {incoming.length > 0 && <span className="badge num">{incoming.length}</span>}
            </button>
          </div>
          {offline && <div className="friends-note">{t('friends.noServer')}</div>}
          {!friends.length && !offline && (
            <button className="friends-note link-btn" onClick={() => setDialog('friends')}>
              {t('friends.none')}
            </button>
          )}
          <div className="friends-list">
            {friends.map((f) => (
              <button
                key={f.id}
                className={`friend ${f.state} ${plateRow(f.profile)}`}
                title={friendStatus(f, t)}
                onClick={() => navigate({ name: 'friend', id: f.id })}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ el: e.currentTarget, id: f.id })
                }}
              >
                <Plate profile={f.profile} />
                <Avatar name={f.username} state={f.state} userId={f.id} version={f.avatar} profile={f.profile} />
                <span className="acc-who">
                  <b>
                    <UserName name={f.username} profile={f.profile} />
                  </b>
                  <small>{f.state !== 'playing' && f.profile?.custom ? `${f.profile.custom.emoji} ${f.profile.custom.text}`.trim() : friendStatus(f, t)}</small>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {dialog === 'signIn' && <SignInDialog onClose={() => setDialog(null)} />}
      {dialog === 'friends' && <FriendsDialog onClose={() => setDialog(null)} />}
      {menu && (
        <Menu anchor={menu.el} onClose={() => setMenu(null)} align="left">
          <button onClick={() => void messageFriend(menu.id)}>
            <MessageCircle size={16} /> {t('chat.sendMessage')}
          </button>
          {inGame && (
            <button onClick={() => void inviteTo({ friends: [menu.id] })}>
              <Swords size={16} /> {t('chat.invite.button')}
            </button>
          )}
          <button onClick={() => navigate({ name: 'friend', id: menu.id })}>
            <CircleUserRound size={16} /> {t('chat.seeProfile')}
          </button>
        </Menu>
      )}
    </div>
  )
}

/** Abre (o crea) el privado con un amigo */
export async function messageFriend(id: string): Promise<void> {
  const c = await invoke('chat:dm', id).catch(() => null)
  if (c) navigate({ name: 'chat', id: c.id })
  else toast({ kind: 'error', key: 'chat.err.open' })
}

/** Si entró con una contraseña temporal del admin, no puede seguir sin elegir otra */
export function ForcedPassword(): React.JSX.Element | null {
  const mustChange = useStore((s) => !!s.account.user?.mustChange)
  return mustChange ? <PasswordDialog forced onClose={() => undefined} /> : null
}
