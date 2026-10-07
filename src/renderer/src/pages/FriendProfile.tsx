import { useRef, useState } from 'react'
import { Box, Flag, MessageCircle, MoreHorizontal, Pencil, ShieldBan, UserMinus } from 'lucide-react'
import { invoke } from '../api'
import { navigate, toast, useStore } from '../store'
import { useT } from '../i18n'
import { joinFriend } from '../lib/mc'
import { Modal } from '../components/Overlays'
import { friendStatus, messageFriend } from '../components/Account'
import { Menu } from '../components/Menu'
import { ProfileCard } from '../components/Profile'
import { BlockDialog, ReportDialog } from '../components/Moderation'
import grassBlock from '../assets/mc/grass-block.png'

// Perfil de un amigo (como el perfil completo de Discord): su tarjeta con todo lo suyo a un lado y, al lado, lo que
// está jugando ahora en Minecraft (para unirte). Solo se ve lo que el servidor comparte entre amigos.

export function FriendProfile({ id }: { id: string }): React.JSX.Element {
  const t = useT()
  const f = useStore((s) => s.account.friends.find((x) => x.id === id))
  const [confirm, setConfirm] = useState(false)
  const [nicking, setNicking] = useState(false)
  const [more, setMore] = useState(false)
  const [moderate, setModerate] = useState<'block' | 'report' | null>(null)
  const moreRef = useRef<HTMLButtonElement>(null)

  if (!f)
    return (
      <div className="page">
        <div className="empty">
          <div className="emoji">👤</div>
          <h3>{t('friendProfile.gone')}</h3>
        </div>
      </div>
    )

  // En Minecraft con un mundo abierto o en un servidor: te puedes unir
  const mc = f.state === 'playing' ? f.mc : undefined
  const join = !!mc && !!(mc.tunnel || mc.server)

  return (
    <div className="page friend-profile">
      <div className="fp-layout">
        {/* Su tarjeta (la misma que ve en su editor) con todo lo suyo; al lado, lo que está jugando */}
        <aside className="fp-side">
          <ProfileCard
            userId={f.id}
            name={f.username}
            username={f.realName ?? f.username}
            profile={f.profile ?? {}}
            badges={f.badges}
            avatar={f.avatar}
            state={f.state}
            presence={friendStatus(f, t)}
            createdAt={f.createdAt}
            actions={
              <>
                {join && (
                  <button
                    className="btn btn-primary fp-join"
                    onClick={() => void joinFriend(f.id)}
                    title={mc?.server ? t('mc.join.where', { host: mc.server.host }) : undefined}
                  >
                    <Box size={15} /> {t('mc.join.button')}
                  </button>
                )}
                <button className={`btn btn-sm ${join ? '' : 'btn-primary fp-main-action'}`} onClick={() => void messageFriend(f.id)}>
                  <MessageCircle size={15} /> {t('chat.message')}
                </button>
                <button
                  ref={moreRef}
                  className="btn btn-sm btn-icon"
                  onClick={() => setMore((v) => !v)}
                  aria-label={t('friendProfile.more')}
                  title={t('friendProfile.more')}
                >
                  <MoreHorizontal size={16} />
                </button>
                {more && (
                  <Menu anchor={moreRef.current} onClose={() => setMore(false)} align="left">
                    <button onClick={() => setNicking(true)}>
                      <Pencil size={15} /> {t('nickname.edit')}
                    </button>
                    <button className="danger" onClick={() => setConfirm(true)}>
                      <UserMinus size={15} /> {t('friends.remove')}
                    </button>
                    <button className="danger" onClick={() => setModerate('block')}>
                      <ShieldBan size={15} /> {t('moderation.block')}
                    </button>
                    <button className="danger" onClick={() => setModerate('report')}>
                      <Flag size={15} /> {t('moderation.report')}
                    </button>
                  </Menu>
                )}
              </>
            }
          />
        </aside>

        <div className="fp-main">
          {mc ? (
            <section className="panel fp-now">
              <h2 className="section-title">{t('friendProfile.now')}</h2>
              <div className="fp-now-row">
                <span className="fp-now-cover">
                  <img className="cover cover-mc loaded" src={grassBlock} alt="" draggable={false} />
                </span>
                <div className="fp-now-info">
                  <b>{mc.name}</b>
                  <span className="muted">{friendStatus(f, t)}</span>
                  {join && (
                    <div className="fp-now-actions">
                      <button className="btn btn-primary fp-join" onClick={() => void joinFriend(f.id)}>
                        <Box size={15} /> {t('mc.join.button')}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </section>
          ) : (
            <div className="panel fp-empty muted">{t('friendProfile.noActivity')}</div>
          )}
        </div>
      </div>

      {moderate === 'block' && <BlockDialog user={{ id: f.id, name: f.username }} onClose={() => setModerate(null)} onDone={() => navigate({ name: 'minecraft' })} />}
      {moderate === 'report' && <ReportDialog user={{ id: f.id, name: f.username }} onClose={() => setModerate(null)} />}
      {nicking && <NicknameDialog id={f.id} realName={f.realName ?? f.username} nickname={f.nickname ?? ''} onClose={() => setNicking(false)} />}

      {confirm && (
        <Modal
          title={t('friendProfile.removeTitle', { name: f.realName ?? f.username })}
          onClose={() => setConfirm(false)}
          actions={
            <>
              <button className="btn" onClick={() => setConfirm(false)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  setConfirm(false)
                  const r = await invoke('account:removeFriend', f.id).catch(() => ({ ok: false }))
                  if (!r.ok) return void toast({ kind: 'error', key: 'account.err.offline' })
                  toast({ kind: 'info', key: 'friends.removed', params: { name: f.username } })
                  navigate({ name: 'minecraft' })
                }}
              >
                <UserMinus size={16} /> {t('friends.remove')}
              </button>
            </>
          }
        >
          <p className="muted">{t('friendProfile.removeText')}</p>
        </Modal>
      )}
    </div>
  )
}

/** Apodo para un amigo, como en Discord o Steam: solo lo ves tú (y te sigue a cualquier PC con tu cuenta) */
function NicknameDialog({ id, realName, nickname, onClose }: { id: string; realName: string; nickname: string; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const [value, setValue] = useState(nickname)
  const [busy, setBusy] = useState(false)
  const save = async (next: string): Promise<void> => {
    setBusy(true)
    const r = await invoke('account:nickname', id, next.trim()).catch(() => ({ ok: false }))
    setBusy(false)
    if (!r.ok) return void toast({ kind: 'error', key: 'account.err.offline' })
    onClose()
  }
  return (
    <Modal
      title={t('nickname.title', { name: realName })}
      onClose={onClose}
      actions={
        <>
          {nickname && (
            <button className="btn btn-ghost" disabled={busy} onClick={() => void save('')}>
              {t('nickname.remove')}
            </button>
          )}
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" disabled={busy || value.trim() === nickname} onClick={() => void save(value)}>
            {t('nickname.save')}
          </button>
        </>
      }
    >
      <p className="muted">{t('nickname.text')}</p>
      <input
        className="input"
        style={{ width: '100%' }}
        autoFocus
        maxLength={32}
        placeholder={realName}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && value.trim() !== nickname && void save(value)}
      />
    </Modal>
  )
}
