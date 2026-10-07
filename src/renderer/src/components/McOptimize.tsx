import { useEffect, useState } from 'react'
import { Check, Loader2, Zap } from 'lucide-react'
import type { McInstance, McOptimizePlan } from '@shared/types'
import { invoke } from '../api'
import { navigate, toast } from '../store'
import { useT } from '../i18n'
import { Modal } from './Overlays'

// «Optimizar»: los mods de rendimiento que valen para la instancia, cada uno con su casilla; lo que ya tienes, lo que
// no existe para tu versión o choca con algo tuyo, tachado con el motivo. Vanilla: se crea una copia en Fabric.

export function OptimizeDialog({ inst, onClose }: { inst: McInstance; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const [plan, setPlan] = useState<McOptimizePlan | null | undefined>(undefined)
  const [off, setOff] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void invoke('mc:optimizePlan', inst.id)
      .catch(() => null)
      .then(setPlan)
  }, [inst.id])

  const adds = plan?.items.filter((i) => i.status === 'add') ?? []
  const chosen = adds.filter((i) => !off.includes(i.projectId)).map((i) => i.projectId)

  const go = async (): Promise<void> => {
    setBusy(true)
    const r = await invoke('mc:optimize', inst.id, chosen).catch(() => ({ ok: false, error: 'mc.downloadFailed' as const, id: undefined }))
    setBusy(false)
    if (r.error) return void toast({ kind: 'error', key: r.error })
    toast({ kind: 'success', key: 'mc.optimize.done', params: { n: String(chosen.length) } })
    onClose()
    if (r.id && r.id !== inst.id) navigate({ name: 'mcInstance', id: r.id })
  }

  return (
    <Modal
      className="mc-modal mc-optimize"
      title={t('mc.optimize.title', { name: inst.name })}
      onClose={busy ? () => undefined : onClose}
      actions={
        <>
          <button className="mc-btn" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </button>
          {plan && adds.length > 0 && (
            <button className="mc-btn mc-btn-emerald" disabled={busy || !chosen.length} onClick={() => void go()}>
              {busy ? <Loader2 size={16} className="spin" /> : <Zap size={16} />} {t(plan.vanilla ? 'mc.optimize.goVanilla' : 'mc.optimize.go')}
            </button>
          )}
        </>
      }
    >
      <p>{t('mc.optimize.intro')}</p>
      {plan === undefined ? (
        <p className="mc-hint">
          <Loader2 size={16} className="spin" /> {t('mc.optimize.loading')}
        </p>
      ) : !plan ? (
        <p className="mc-warn">{t('mc.optimize.offline')}</p>
      ) : (
        <>
          {plan.vanilla && <p className="mc-warn">{t('mc.optimize.vanilla')}</p>}
          {inst.packId && !plan.vanilla && <p className="mc-hint">{t('mc.optimize.shared')}</p>}
          <ul className="opt-list">
            {plan.items.map((i) => {
              const on = i.status === 'add' && !off.includes(i.projectId)
              return (
                <li key={i.projectId} className={i.status === 'add' ? '' : 'opt-off'}>
                  {i.status === 'add' ? (
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      className={`check-box opt-check ${on ? 'on' : ''}`}
                      disabled={busy}
                      onClick={() => setOff((o) => (on ? [...o, i.projectId] : o.filter((x) => x !== i.projectId)))}
                    >
                      {on && <Check size={14} strokeWidth={3.5} />}
                    </button>
                  ) : (
                    <span className="opt-mark">{i.status === 'have' ? <Check size={16} /> : '—'}</span>
                  )}
                  <span className="opt-text">
                    <b>{i.title}</b>
                    <small>
                      {i.status === 'have'
                        ? t('mc.optimize.have')
                        : i.status === 'none'
                          ? t('mc.optimize.none')
                          : i.status === 'conflict'
                            ? t('mc.optimize.conflict', { name: i.with ?? '' })
                            : t(`mc.optimize.mods.${i.key}`)}
                    </small>
                  </span>
                </li>
              )
            })}
          </ul>
          {!adds.length && <p className="mc-hint">{t('mc.optimize.nothing')}</p>}
          <p className="mc-hint">{t('mc.optimize.java', { gb: (plan.ramMB / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 }) })}</p>
          {busy && <p className="mc-hint">{t('mc.optimize.installing')}</p>}
        </>
      )}
    </Modal>
  )
}
