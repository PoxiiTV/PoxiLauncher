import { useState } from 'react'
import { AlertTriangle, Loader2, Play, Square, Wrench, X } from 'lucide-react'
import type { McInstance, McIssue, McState } from '@shared/types'
import { invoke } from '../api'
import { toast } from '../store'
import type { T } from '../i18n'
import { useT } from '../i18n'
import { formatBytes } from '../lib/format'
import { Modal } from './Overlays'

/** "Fabric 1.21.1", "Vanilla 26.3" */
export const versionLabel = (inst: McInstance, t: T): string => `${t(`mc.loader.${inst.loader}`)} ${inst.version}`

/** Jugar, o cómo va la instalación, o "Jugando…" con el botón de cerrar el juego */
export function McPlay({ inst, mc, big = false }: { inst: McInstance; mc: McState; big?: boolean }): React.JSX.Element {
  const t = useT()
  const busy = mc.busy?.instanceId === inst.id ? mc.busy : null
  const running = mc.running === inst.id
  // Otra instancia instalándose o abierta
  const blocked = (!!mc.busy && !busy) || (!!mc.running && !running)
  const pct = busy && busy.total > 0 ? Math.min(1, busy.done / busy.total) : 0

  const [issues, setIssues] = useState<McIssue[] | null>(null)
  const [checking, setChecking] = useState(false)

  const launch = async (): Promise<void> => {
    const r = await invoke('mc:play', inst.id)
    if (!r.ok && r.error) toast({ kind: 'error', key: r.error })
  }
  // Antes, lo que haría que el juego se cerrara al abrirse (si la comprobación falla, se juega igual)
  const play = async (): Promise<void> => {
    setChecking(true)
    const found = await invoke('mc:preflight', inst.id).catch(() => [] as McIssue[])
    setChecking(false)
    if (found.length) setIssues(found)
    else await launch()
  }

  if (busy)
    return (
      <div className="mc-progress">
        <div className="mc-progress-label">
          <span>{t(`mc.stage.${busy.stage}`)}</span>
          {busy.total > 0 && (
            <span className="num">
              {/* El modpack cuenta archivos; lo demás, bytes */}
              {busy.stage === 'modpack' ? `${busy.done} / ${busy.total}` : `${formatBytes(busy.done)} / ${formatBytes(busy.total)}`}
            </span>
          )}
        </div>
        <div className="mc-bar">
          <div className={`mc-bar-fill ${busy.total > 0 ? '' : 'indeterminate'}`} style={{ width: busy.total > 0 ? `${pct * 100}%` : undefined }} />
        </div>
        {busy.stage !== 'launching' && busy.stage !== 'modpack' && busy.stage !== 'backup' && (
          <button className="mc-btn mc-btn-sm" onClick={() => void invoke('mc:cancel')}>
            <X size={14} /> {t('mc.cancel')}
          </button>
        )}
      </div>
    )

  if (running)
    return (
      <div className="mc-card-actions">
        <span className="mc-playing">{t('mc.playing')}</span>
        <button className="mc-btn mc-btn-redstone" onClick={() => void invoke('mc:stop')}>
          <Square size={14} /> {t('mc.stop')}
        </button>
      </div>
    )

  return (
    <>
      <button className={`mc-btn mc-btn-emerald mc-play ${big ? 'mc-play-big' : ''}`} disabled={blocked || checking} onClick={() => void play()}>
        {checking ? <Loader2 size={16} className="spin" /> : <Play size={16} />} {t('mc.play')}
      </button>
      {issues && (
        <IssuesDialog
          inst={inst}
          issues={issues}
          onClose={() => setIssues(null)}
          onPlay={() => {
            setIssues(null)
            void launch()
          }}
        />
      )}
    </>
  )
}

/** Avisos antes de jugar: qué pasa con cada mod y «Arreglar y jugar» (o jugar igualmente) */
function IssuesDialog({ inst, issues, onClose, onPlay }: { inst: McInstance; issues: McIssue[]; onClose: () => void; onPlay: () => void }): React.JSX.Element {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const fix = async (): Promise<void> => {
    setBusy(true)
    const r = await invoke('mc:fixIssues', inst.id).catch(() => ({ ok: false, error: 'mc.downloadFailed' as const }))
    setBusy(false)
    if (!r.ok) return void toast({ kind: 'error', key: r.error ?? 'mc.downloadFailed' })
    toast({ kind: 'success', key: 'mc.issues.fixed' })
    onPlay()
  }
  return (
    <Modal
      className="mc-modal"
      title={t('mc.issues.title')}
      onClose={busy ? () => undefined : onClose}
      actions={
        <>
          <button className="mc-btn" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="mc-btn" disabled={busy} onClick={onPlay}>
            {t('mc.issues.playAnyway')}
          </button>
          <button className="mc-btn mc-btn-emerald" disabled={busy} onClick={() => void fix()}>
            {busy ? <Loader2 size={16} className="spin" /> : <Wrench size={16} />} {t('mc.issues.fixPlay')}
          </button>
        </>
      }
    >
      <p>{t('mc.issues.intro')}</p>
      <ul className="opt-list">
        {issues.map((i, n) => (
          <li key={n}>
            <span className="opt-mark warn">
              <AlertTriangle size={16} />
            </span>
            <span className="opt-text">
              <b>{t(`mc.issues.${i.kind}`, { mod: i.mod, other: i.other ?? '' })}</b>
              <small>{t(`mc.issues.fix.${i.fix}`, { other: i.other ?? '', n: String(i.files?.length ?? 1) })}</small>
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
