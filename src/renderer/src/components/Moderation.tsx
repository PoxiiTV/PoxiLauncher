import { useState } from 'react'
import { Check as CheckIcon, Flag, Loader2, ShieldBan } from 'lucide-react'
import type { ReportReason } from '@shared/types'
import { invoke } from '../api'
import { toast } from '../store'
import { useT } from '../i18n'
import { Modal } from './Overlays'

// Bloquear y denunciar (en el chat, en el perfil de un amigo y en Mi cuenta), y la casilla propia de la app.

/** Casilla de la app (nunca la de Chromium): un botón con su cuadro y su texto */
export function Check({ on, onChange, children }: { on: boolean; onChange: (on: boolean) => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <button type="button" role="checkbox" aria-checked={on} className={`check-row ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <span className="check-box" aria-hidden>
        {on && <CheckIcon size={14} strokeWidth={3.5} />}
      </span>
      <span className="check-text">{children}</span>
    </button>
  )
}

const REASONS: ReportReason[] = ['harassment', 'spam', 'inappropriate', 'impersonation', 'other']

/** Denunciar una cuenta o uno de sus mensajes (con la opción de bloquearla a la vez) */
export function ReportDialog({
  user,
  message,
  onClose
}: {
  user: { id: string; name: string }
  /** Un mensaje concreto: su chat y su número */
  message?: { chat: string; id: number }
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [text, setText] = useState('')
  const [block, setBlock] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const send = async (): Promise<void> => {
    if (!reason) return
    setBusy(true)
    setError('')
    const r = await invoke('account:report', {
      kind: message ? 'message' : 'user',
      user: user.id,
      ...(message ? { chat: message.chat, message: message.id } : {}),
      reason,
      ...(text.trim() ? { text: text.trim() } : {})
    }).catch(() => ({ ok: false, error: 'offline' as const }))
    if (r.ok && block) await invoke('account:block', user.id).catch(() => null)
    setBusy(false)
    if (!r.ok) return setError(t(r.error === 'tooMany' ? 'moderation.tooMany' : `account.err.${r.error ?? 'offline'}`))
    toast({ kind: 'success', key: 'moderation.sent' })
    if (block) toast({ kind: 'info', key: 'moderation.blocked', params: { name: user.name } })
    onClose()
  }
  return (
    <Modal
      title={t(message ? 'moderation.reportMessageTitle' : 'moderation.reportTitle', { name: user.name })}
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-danger" disabled={!reason || busy} onClick={() => void send()}>
            {busy ? <Loader2 size={16} className="spin" /> : <Flag size={16} />} {t('moderation.send')}
          </button>
        </>
      }
    >
      <p className="muted">{t('moderation.reportIntro', { name: user.name })}</p>
      <div className="report-reasons" role="radiogroup" aria-label={t('moderation.reason')}>
        {REASONS.map((r) => (
          <button key={r} type="button" role="radio" aria-checked={reason === r} className={reason === r ? 'on' : ''} onClick={() => setReason(r)}>
            {t(`moderation.reasons.${r}`)}
          </button>
        ))}
      </div>
      <textarea className="input report-text" rows={3} maxLength={500} placeholder={t('moderation.details')} value={text} onChange={(e) => setText(e.target.value)} />
      <Check on={block} onChange={setBlock}>
        {t('moderation.alsoBlock', { name: user.name })}
      </Check>
      {error && <p className="err-text">{error}</p>}
    </Modal>
  )
}

/** Confirmar antes de bloquear (explica qué pasa) */
export function BlockDialog({ user, onClose, onDone }: { user: { id: string; name: string }; onClose: () => void; onDone?: () => void }): React.JSX.Element {
  const t = useT()
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      title={t('moderation.blockTitle', { name: user.name })}
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              const r = await invoke('account:block', user.id).catch(() => ({ ok: false }))
              setBusy(false)
              if (!r.ok) return void toast({ kind: 'error', key: 'account.err.offline' })
              toast({ kind: 'info', key: 'moderation.blocked', params: { name: user.name } })
              onClose()
              onDone?.()
            }}
          >
            <ShieldBan size={16} /> {t('moderation.block')}
          </button>
        </>
      }
    >
      <p className="muted">{t('moderation.blockText', { name: user.name })}</p>
    </Modal>
  )
}
