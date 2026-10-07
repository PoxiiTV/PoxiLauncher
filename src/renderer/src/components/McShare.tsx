import { useState } from 'react'
import { ArrowRight, Check, Cloud, Loader2, LogOut, Minus, Plus, Share2, Trash2, Undo2, Users } from 'lucide-react'
import type { McInstance, McPack, McPackDiff, McState } from '@shared/types'
import { invoke } from '../api'
import { navigate, toast, useStore } from '../store'
import { useT } from '../i18n'
import { formatRelative } from '../lib/format'
import { packNoteLabel, reportResult } from '../lib/mc'
import { Avatar, useFriendName } from './Account'
import { Modal } from './Overlays'
import { InviteLinkBox } from './Invite'

// Packs compartidos con amigos: compartir, invitaciones, aviso de cambios del grupo (con qué cambia) e historial
// del grupo con "volver aquí" para todos.

export function ShareDialog({ inst, pack, onClose }: { inst: McInstance; pack: McPack | undefined; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const who = useFriendName()
  const { user, friends } = useStore((s) => s.account)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const inside = new Set([...(pack?.members ?? []), ...(pack?.pending ?? [])].map((m) => m.id))
  const candidates = friends.filter((f) => !inside.has(f.id))

  const invite = async (): Promise<void> => {
    setBusy(true)
    const r = await invoke('mc:share', inst.id, picked).finally(() => setBusy(false))
    if (r.error) return toast({ kind: 'error', key: r.error })
    toast({ kind: 'success', key: 'mc.share.invited' })
    setPicked([])
  }

  const leave = async (): Promise<void> => {
    const r = await invoke('mc:leavePack', inst.id)
    if (r.error) return toast({ kind: 'error', key: r.error })
    toast({ kind: 'info', key: 'mc.share.left' })
    onClose()
  }

  return (
    <Modal
      className="mc-modal"
      title={t('mc.share.title', { name: inst.name })}
      onClose={onClose}
      actions={
        <>
          {pack && (
            <button className="mc-btn mc-btn-redstone mc-actions-left" onClick={() => void leave()}>
              <LogOut size={16} /> {t('mc.share.leave')}
            </button>
          )}
          <button className="mc-btn" onClick={onClose}>
            {t('common.close')}
          </button>
          {user && (
            <button className="mc-btn mc-btn-emerald" disabled={!picked.length || busy} onClick={() => void invite()}>
              {busy ? <Loader2 size={16} className="spin" /> : <Share2 size={16} />} {t('mc.share.invite')}
            </button>
          )}
        </>
      }
    >
      <p>{t('mc.share.text')}</p>
      <p className="mc-hint">{t('mc.share.manualNote')}</p>
      {!user ? (
        <p className="mc-warn">{t('mc.share.signIn')}</p>
      ) : (
        <>
          {pack && (
            <div className="mc-field">
              <span>{t('mc.share.members')}</span>
              <div className="mc-people">
                {pack.members.map((m) => (
                  <span key={m.id} className="mc-person">
                    <Avatar name={who(m)} userId={m.id} /> {who(m)}
                  </span>
                ))}
                {pack.pending.map((m) => (
                  <span key={m.id} className="mc-person pending" title={t('mc.share.pending')}>
                    <Avatar name={who(m)} userId={m.id} /> {who(m)}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="mc-field">
            <span>{t('mc.share.invite')}</span>
            {!candidates.length ? (
              <p className="mc-hint">{t('mc.share.noFriends')}</p>
            ) : (
              <div className="mc-people">
                {candidates.map((f) => {
                  const on = picked.includes(f.id)
                  return (
                    <button
                      key={f.id}
                      className={`mc-person pick ${on ? 'on' : ''}`}
                      aria-pressed={on}
                      onClick={() => setPicked(on ? picked.filter((x) => x !== f.id) : [...picked, f.id].slice(0, 7))}
                    >
                      <Avatar name={f.username} userId={f.id} version={f.avatar} state={f.state} /> {f.username}
                      {on && <Check size={14} />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          {/* O con un enlace: también para quien aún no es tu amigo */}
          <InviteLinkBox instanceId={inst.id} mc />
        </>
      )}
    </Modal>
  )
}

/** Invitaciones a packs de amigos (en la portada de Minecraft) */
export function PackInvites({ mc }: { mc: McState }): React.JSX.Element | null {
  const t = useT()
  const who = useFriendName()
  const [busy, setBusy] = useState<string | null>(null)
  const invites = mc.packs.filter((p) => p.invited)
  if (!invites.length) return null

  const answer = async (p: McPack, accept: boolean): Promise<void> => {
    setBusy(p.id)
    const r = await invoke('mc:answerPack', p.id, accept).finally(() => setBusy(null))
    if (r.error) return toast({ kind: 'error', key: r.error })
    if (r.id) navigate({ name: 'mcInstance', id: r.id })
  }

  return (
    <section className="mc-panel mc-invites">
      <h2 className="mc-title">
        <Users size={16} /> {t('mc.pack.invites')}
      </h2>
      <ul>
        {invites.map((p) => (
          <li key={p.id}>
            <span className="mc-slot mc-slot-sm">{p.icon ? <img src={p.icon} alt="" /> : <Users size={18} />}</span>
            <span className="mc-row-text">
              <b>{t('mc.pack.invite', { user: who(p.owner), name: p.name })}</b>
              <span className="mc-row-sub">
                {t(`mc.loader.${p.loader}`)} {p.mc} · {t('mc.history.items', { n: p.items.length })}
              </span>
            </span>
            <button className="mc-btn mc-btn-sm" disabled={!!busy} onClick={() => void answer(p, false)}>
              {t('mc.pack.decline')}
            </button>
            <button className="mc-btn mc-btn-sm mc-btn-emerald" disabled={!!busy} onClick={() => void answer(p, true)}>
              {busy === p.id ? <Loader2 size={14} className="spin" /> : <Check size={14} />} {t('mc.pack.accept')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Aviso en la instancia: tu grupo ha cambiado el pack (qué cambia y ponerse al día) */
export function PackBanner({ inst, pack, diff }: { inst: McInstance; pack: McPack; diff: McPackDiff }): React.JSX.Element {
  const t = useT()
  const who = useFriendName()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const apply = async (): Promise<void> => {
    setBusy(true)
    const r = await invoke('mc:applyPack', inst.id).finally(() => setBusy(false))
    if (reportResult(r)) {
      toast({ kind: 'success', key: 'mc.pack.applied' })
      setOpen(false)
    }
  }
  const last = pack.history[0]
  return (
    <section className="mc-panel mc-pack-banner">
      <Users size={18} />
      <div>
        <b>{t('mc.pack.changes', { user: who(last?.by ?? pack.owner) })}</b>
        <small>{t('mc.pack.diff', { add: diff.add.length, remove: diff.remove.length, change: diff.change.length })}</small>
      </div>
      <button className="mc-btn mc-btn-sm" onClick={() => setOpen(true)}>
        {t('mc.pack.see')}
      </button>
      <button className="mc-btn mc-btn-sm mc-btn-emerald" disabled={busy} onClick={() => void apply()}>
        {busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />} {t('mc.pack.apply')}
      </button>
      {open && (
        <Modal
          className="mc-modal"
          wide
          title={t('mc.pack.diffTitle', { name: pack.name })}
          onClose={() => setOpen(false)}
          actions={
            <>
              <button className="mc-btn" onClick={() => setOpen(false)}>
                {t('common.close')}
              </button>
              <button className="mc-btn mc-btn-emerald" disabled={busy} onClick={() => void apply()}>
                {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />} {t('mc.pack.apply')}
              </button>
            </>
          }
        >
          <div className="mc-diff">
            {!!diff.add.length && (
              <div>
                <h3 className="mc-diff-add">
                  <Plus size={15} /> {t('mc.pack.added')}
                </h3>
                <ul>{diff.add.map((x) => <li key={x.projectId}>{x.title}</li>)}</ul>
              </div>
            )}
            {!!diff.change.length && (
              <div>
                <h3 className="mc-diff-change">
                  <ArrowRight size={15} /> {t('mc.pack.changed')}
                </h3>
                <ul>
                  {diff.change.map((x) => (
                    <li key={x.projectId}>
                      {x.title} <small>{x.from ? `${x.from} → ` : ''}{x.file}</small>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!!diff.remove.length && (
              <div>
                <h3 className="mc-diff-remove">
                  <Minus size={15} /> {t('mc.pack.removed')}
                </h3>
                <ul>{diff.remove.map((x) => <li key={x.projectId}>{x.title}</li>)}</ul>
              </div>
            )}
          </div>
        </Modal>
      )}
    </section>
  )
}

/** Historial del grupo (en la pestaña Historial de una instancia compartida) */
export function GroupHistory({ inst, pack }: { inst: McInstance; pack: McPack }): React.JSX.Element {
  const t = useT()
  const who = useFriendName()
  const [busy, setBusy] = useState<number | null>(null)
  const restore = async (rev: number): Promise<void> => {
    setBusy(rev)
    const r = await invoke('mc:rollbackPack', inst.id, rev).finally(() => setBusy(null))
    if (reportResult(r)) toast({ kind: 'success', key: 'mc.history.restored' })
  }
  return (
    <section className="mc-group-history">
      <div className="mc-panel mc-history-head">
        <div>
          <h2 className="mc-title">{t('mc.pack.groupHistory')}</h2>
          <p>{t('mc.pack.groupHint')}</p>
        </div>
      </div>
      <ul className="mc-list">
        {pack.history.map((h, i) => (
          <li key={h.rev} className={`mc-row ${i === 0 ? 'mine' : ''}`}>
            <Avatar name={who(h.by)} userId={h.by.id} />
            <div className="mc-row-text">
              <b>
                {who(h.by)} · {packNoteLabel(h.note, t)}
              </b>
              <span className="mc-row-sub">
                v{h.rev} · {formatRelative(h.at, t)} · {t('mc.history.items', { n: h.count })}
              </span>
            </div>
            {i > 0 && (
              <button className="mc-btn mc-btn-sm" disabled={busy !== null} onClick={() => void restore(h.rev)}>
                {busy === h.rev ? <Loader2 size={14} className="spin" /> : <Undo2 size={14} />} {t('mc.pack.restoreAll')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Instancias tuyas guardadas en PoxiLauncher que no están en este PC (otro PC tuyo, o guardadas en la nube) */
export function CloudPacks({ mc }: { mc: McState }): React.JSX.Element | null {
  const t = useT()
  const who = useFriendName()
  const [busy, setBusy] = useState<string | null>(null)
  const [removing, setRemoving] = useState<McPack | null>(null)
  const me = useStore((s) => s.account.user?.id)
  const here = new Set(mc.instances.map((i) => i.packId).filter(Boolean))
  const list = mc.packs.filter((p) => !p.invited && !here.has(p.id))
  if (!list.length) return null
  const install = async (p: McPack): Promise<void> => {
    setBusy(p.id)
    const r = await invoke('mc:installFromCloud', p.id).finally(() => setBusy(null))
    if (r.error) toast({ kind: 'error', key: r.error })
    if (r.id) navigate({ name: 'mcInstance', id: r.id })
  }
  const remove = async (p: McPack): Promise<void> => {
    setRemoving(null)
    setBusy(p.id)
    const r = await invoke('mc:removeCloudPack', p.id).finally(() => setBusy(null))
    toast(r.ok ? { kind: 'info', key: 'mc.cloud.removed', params: { name: p.name } } : { kind: 'error', key: r.error ?? 'mc.share.failed' })
  }
  // Los demás que lo tienen (si no queda nadie, se borra de la nube)
  const others = removing ? removing.members.filter((m) => m.id !== me) : []
  return (
    <section className="mc-panel mc-invites">
      <h2 className="mc-title">
        <Cloud size={16} /> {t('mc.cloud.title')}
      </h2>
      <p className="mc-hint mc-hint-block">{t('mc.cloud.hint')}</p>
      <ul>
        {list.map((p) => (
          <li key={p.id}>
            <span className="mc-slot mc-slot-sm">{p.icon ? <img src={p.icon} alt="" /> : <Cloud size={18} />}</span>
            <span className="mc-row-text">
              <b>{p.name}</b>
              <span className="mc-row-sub">
                {t(`mc.loader.${p.loader}`)} {p.mc} · {t('mc.history.items', { n: p.items.length })}
                {p.members.length > 1 && ` · ${p.members.map(who).join(', ')}`}
              </span>
            </span>
            <button className="mc-btn mc-btn-sm mc-btn-emerald" disabled={!!busy} onClick={() => void install(p)}>
              {busy === p.id ? <Loader2 size={14} className="spin" /> : <Cloud size={14} />} {t('mc.cloud.install')}
            </button>
            <button className="mc-btn mc-btn-sm" disabled={!!busy} onClick={() => setRemoving(p)} title={t('mc.cloud.remove')} aria-label={t('mc.cloud.remove')}>
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
      {removing && (
        <Modal
          className="mc-modal"
          title={t('mc.cloud.removeTitle', { name: removing.name })}
          onClose={() => setRemoving(null)}
          actions={
            <>
              <button className="mc-btn" onClick={() => setRemoving(null)}>
                {t('common.cancel')}
              </button>
              <button className="mc-btn mc-btn-redstone" onClick={() => void remove(removing)}>
                <Trash2 size={15} /> {t('mc.cloud.remove')}
              </button>
            </>
          }
        >
          <p className="mc-hint">
            {others.length ? t('mc.cloud.removeShared', { names: others.map(who).join(', ') }) : t('mc.cloud.removeLast')}
          </p>
        </Modal>
      )}
    </section>
  )
}
