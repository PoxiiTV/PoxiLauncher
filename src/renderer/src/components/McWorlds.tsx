import { useCallback, useEffect, useState } from 'react'
import { Archive, FolderOpen, Globe, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import type { McInstance, McWorld, McWorldBackup } from '@shared/types'
import { invoke } from '../api'
import { toast } from '../store'
import { useT } from '../i18n'
import { formatBytes, formatRelative } from '../lib/format'
import { Modal } from './Overlays'

// Mundos de una instancia: copias automáticas (al jugar) y manuales, restaurar y borrar

export function McWorlds({ inst, running }: { inst: McInstance; running: boolean }): React.JSX.Element {
  const t = useT()
  const [worlds, setWorlds] = useState<McWorld[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ world: string; backup: McWorldBackup } | null>(null)

  const load = useCallback(() => void invoke('mc:worlds', inst.id).then(setWorlds), [inst.id])
  // Al cerrar el juego puede haber mundos nuevos o copias nuevas
  useEffect(load, [load, running])

  const backup = async (w: string): Promise<void> => {
    setBusy(w)
    const r = await invoke('mc:backupWorld', inst.id, w).finally(() => setBusy(null))
    toast(r.ok ? { kind: 'success', key: 'mc.worlds.done' } : { kind: 'error', key: 'mc.worlds.failed' })
    load()
  }

  const restore = async (): Promise<void> => {
    if (!confirm) return
    const { world, backup: b } = confirm
    setConfirm(null)
    setBusy(world)
    const r = await invoke('mc:restoreWorld', inst.id, world, b.at).finally(() => setBusy(null))
    if (r.error) toast({ kind: 'error', key: r.error })
    else toast(r.ok ? { kind: 'success', key: 'mc.worlds.restored' } : { kind: 'error', key: 'mc.worlds.failed' })
    load()
  }

  if (!worlds)
    return (
      <p className="mc-hint mc-pad">
        <Loader2 size={15} className="spin" />
      </p>
    )

  return (
    <section className="mc-worlds">
      <p className="mc-hint mc-hint-block">{t('mc.worlds.hint')}</p>
      {!worlds.length ? (
        <div className="mc-panel mc-empty mc-empty-sm">
          <Globe size={32} />
          <p>{t('mc.worlds.empty')}</p>
        </div>
      ) : (
        <ul className="mc-cards mc-cards-wide">
          {worlds.map((w) => (
            <li key={w.id} className="mc-mod mc-world">
              <div className="mc-mod-top">
                <span className="mc-slot">{w.icon ? <img src={w.icon} alt="" draggable={false} className="pixel" /> : <Globe size={22} />}</span>
                <div className="mc-row-text">
                  <b title={w.id}>{w.id}</b>
                  <span className="mc-row-sub">
                    {formatRelative(w.lastPlayed, t)} · {formatBytes(w.size)}
                  </span>
                </div>
                <button className="mc-btn mc-btn-sm" disabled={!!busy || running} onClick={() => void backup(w.id)}>
                  {busy === w.id ? <Loader2 size={14} className="spin" /> : <Archive size={14} />} {t('mc.worlds.backup')}
                </button>
              </div>
              <div className="mc-backups">
                <div className="mc-backups-head">
                  <span>{t('mc.worlds.backups')}</span>
                  <button className="mc-iconbtn" title={t('mc.worlds.openFolder')} aria-label={t('mc.worlds.openFolder')} onClick={() => void invoke('mc:openBackups', inst.id, w.id)}>
                    <FolderOpen size={15} />
                  </button>
                </div>
                {!w.backups.length ? (
                  <small className="mc-hint">{t('mc.worlds.none')}</small>
                ) : (
                  <ul>
                    {w.backups.map((b) => (
                      <li key={b.at}>
                        <span className={`mc-tag ${b.auto ? 'mc-tag-soft' : 'mc-tag-gold'}`}>{t(b.auto ? 'mc.worlds.auto' : 'mc.worlds.manual')}</span>
                        <span className="mc-backup-when" title={new Date(b.at).toLocaleString()}>
                          {formatRelative(b.at, t)} · {formatBytes(b.size)}
                        </span>
                        <button className="mc-iconbtn" title={t('mc.worlds.restore')} aria-label={t('mc.worlds.restore')} disabled={!!busy || running} onClick={() => setConfirm({ world: w.id, backup: b })}>
                          <RotateCcw size={15} />
                        </button>
                        <button
                          className="mc-iconbtn mc-iconbtn-danger"
                          title={t('mc.worlds.delete')}
                          aria-label={t('mc.worlds.delete')}
                          disabled={!!busy}
                          onClick={async () => {
                            await invoke('mc:deleteBackup', inst.id, w.id, b.at)
                            load()
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {confirm && (
        <Modal
          className="mc-modal"
          title={t('mc.worlds.restoreTitle', { world: confirm.world })}
          onClose={() => setConfirm(null)}
          actions={
            <>
              <button className="mc-btn" onClick={() => setConfirm(null)}>
                {t('common.cancel')}
              </button>
              <button className="mc-btn mc-btn-gold" onClick={() => void restore()}>
                <RotateCcw size={16} /> {t('mc.worlds.restore')}
              </button>
            </>
          }
        >
          <p>{t('mc.worlds.restoreText', { date: new Date(confirm.backup.at).toLocaleString() })}</p>
        </Modal>
      )}
    </section>
  )
}
