import { useRef, useState } from 'react'
import { Cloud, Copy, FolderOpen, MoreHorizontal, PackageOpen, ScrollText, Server, Settings2, Trash2, TriangleAlert, Wrench, X } from 'lucide-react'
import type { McInstance, McState } from '@shared/types'
import { invoke } from '../api'
import { toast } from '../store'
import { useT } from '../i18n'
import { crashFixLabel, crashLabel, reportResult } from '../lib/mc'
import { Menu } from './Menu'
import { DeleteDialog, DuplicateDialog, EditDialog, LogDialog } from './McDialogs'

// Menú de una instancia (en su tarjeta y en su página) con sus ventanas, y el aviso de crasheo con su arreglo

type Dialog = 'edit' | 'log' | 'delete' | 'duplicate' | null

export function McInstanceMenu({ inst, mc }: { inst: McInstance; mc: McState }): React.JSX.Element {
  const t = useT()
  const more = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const inUse = mc.running === inst.id || mc.busy?.instanceId === inst.id

  // Un pack solo tuyo: la instancia queda en la nube (y en tus otros PCs sale para instalarla)
  const saveCloud = async (): Promise<void> => {
    const r = await invoke('mc:share', inst.id, [])
    toast(r.error ? { kind: 'error', key: r.error } : { kind: 'success', key: 'mc.cloud.saved' })
  }

  const exportPack = async (kind: 'mc:exportPack' | 'mc:exportServer'): Promise<void> => {
    const r = await invoke(kind, inst.id).catch(() => ({ ok: false }))
    if (r.ok) toast({ kind: 'success', key: 'mc.exported' })
  }

  return (
    <>
      <button ref={more} className="mc-iconbtn" onClick={() => setMenu(true)} aria-label="…">
        <MoreHorizontal size={18} />
      </button>
      {menu && (
        <Menu anchor={more.current} onClose={() => setMenu(false)} className="mc-menu">
          <button onClick={() => void invoke('mc:openFolder', inst.id)}>
            <FolderOpen size={16} /> {t('mc.menu.folder')}
          </button>
          <button onClick={() => setDialog('log')}>
            <ScrollText size={16} /> {t('mc.menu.log')}
          </button>
          <button onClick={() => setDialog('edit')}>
            <Settings2 size={16} /> {t('mc.menu.settings')}
          </button>
          {!inst.packId && (
            <button onClick={() => void saveCloud()}>
              <Cloud size={16} /> {t('mc.cloud.save')}
            </button>
          )}
          <button onClick={() => setDialog('duplicate')}>
            <Copy size={16} /> {t('mc.menu.duplicate')}
          </button>
          <button onClick={() => void exportPack('mc:exportPack')}>
            <PackageOpen size={16} /> {t('mc.menu.exportPack')}
          </button>
          {inst.loader !== 'vanilla' && (
            <button onClick={() => void exportPack('mc:exportServer')}>
              <Server size={16} /> {t('mc.menu.exportServer')}
            </button>
          )}
          <button className="danger" disabled={inUse} onClick={() => setDialog('delete')}>
            <Trash2 size={16} /> {t('mc.menu.delete')}
          </button>
        </Menu>
      )}
      {dialog === 'edit' && <EditDialog inst={inst} autoRamMB={mc.autoRamMB} onClose={() => setDialog(null)} />}
      {dialog === 'log' && <LogDialog inst={inst} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && <DeleteDialog inst={inst} onClose={() => setDialog(null)} />}
      {dialog === 'duplicate' && <DuplicateDialog inst={inst} onClose={() => setDialog(null)} />}
    </>
  )
}

/** "Minecraft se ha cerrado de golpe": qué ha pasado y un botón para arreglar cada cosa */
export function McCrashPanel({ inst }: { inst: McInstance }): React.JSX.Element | null {
  const t = useT()
  const [log, setLog] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)
  if (!inst.crash?.causes.length) return null

  const fix = async (i: number): Promise<void> => {
    const f = inst.crash?.causes[i]?.fix
    if (f?.type === 'log') return setLog(true)
    setBusy(i)
    const r = await invoke('mc:fixCrash', inst.id, i).finally(() => setBusy(null))
    if (reportResult(r)) toast({ kind: 'success', key: 'mc.crash.fixed' })
  }

  return (
    <section className="mc-panel mc-crash" role="alert">
      <div className="mc-crash-head">
        <TriangleAlert size={20} />
        <div>
          <h2>{t('mc.crash.title')}</h2>
          <p>{t('mc.crash.sub')}</p>
        </div>
        <button className="mc-iconbtn" title={t('mc.crash.dismiss')} aria-label={t('mc.crash.dismiss')} onClick={() => void invoke('mc:dismissCrash', inst.id)}>
          <X size={18} />
        </button>
      </div>
      <ul>
        {inst.crash.causes.map((c, i) => {
          const label = crashFixLabel(c, t)
          return (
            <li key={i}>
              <span>{crashLabel(c, t)}</span>
              {label && (
                <button className="mc-btn mc-btn-sm mc-btn-gold" disabled={busy !== null} onClick={() => void fix(i)}>
                  <Wrench size={14} /> {label}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {log && <LogDialog inst={inst} onClose={() => setLog(false)} />}
    </section>
  )
}
