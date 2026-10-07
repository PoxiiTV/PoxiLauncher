import { useEffect, useState } from 'react'
import { Check, Loader2, Plus, Trash2, TriangleAlert, X } from 'lucide-react'
import type { McContent, McInstance, McProjectVersion } from '@shared/types'
import { invoke } from '../api'
import { toast } from '../store'
import { useT } from '../i18n'
import { formatRelative } from '../lib/format'
import { reportResult } from '../lib/mc'
import { Modal } from './Overlays'

// Ventanas del contenido de una instancia: cambiar de versión, etiquetas y quitar (avisando de lo que depende)

export function VersionsDialog({ inst, item, onClose }: { inst: McInstance; item: McContent; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const [list, setList] = useState<McProjectVersion[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!item.projectId) return
    invoke('mc:projectVersions', inst.id, item.projectId, item.kind)
      .then(setList)
      .catch(() => {
        setList([])
        toast({ kind: 'error', key: 'mc.explore.failed' })
      })
  }, [inst.id, item.projectId, item.kind])

  const use = async (v: McProjectVersion): Promise<void> => {
    setBusy(v.id)
    const r = await invoke('mc:setVersions', inst.id, [v.id], true).finally(() => setBusy(null))
    if (reportResult(r)) onClose()
  }

  return (
    <Modal
      className="mc-modal"
      wide
      title={t('mc.content.versionsTitle', { name: item.title })}
      onClose={onClose}
      actions={
        <button className="mc-btn" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      {!list ? (
        <p className="mc-hint">
          <Loader2 size={15} className="spin" />
        </p>
      ) : (
        <ul className="mc-list mc-list-scroll">
          {list.map((v) => {
            const mine = v.id === item.versionId
            return (
              <li key={v.id} className={`mc-row ${mine ? 'mine' : ''}`}>
                <div className="mc-row-text">
                  <b>{v.number}</b>
                  <span className="mc-row-sub">
                    {v.name !== v.number && <>{v.name} · </>}
                    {formatRelative(new Date(v.date).getTime(), t)} · {v.loaders.join(', ')}
                    {v.type !== 'release' && <span className={`mc-tag ${v.type === 'alpha' ? 'mc-tag-red' : 'mc-tag-gold'}`}>{v.type}</span>}
                  </span>
                </div>
                {mine ? (
                  <span className="mc-tag mc-tag-on">
                    <Check size={12} /> {t('mc.content.current')}
                  </span>
                ) : (
                  <button className="mc-btn mc-btn-sm" disabled={!!busy} onClick={() => void use(v)}>
                    {busy === v.id && <Loader2 size={14} className="spin" />} {t('mc.content.use')}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}

export function TagsDialog({ inst, item, all, onClose }: { inst: McInstance; item: McContent; all: McContent[]; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const [tags, setTags] = useState<string[]>(item.tags ?? [])
  const [text, setText] = useState('')
  // Etiquetas que ya usas en otros elementos: a un clic
  const known = [...new Set(all.flatMap((c) => c.tags ?? []))].filter((g) => !tags.includes(g)).sort()

  const add = (g: string): void => {
    const v = g.trim().slice(0, 24)
    if (v && !tags.includes(v) && tags.length < 10) setTags([...tags, v])
    setText('')
  }

  const save = async (): Promise<void> => {
    await invoke('mc:editContent', inst.id, item.file, { tags })
    onClose()
  }

  return (
    <Modal
      className="mc-modal"
      title={t('mc.content.tagsTitle', { name: item.title })}
      onClose={onClose}
      actions={
        <>
          <button className="mc-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="mc-btn mc-btn-emerald" onClick={() => void save()}>
            {t('mc.edit.save')}
          </button>
        </>
      }
    >
      <p>{t('mc.content.tagsHint')}</p>
      <div className="mc-tags">
        {tags.map((g) => (
          <button key={g} className="mc-tag-toggle on" onClick={() => setTags(tags.filter((x) => x !== g))}>
            {g} <X size={12} />
          </button>
        ))}
      </div>
      <form
        className="mc-add-row"
        onSubmit={(e) => {
          e.preventDefault()
          add(text)
        }}
      >
        <input className="mc-input" value={text} maxLength={24} placeholder={t('mc.content.tagPlaceholder')} onChange={(e) => setText(e.target.value)} autoFocus />
        <button className="mc-btn" type="submit" disabled={!text.trim()}>
          <Plus size={16} /> {t('mc.content.addTag')}
        </button>
      </form>
      {!!known.length && (
        <div className="mc-tags">
          {known.map((g) => (
            <button key={g} className="mc-tag-toggle" onClick={() => add(g)}>
              <Plus size={12} /> {g}
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}

export function RemoveContentDialog({ inst, item, all, onClose }: { inst: McInstance; item: McContent; all: McContent[]; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const [orphans, setOrphans] = useState(true)
  const [busy, setBusy] = useState(false)
  // Lo que deja de funcionar si se quita (mismo cálculo que en el proceso principal)
  const needed = item.projectId ? all.filter((c) => c.file !== item.file && c.enabled && (c.requires ?? []).includes(item.projectId!)) : []
  const hasDeps = all.some((c) => c.dependency && c.projectId && (item.requires ?? []).includes(c.projectId))

  const remove = async (): Promise<void> => {
    setBusy(true)
    const r = await invoke('mc:remove', inst.id, [item.file], orphans && hasDeps).finally(() => setBusy(false))
    if (reportResult(r)) onClose()
  }

  return (
    <Modal
      className="mc-modal"
      title={t('mc.content.removeTitle', { name: item.title })}
      onClose={onClose}
      actions={
        <>
          <button className="mc-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="mc-btn mc-btn-redstone" disabled={busy} onClick={() => void remove()}>
            <Trash2 size={16} /> {t('mc.content.removeConfirm')}
          </button>
        </>
      }
    >
      {!!needed.length && (
        <p className="mc-warn">
          <TriangleAlert size={15} /> {t('mc.content.neededBy', { list: needed.map((c) => c.title).join(', ') })}
        </p>
      )}
      {hasDeps && (
        <label className="mc-check mc-pad-top">
          <input type="checkbox" checked={orphans} onChange={(e) => setOrphans(e.target.checked)} />
          {t('mc.content.orphans')}
        </label>
      )}
    </Modal>
  )
}
