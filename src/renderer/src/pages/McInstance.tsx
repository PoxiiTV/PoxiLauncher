import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowUpCircle,
  Server,
  Share2,
  Swords,
  Globe,
  History,
  Loader2,
  Lock,
  MoreHorizontal,
  Package,
  RefreshCw,
  Search,
  Tag,
  Trash2,
  Undo2,
  Unlock,
  Replace,
  Zap
} from 'lucide-react'
import type { McContent, McContentKind, McInstance, McSnapshot, McUpdate } from '@shared/types'
import { invoke, on } from '../api'
import { goBack, navigate, setState, toast, useStore } from '../store'
import { useT } from '../i18n'
import { reportResult, snapshotLabel } from '../lib/mc'
import { formatBytes, formatRelative } from '../lib/format'
import { Menu } from '../components/Menu'
import { McPlay, versionLabel } from '../components/McPlay'
import { McExplore } from '../components/McExplore'
import { McWorlds } from '../components/McWorlds'
import { InviteDialog } from '../components/chat/Dialogs'
import { McServerTab } from '../components/McServer'
import { McCrashPanel, McInstanceMenu } from '../components/McInstanceMenu'
import { GroupHistory, PackBanner, ShareDialog } from '../components/McShare'
import { OptimizeDialog } from '../components/McOptimize'
import { RemoveContentDialog, TagsDialog, VersionsDialog } from '../components/McContentDialogs'
import grass from '../assets/mc/grass.webp'
import '../styles/minecraft.css'

// Una instancia de Minecraft: su contenido (mods, resource packs, shaders), buscar más en Modrinth y el historial
// de cambios con "volver a como estaba".

type Tab = 'content' | 'explore' | 'worlds' | 'server' | 'history'
const KINDS: McContentKind[] = ['mod', 'resourcepack', 'shader']

export function McInstancePage({ id }: { id: string }): React.JSX.Element {
  const t = useT()
  const mc = useStore((s) => s.mc)
  const inst = mc?.instances.find((i) => i.id === id) ?? null
  const [tab, setTab] = useState<Tab>('content')
  const [items, setItems] = useState<McContent[] | null>(null)
  const [task, setTask] = useState<{ done: number; total: number } | null>(null)
  const [sharing, setSharing] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [inviting, setInviting] = useState(false)
  const signedIn = useStore((s) => !!s.account.user)

  useEffect(() => {
    if (!mc) void invoke('mc:get').then((m) => setState({ mc: m }))
  }, [mc])

  // La instancia ya no existe (se acaba de borrar): de vuelta a la lista, sin dejar la pantalla vacía
  const gone = !!mc && !inst
  useEffect(() => {
    if (gone) navigate({ name: 'minecraft' })
  }, [gone])

  const reload = useCallback(() => {
    void invoke('mc:content', id)
      .then(setItems)
      .catch(() => setItems([]))
  }, [id])

  useEffect(() => {
    reload()
    const offContent = on('minecraftContent', (e) => e.instanceId === id && setItems(e.items))
    const offTask = on('minecraftTask', (e) => e.instanceId === id && setTask(e.done < e.total ? { done: e.done, total: e.total } : null))
    return () => {
      offContent()
      offTask()
    }
  }, [id, reload])

  // Al cerrar el juego, la lista puede haber cambiado (mods que añade el propio juego o que pusiste a mano)
  const running = mc?.running === id
  useEffect(() => {
    if (!running) reload()
  }, [running, reload])

  if (!mc || !inst) return <div className="page mc-page" />
  const pack = mc.packs.find((p) => p.id === inst.packId && !p.invited)

  return (
    <div className="page mc-page mc-inst">
      <header className="mc-panel mc-inst-head">
        <button className="mc-iconbtn" onClick={goBack} title={t('mc.inst.back')} aria-label={t('mc.inst.back')}>
          <ArrowLeft size={18} />
        </button>
        <span className="mc-slot">
          <img src={inst.icon || grass} alt="" draggable={false} />
        </span>
        <div className="mc-inst-title">
          <h1 className="mc-display" title={inst.name}>
            {inst.name}
          </h1>
          <span className="mc-card-version">
            {versionLabel(inst, t)}
            {inst.loaderVersion ? <small> · {inst.loaderVersion}</small> : null}
          </span>
        </div>
        {running && signedIn && (
          <button className="mc-btn mc-btn-lapis" onClick={() => setInviting(true)} title={t('chat.invite.mcHint')} aria-label={t('chat.invite.friendsButton')}>
            <Swords size={16} /> <span className="mc-hb-label">{t('chat.invite.friendsButton')}</span>
          </button>
        )}
        <button className="mc-btn" onClick={() => setOptimizing(true)} title={t('mc.optimize.hint')} aria-label={t('mc.optimize.button')}>
          <Zap size={16} /> <span className="mc-hb-label">{t('mc.optimize.button')}</span>
        </button>
        <button
          className={`mc-btn ${inst.packId ? 'mc-btn-lapis' : ''}`}
          onClick={() => setSharing(true)}
          title={inst.packId ? t('mc.share.badge') : t('mc.share.button')}
          aria-label={inst.packId ? t('mc.share.badge') : t('mc.share.button')}
        >
          <Share2 size={16} /> <span className="mc-hb-label">{inst.packId ? t('mc.share.badge') : t('mc.share.button')}</span>
        </button>
        <div className="mc-inst-play">
          <McPlay inst={inst} mc={mc} big />
        </div>
        <McInstanceMenu inst={inst} mc={mc} />
      </header>

      <McCrashPanel inst={inst} />
      {pack && mc.packDiffs[inst.id] && <PackBanner inst={inst} pack={pack} diff={mc.packDiffs[inst.id]} />}
      {sharing && <ShareDialog inst={inst} pack={pack} onClose={() => setSharing(false)} />}
      {optimizing && <OptimizeDialog inst={inst} onClose={() => setOptimizing(false)} />}
      {inviting && <InviteDialog onClose={() => setInviting(false)} />}

      <nav className="mc-tabs" role="tablist">
        {(['content', 'explore', 'worlds', 'server', 'history'] as Tab[]).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {k === 'content' ? <Package size={16} /> : k === 'explore' ? <Search size={16} /> : k === 'worlds' ? <Globe size={16} /> : k === 'server' ? <Server size={16} /> : <History size={16} />}
            {k === 'server' && mc.servers[inst.id]?.state === 'running' && <span className="mc-server-dot running" />}
            {t(`mc.inst.tabs.${k}`)}
            {k === 'content' && items ? <span className="mc-count-badge">{items.length}</span> : null}
          </button>
        ))}
      </nav>

      {task && (
        <div className="mc-task mc-panel">
          <span>
            <Loader2 size={15} className="spin" />{' '}
            {t('mc.content.installing', {
              done: task.done + 1,
              total: task.total
            })}
          </span>
          <div className="mc-bar">
            <div className="mc-bar-fill" style={{ width: `${(task.done / task.total) * 100}%` }} />
          </div>
        </div>
      )}

      {tab === 'content' && <ContentTab inst={inst} items={items} />}
      {tab === 'explore' && <McExplore inst={inst} installed={items ?? []} />}
      {tab === 'worlds' && <McWorlds inst={inst} running={running} />}
      {tab === 'server' && <McServerTab inst={inst} mc={mc} pack={pack} />}
      {tab === 'history' && pack && <GroupHistory inst={inst} pack={pack} />}
      {tab === 'history' && <HistoryTab inst={inst} />}
    </div>
  )
}

function ContentTab({ inst, items }: { inst: McInstance; items: McContent[] | null }): React.JSX.Element {
  const t = useT()
  const [kind, setKind] = useState<McContentKind>(inst.loader === 'vanilla' ? 'resourcepack' : 'mod')
  const [filter, setFilter] = useState('')
  const [updates, setUpdates] = useState<McUpdate[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [dialog, setDialog] = useState<{
    kind: 'versions' | 'tags' | 'remove'
    item: McContent
  } | null>(null)

  const list = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (items ?? []).filter(
      (c) => c.kind === kind && (!q || c.title.toLowerCase().includes(q) || c.tags?.some((x) => x.toLowerCase().includes(q)))
    )
  }, [items, kind, filter])

  // Etiquetas de este tipo: encendida si todo lo que la lleva está activado
  const tags = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const c of items ?? []) if (c.kind === kind) for (const g of c.tags ?? []) map.set(g, (map.get(g) ?? true) && c.enabled)
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [items, kind])

  const byFile = useMemo(() => new Map((updates ?? []).map((u) => [u.file, u])), [updates])

  const check = async (): Promise<void> => {
    setChecking(true)
    try {
      setUpdates(await invoke('mc:updates', inst.id))
    } catch {
      toast({ kind: 'error', key: 'mc.downloadFailed' })
    } finally {
      setChecking(false)
    }
  }

  const apply = async (versionIds: string[]): Promise<void> => {
    const r = await invoke('mc:setVersions', inst.id, versionIds, false)
    if (reportResult(r)) {
      toast({ kind: 'success', key: 'mc.updatedToast' })
      setUpdates((u) => (u ?? []).filter((x) => !versionIds.includes(x.versionId)))
    }
  }

  const toggle = async (c: McContent): Promise<void> => {
    reportResult(await invoke('mc:toggle', inst.id, [c.file], !c.enabled))
  }

  return (
    <section className="mc-content">
      <div className="mc-toolbar">
        <div className="mc-seg">
          {KINDS.map((k) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {t(`mc.content.kinds.${k}`)}
              <span className="mc-seg-count">{(items ?? []).filter((c) => c.kind === k).length}</span>
            </button>
          ))}
        </div>
        <input className="mc-input mc-filter" value={filter} placeholder={t('mc.content.filter')} onChange={(e) => setFilter(e.target.value)} />
        <div className="mc-toolbar-end">
          {updates?.length ? (
            <button className="mc-btn mc-btn-emerald" onClick={() => void apply(updates.map((u) => u.versionId))}>
              <ArrowUpCircle size={16} /> {t('mc.content.updateAll')} ({updates.length})
            </button>
          ) : (
            <button className="mc-btn" disabled={checking || !items?.some((c) => c.projectId)} onClick={() => void check()}>
              {checking ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
              {checking ? t('mc.content.checking') : updates ? t('mc.content.upToDate') : t('mc.content.checkUpdates')}
            </button>
          )}
        </div>
      </div>

      {!!tags.length && (
        <div className="mc-tags">
          {tags.map(([g, onAll]) => (
            <button
              key={g}
              className={`mc-tag-toggle ${onAll ? 'on' : ''}`}
              title={onAll ? t('mc.content.tagOff') : t('mc.content.tagOn')}
              onClick={async () => reportResult(await invoke('mc:toggleTag', inst.id, g, !onAll))}
            >
              <Tag size={13} /> {g}
            </button>
          ))}
        </div>
      )}

      {kind === 'mod' && inst.loader === 'vanilla' ? (
        <p className="mc-panel mc-note">{t('mc.content.vanillaMods')}</p>
      ) : !items ? (
        <p className="mc-hint mc-pad">
          <Loader2 size={15} className="spin" />
        </p>
      ) : !list.length ? (
        <div className="mc-panel mc-empty mc-empty-sm">
          <h3>{t('mc.content.empty')}</h3>
          <p>{t('mc.content.emptyHint')}</p>
        </div>
      ) : (
        <ul className="mc-cards">
          {list.map((c) => (
            <ContentRow
              key={c.file}
              c={c}
              update={byFile.get(c.file)}
              onToggle={() => void toggle(c)}
              onUpdate={(u) => void apply([u.versionId])}
              onDialog={(k) => setDialog({ kind: k, item: c })}
              onLock={async () =>
                void (await invoke('mc:editContent', inst.id, c.file, {
                  locked: !c.locked
                }))
              }
            />
          ))}
        </ul>
      )}

      {dialog?.kind === 'versions' && <VersionsDialog inst={inst} item={dialog.item} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'tags' && <TagsDialog inst={inst} item={dialog.item} all={items ?? []} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'remove' && <RemoveContentDialog inst={inst} item={dialog.item} all={items ?? []} onClose={() => setDialog(null)} />}
    </section>
  )
}

function ContentRow({
  c,
  update,
  onToggle,
  onUpdate,
  onDialog,
  onLock
}: {
  c: McContent
  update?: McUpdate
  onToggle: () => void
  onUpdate: (u: McUpdate) => void
  onDialog: (k: 'versions' | 'tags' | 'remove') => void
  onLock: () => void
}): React.JSX.Element {
  const t = useT()
  const more = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState(false)
  return (
    <li className={`mc-mod ${c.enabled ? '' : 'off'}`}>
      <div className="mc-mod-top">
        <span className="mc-slot mc-slot-sm">{c.icon ? <img src={c.icon} alt="" loading="lazy" draggable={false} /> : <Package size={20} />}</span>
        <div className="mc-row-text">
          <b title={c.title}>{c.title}</b>
          <span className="mc-row-sub" title={c.file}>
            {c.version ?? c.file}
          </span>
        </div>
        <button className={`mc-switch ${c.enabled ? 'on' : ''}`} role="switch" aria-checked={c.enabled} aria-label={c.title} onClick={onToggle} />
      </div>
      <div className="mc-mod-badges">
        {!c.projectId && <span className="mc-tag">{t('mc.content.manual')}</span>}
        {c.dependency && <span className="mc-tag">{t('mc.content.dependency')}</span>}
        {c.locked && (
          <span className="mc-tag mc-tag-gold">
            <Lock size={11} /> {t('mc.content.locked')}
          </span>
        )}
        {c.tags?.map((g) => (
          <span key={g} className="mc-tag mc-tag-soft">
            <Tag size={11} /> {g}
          </span>
        ))}
      </div>
      <div className="mc-mod-foot">
        <small>{formatBytes(c.size)}</small>
        {update && (
          <button className="mc-btn mc-btn-sm mc-btn-emerald" onClick={() => onUpdate(update)} title={t('mc.content.update', { v: update.to })}>
            <ArrowUpCircle size={14} /> {t('mc.content.updateShort')}
          </button>
        )}
        <button ref={more} className="mc-iconbtn" onClick={() => setMenu(true)} aria-label="…">
          <MoreHorizontal size={18} />
        </button>
        {menu && (
          <Menu anchor={more.current} onClose={() => setMenu(false)} className="mc-menu">
            {c.projectId && (
              <button onClick={() => onDialog('versions')}>
                <Replace size={16} /> {t('mc.content.menu.versions')}
              </button>
            )}
            {c.projectId && (
              <button onClick={onLock}>
                {c.locked ? <Unlock size={16} /> : <Lock size={16} />} {t(c.locked ? 'mc.content.menu.unlock' : 'mc.content.menu.lock')}
              </button>
            )}
            <button onClick={() => onDialog('tags')}>
              <Tag size={16} /> {t('mc.content.menu.tags')}
            </button>
            <button className="danger" onClick={() => onDialog('remove')}>
              <Trash2 size={16} /> {t('mc.content.menu.remove')}
            </button>
          </Menu>
        )}
      </div>
    </li>
  )
}

function HistoryTab({ inst }: { inst: McInstance }): React.JSX.Element {
  const t = useT()
  const [list, setList] = useState<McSnapshot[] | null>(null)
  const [working, setWorking] = useState(false)

  const load = useCallback(() => void invoke('mc:history', inst.id).then(setList), [inst.id])
  useEffect(() => {
    load()
    return on('minecraftContent', (e) => e.instanceId === inst.id && load())
  }, [inst.id, load])

  const restore = async (at: number): Promise<void> => {
    setWorking(true)
    const r = await invoke('mc:rollback', inst.id, at).finally(() => setWorking(false))
    if (reportResult(r) && !r.missing?.length) toast({ kind: 'success', key: 'mc.history.restored' })
  }

  return (
    <section className="mc-history">
      <div className="mc-panel mc-history-head">
        <div>
          <h2 className="mc-title">{t('mc.history.title')}</h2>
          <p>{t('mc.history.hint')}</p>
        </div>
        {/* Deshacer el último cambio = volver a la foto de antes (la más nueva es como está ahora) */}
        <button className="mc-btn mc-btn-gold" disabled={(list?.length ?? 0) < 2 || working} onClick={() => list?.[1] && void restore(list[1].at)}>
          {working ? <Loader2 size={16} className="spin" /> : <Undo2 size={16} />} {t('mc.history.undo')}
        </button>
      </div>
      {list && !list.length ? (
        <p className="mc-hint mc-pad">{t('mc.history.empty')}</p>
      ) : (
        <ul className="mc-list">
          {(list ?? []).map((s, i) => (
            <li key={s.at} className={`mc-row ${i === 0 ? 'mine' : ''}`}>
              <span className="mc-slot mc-slot-sm">
                <History size={18} />
              </span>
              <div className="mc-row-text">
                <b>{snapshotLabel(s, t)}</b>
                <span className="mc-row-sub">
                  {formatRelative(s.at, t)} · {new Date(s.at).toLocaleString()} · {t('mc.history.items', { n: s.count })}
                </span>
              </div>
              {i === 0 ? (
                <span className="mc-tag mc-tag-on">{t('mc.history.now')}</span>
              ) : (
                <button className="mc-btn mc-btn-sm" disabled={working} onClick={() => void restore(s.at)}>
                  <Undo2 size={14} /> {t('mc.history.restore')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
