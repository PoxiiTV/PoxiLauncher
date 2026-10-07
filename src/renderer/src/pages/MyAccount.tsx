import { useRef, useState } from 'react'
import { ArrowUpRight, Box, Camera, Clock, KeyRound, Link2, LogIn, LogOut, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react'
import { invoke } from '../api'
import { openSettings, toast, useStore } from '../store'
import { useT } from '../i18n'
import { formatDuration } from '../lib/format'
import { Avatar, DeleteAccountDialog, PasswordDialog, SignInDialog } from '../components/Account'
import { AvatarCrop } from '../components/AvatarCrop'
import { ProfileEditor, UserName } from '../components/Profile'

// Mi cuenta: quién eres, tu actividad, tus conexiones (Discord), qué ven tus amigos y la seguridad de la cuenta. La foto se recorta aquí, se sube a nuestro servidor y la ven tú y tus amigos.

/** Fotos que se aceptan para recortar (luego siempre se sube un WebP pequeño) */
const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const MAX_PHOTO = 15 * 1024 * 1024

export function MyAccount(): React.JSX.Element {
  const t = useT()
  const { user, friends, offline, blocked } = useStore((s) => s.account)
  const lang = useStore((s) => s.settings?.lang ?? 'es')
  // Jugando a Minecraft: la instancia abierta
  const playing = useStore((s) => (s.mc?.running ? (s.mc.instances.find((i) => i.id === s.mc!.running)?.name ?? 'Minecraft') : null))
  const instances = useStore((s) => s.mc?.instances.length ?? 0)
  // Tus horas: lo jugado en todas tus instancias
  const seconds = useStore((s) => s.mc?.instances.reduce((a, i) => a + (i.playtime || 0), 0) ?? 0)
  const [dialog, setDialog] = useState<'signIn' | 'signUp' | 'password' | 'delete' | null>(null)
  const [crop, setCrop] = useState<File | null>(null)
  const file = useRef<HTMLInputElement>(null)

  const pickPhoto = (f: File | undefined): void => {
    if (file.current) file.current.value = ''
    if (!f) return
    if (!PHOTO_TYPES.includes(f.type) || f.size > MAX_PHOTO) return void toast({ kind: 'error', key: 'account.page.photoError' })
    setCrop(f)
  }

  const online = friends.filter((f) => f.state !== 'offline').length
  const state = offline ? 'offline' : playing !== null ? 'playing' : 'online'
  const stateText = offline
    ? t('account.page.stateOffline')
    : playing !== null
      ? t('account.page.statePlaying', { game: playing })
      : t('account.page.stateOnline')

  return (
    <div className="page my-account">
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('account.page.title')}</h1>
          <div className="page-sub">{t('account.page.sub')}</div>
        </div>
      </div>

      {!user ? (
        <section className="panel acct-guest">
          <Avatar name="?" className="acct-avatar-lg" />
          <div className="acct-guest-text">
            <h2>{t('account.page.guestTitle')}</h2>
            <p className="muted">{t('account.page.guestText')}</p>
            <ul className="acct-perks">
              {[0, 1, 2, 3].map((i) => (
                <li key={i}>{t(`account.page.perks.${i}`)}</li>
              ))}
            </ul>
            <div className="row-buttons">
              <button className="btn btn-primary" onClick={() => setDialog('signIn')}>
                <LogIn size={16} /> {t('account.signIn')}
              </button>
              <button className="btn" onClick={() => setDialog('signUp')}>
                <UserPlus size={16} /> {t('account.signUp')}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <>
          {/* Cabecera: foto, nombre, estado en directo y antigüedad */}
          <section className="panel acct-hero">
            <button className="acct-photo" onClick={() => file.current?.click()} title={t('account.page.changePhoto')} aria-label={t('account.page.changePhoto')}>
              <Avatar
                name={user.username}
                userId={user.id}
                version={user.avatar}
                state={offline ? 'offline' : state === 'playing' ? 'playing' : 'online'}
                profile={user.profile}
                className="acct-avatar-lg"
              />
              <span className="acct-photo-edit">
                <Camera size={16} />
              </span>
            </button>
            <input ref={file} type="file" accept={PHOTO_TYPES.join(',')} hidden onChange={(e) => pickPhoto(e.target.files?.[0])} />
            <div className="acct-who">
              <h2>
                <UserName name={user.profile?.displayName || user.username} profile={user.profile} />
              </h2>
              {user.profile?.displayName && <small className="muted">@{user.username}</small>}
              <span className={`acct-state ${state}`}>
                <i /> {stateText}
              </span>
              {user.createdAt && (
                <small className="muted">
                  {t('account.page.memberSince', {
                    date: new Date(user.createdAt).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
                  })}
                </small>
              )}
            </div>
            <div className="acct-hero-actions">
              <button className="btn btn-sm" onClick={() => file.current?.click()}>
                <Camera size={15} /> {t('account.page.changePhoto')}
              </button>
              {user.avatar && (
                <button
                  className="btn btn-sm"
                  onClick={async () => {
                    const r = await invoke('account:removeAvatar').catch(() => ({ ok: false }))
                    if (!r.ok) toast({ kind: 'error', key: 'account.err.offline' })
                  }}
                >
                  {t('account.page.removePhoto')}
                </button>
              )}
              <small className="muted acct-photo-note">{t('account.page.photoNote')}</small>
            </div>
          </section>

          {/* Tu actividad */}
          <h2 className="section-title acct-title">{t('account.page.activity')}</h2>
          <div className="acct-tiles">
            <div className="acct-tile">
              <Users size={18} />
              <b className="num">{friends.length}</b>
              <span>{t('account.page.friends')}</span>
              <small className="muted num">{t('account.page.friendsOnline', { n: online })}</small>
            </div>
            <div className="acct-tile">
              <Box size={18} />
              <b className="num">{instances}</b>
              <span>{t('account.page.instances')}</span>
            </div>
            <div className="acct-tile">
              <Clock size={18} />
              <b className="num">{Math.floor(seconds / 3600)}</b>
              <span>{t('account.page.hours')}</span>
              {seconds > 0 && <small className="muted num">{formatDuration(seconds, t)}</small>}
            </div>
          </div>

          {/* Tu perfil, estilo Discord: lo que ven tus amigos, con vista previa en vivo */}
          <h2 className="section-title acct-title">{t('uprofile.edit.title')}</h2>
          <p className="muted acct-text acct-edit-sub">{t('uprofile.edit.sub')}</p>
          <ProfileEditor />

          <div className="acct-cols">
            {/* Conexiones */}
            <section className="panel">
              <h2 className="section-title">
                <Link2 size={18} /> {t('account.page.connections')}
              </h2>
              {/* Ahora vive en Ajustes (la capa): aquí, el camino directo */}
              <div className="setting row-setting">
                <div>
                  <div className="setting-label">{t('settings.discord')}</div>
                  <div className="setting-sub">{t('account.page.discordIn')}</div>
                </div>
                <button className="btn btn-sm" onClick={() => openSettings('privacy', 'discord')}>
                  {t('account.page.openSettings')} <ArrowUpRight size={15} />
                </button>
              </div>
            </section>

            {/* Privacidad */}
            <section className="panel">
              <h2 className="section-title">
                <ShieldCheck size={18} /> {t('account.page.privacy')}
              </h2>
              <p className="muted acct-text">{t('account.page.privacyText')}</p>
              <div className="setting row-setting">
                <div>
                  <div className="setting-label">{t('settings.friendAlerts')}</div>
                  <div className="setting-sub">{t('account.page.alertsIn')}</div>
                </div>
                <button className="btn btn-sm" onClick={() => openSettings('notif', 'friendAlerts')}>
                  {t('account.page.openSettings')} <ArrowUpRight size={15} />
                </button>
              </div>
              {/* A quién has bloqueado (desde el chat o su perfil), para deshacerlo */}
              <div className="setting">
                <div className="setting-label">{t('moderation.blockedList')}</div>
                <div className="setting-sub">{t('moderation.blockedHelp')}</div>
                {blocked?.length ? (
                  <ul className="acct-blocked">
                    {blocked.map((b) => (
                      <li key={b.id}>
                        <span>{b.username}</span>
                        <button
                          className="btn btn-sm"
                          onClick={async () => {
                            const r = await invoke('account:unblock', b.id).catch(() => ({ ok: false }))
                            toast(r.ok ? { kind: 'info', key: 'moderation.unblocked', params: { name: b.username } } : { kind: 'error', key: 'account.err.offline' })
                          }}
                        >
                          {t('moderation.unblock')}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="setting-sub">{t('moderation.noBlocked')}</div>
                )}
              </div>
            </section>
          </div>

          {/* Seguridad */}
          <section className="panel">
            <h2 className="section-title">
              <KeyRound size={18} /> {t('account.page.security')}
            </h2>
            <div className="setting row-setting">
              <div>
                <div className="setting-label">{t('account.signedAs', { name: user.username })}</div>
                <div className="setting-sub">{t('account.page.securityText')}</div>
              </div>
              <div className="row-buttons">
                <button className="btn" onClick={() => setDialog('password')}>
                  <KeyRound size={16} /> {t('account.changePassword')}
                </button>
                <button className="btn" onClick={() => void invoke('account:logout')}>
                  <LogOut size={16} /> {t('account.logout')}
                </button>
              </div>
            </div>
          </section>

          {/* Zona peligrosa */}
          <section className="panel acct-danger">
            <div className="setting row-setting">
              <div>
                <div className="setting-label">{t('account.page.danger')}</div>
                <div className="setting-sub">{t('account.deleteText')}</div>
              </div>
              <button className="btn btn-danger" onClick={() => setDialog('delete')}>
                <Trash2 size={16} /> {t('account.delete')}
              </button>
            </div>
          </section>
        </>
      )}

      {(dialog === 'signIn' || dialog === 'signUp') && (
        <SignInDialog initialMode={dialog === 'signUp' ? 'up' : 'in'} onClose={() => setDialog(null)} />
      )}
      {dialog === 'password' && <PasswordDialog onClose={() => setDialog(null)} />}
      {crop && <AvatarCrop file={crop} onClose={() => setCrop(null)} />}
      {dialog === 'delete' && <DeleteAccountDialog onClose={() => setDialog(null)} />}
    </div>
  )
}
