import { useEffect, useState } from 'react'
import { Box, Check, Copy, Link2, Loader2, LogIn, UserPlus, X } from 'lucide-react'
import type { InviteLink, InvitePreview, InviteResult } from '@shared/types'
import { invoke } from '../api'
import { navigate, setState, toast, useStore } from '../store'
import { useT } from '../i18n'
import { Modal } from './Overlays'
import { SignInDialog } from './Account'

// Enlaces de invitación: el tuyo (en Compartir de una instancia y en Amigos) y la ventana que sale al abrir uno.

const LOADERS: Record<string, string> = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' }
const daysLeft = (expires: number): number => Math.max(1, Math.round((expires - Date.now()) / 86_400_000))

/** Tu enlace: se crea al pulsar, se copia y se puede anular. instanceId null = enlace de amistad */
export function InviteLinkBox({ instanceId, mc = false }: { instanceId: string | null; mc?: boolean }): React.JSX.Element {
  const t = useT()
  const [link, setLink] = useState<InviteLink | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const btn = mc ? 'mc-btn' : 'btn'

  const create = async (): Promise<void> => {
    setBusy(true)
    const l = await invoke('invite:create', instanceId).catch(() => null)
    setBusy(false)
    if (!l) return void toast({ kind: 'error', key: 'invite.failed' })
    setLink(l)
  }
  const copy = (): void => {
    if (!link) return
    void navigator.clipboard.writeText(link.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }
  const revoke = async (): Promise<void> => {
    if (!link || !(await invoke('invite:revoke', link.code).catch(() => false))) return void toast({ kind: 'error', key: 'invite.failed' })
    setLink(null)
    toast({ kind: 'info', key: 'invite.revoked' })
  }

  return (
    <div className={`inv-box ${mc ? 'mc' : ''}`}>
      <div className="inv-box-head">
        <Link2 size={16} />
        <b>{t('invite.title')}</b>
      </div>
      <p className={mc ? 'mc-hint' : 'muted'}>{t(instanceId ? 'invite.helpPack' : 'invite.helpFriend')}</p>
      {!link ? (
        <button className={btn} disabled={busy} onClick={() => void create()}>
          {busy ? <Loader2 size={16} className="spin" /> : <Link2 size={16} />} {t('invite.create')}
        </button>
      ) : (
        <>
          <div className="inv-url">
            <code>{link.url}</code>
            <button className={`${btn} ${mc ? 'mc-btn-emerald' : 'btn-primary'}`} onClick={copy}>
              {copied ? <Check size={16} /> : <Copy size={16} />} {t(copied ? 'invite.copied' : 'invite.copy')}
            </button>
          </div>
          <div className="inv-meta">
            <span>{t('invite.meta', { days: String(daysLeft(link.expires)), uses: String(link.uses), max: String(link.max) })}</span>
            <button className="link-btn danger" onClick={() => void revoke()}>
              {t('invite.revoke')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** Al abrir un enlace: quién invita y a qué, y unirse (con cuenta) */
export function InviteDialog(): React.JSX.Element | null {
  const code = useStore((s) => s.invite)
  return code ? <InviteOpen key={code} code={code} /> : null
}

function InviteOpen({ code }: { code: string }): React.JSX.Element {
  const t = useT()
  const user = useStore((s) => s.account.user)
  const [preview, setPreview] = useState<InvitePreview | null | 'offline' | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [signIn, setSignIn] = useState<'in' | 'up' | null>(null)
  const close = (): void => setState({ invite: null })
  // Antes de ofrecer «Unirme»: ¿es tuya, ya estás en ese pack o ya sois amigos?
  const packId = preview && preview !== 'offline' ? preview.pack?.id : undefined
  const inPack = useStore((s) => !!packId && !!s.mc?.packs.some((p) => p.id === packId && !p.invited))
  const packInstance = useStore((s) => (packId ? s.mc?.instances.find((i) => i.packId === packId)?.id : undefined))
  const isFriend = useStore((s) => preview && preview !== 'offline' && s.account.friends.some((f) => f.id === preview.by.id))

  useEffect(() => {
    void invoke('invite:preview', code)
      .catch(() => 'offline' as const)
      .then(setPreview)
  }, [code])

  const join = async (): Promise<void> => {
    setBusy(true)
    const r = await invoke('invite:accept', code).catch((): InviteResult => ({ ok: false, error: 'invite.offline' }))
    setBusy(false)
    if (r.error) return void toast({ kind: 'error', key: r.error })
    const name = preview && preview !== 'offline' ? preview.by.displayName || preview.by.username : ''
    toast({ kind: 'success', key: r.joined ? 'invite.joinedGame' : preview && preview !== 'offline' && preview.pack && !r.full ? 'invite.joinedPack' : 'invite.friends', params: { name } })
    if (r.full) toast({ kind: 'info', key: 'invite.full' })
    close()
    if (r.id) navigate({ name: 'mcInstance', id: r.id })
  }

  if (signIn) return <SignInDialog initialMode={signIn} onClose={() => setSignIn(null)} />

  const ok = preview && preview !== 'offline' ? preview : null
  const name = ok ? ok.by.displayName || ok.by.username : ''
  // Con sesión: tu propia invitación, ya estás en ese pack (con su instancia en este PC) o ya sois amigos (sin pack)
  const state = !ok || !user ? null : ok.by.id === user.id ? 'mine' : ok.pack ? (inPack && packInstance ? 'inPack' : null) : isFriend ? 'friends' : null
  const goInstance = (): void => {
    close()
    if (packInstance) navigate({ name: 'mcInstance', id: packInstance })
  }
  return (
    <Modal
      className="mc-modal"
      title={state === 'mine' ? t('invite.mineTitle') : state === 'inPack' ? t('invite.inPackTitle') : ok ? t('invite.from', { name }) : t('invite.title')}
      onClose={busy ? () => undefined : close}
      actions={
        <>
          <button className="mc-btn" disabled={busy} onClick={close}>
            {ok && !state ? t('invite.notNow') : t('common.close')}
          </button>
          {(state === 'mine' || state === 'inPack') && packInstance && (
            <button className="mc-btn mc-btn-emerald" onClick={goInstance}>
              <Box size={16} /> {t('invite.goInstance')}
            </button>
          )}
          {state === 'friends' && ok && (
            <button
              className="mc-btn mc-btn-emerald"
              onClick={() => {
                close()
                navigate({ name: 'friend', id: ok.by.id })
              }}
            >
              <UserPlus size={16} /> {t('invite.seeProfile')}
            </button>
          )}
          {ok && user && !state && (
            <button className="mc-btn mc-btn-emerald" disabled={busy} onClick={() => void join()}>
              {busy ? <Loader2 size={16} className="spin" /> : ok.pack ? <Box size={16} /> : <UserPlus size={16} />} {t(ok.pack ? 'invite.join' : 'invite.addFriend')}
            </button>
          )}
        </>
      }
    >
      {preview === undefined ? (
        <p className="mc-hint">
          <Loader2 size={16} className="spin" /> {t('invite.loading')}
        </p>
      ) : !ok ? (
        <p className="mc-warn">
          <X size={16} /> {t(preview === 'offline' ? 'invite.offline' : 'invite.gone')}
        </p>
      ) : (
        <>
          {ok.pack ? (
            <div className="inv-pack">
              {ok.pack.icon ? <img src={ok.pack.icon} alt="" /> : <span className="inv-pack-icon">📦</span>}
              <div>
                <b>{ok.pack.name}</b>
                <span className="mc-hint">
                  {t('invite.packInfo', { mc: ok.pack.mc, loader: LOADERS[ok.pack.loader] ?? ok.pack.loader, mods: String(ok.pack.mods), members: String(ok.pack.members) })}
                </span>
              </div>
            </div>
          ) : null}
          {state === 'mine' ? (
            <p>{t(ok.pack ? 'invite.minePack' : 'invite.mineFriend')}</p>
          ) : state === 'inPack' ? (
            <p>{t('invite.inPack', { name })}</p>
          ) : state === 'friends' ? (
            <p>{t('invite.alreadyFriends', { name })}</p>
          ) : (
            <p>{t(ok.pack ? 'invite.whatPack' : 'invite.whatFriend', { name })}</p>
          )}
          {ok.pack?.full && !state && <p className="mc-warn">{t('invite.full')}</p>}
          {busy && ok.pack && <p className="mc-hint">{t('invite.installing')}</p>}
          {!user && (
            <div className="inv-signin">
              <p className="mc-warn">{t('invite.needAccount')}</p>
              <div className="row-buttons">
                <button className="mc-btn mc-btn-emerald" onClick={() => setSignIn('up')}>
                  <UserPlus size={16} /> {t('account.signUp')}
                </button>
                <button className="mc-btn" onClick={() => setSignIn('in')}>
                  <LogIn size={16} /> {t('account.signIn')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
