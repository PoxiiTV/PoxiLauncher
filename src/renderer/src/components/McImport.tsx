import { useEffect, useMemo, useRef, useState } from 'react'
import { Check as CheckIcon, FolderInput, Loader2, SearchX, X } from 'lucide-react'
import type { McError, McImportable } from '@shared/types'
import { invoke } from '../api'
import { toast, useStore } from '../store'
import { useT } from '../i18n'
import { formatBytes } from '../lib/format'
import { Modal } from './Overlays'
import { Check } from './Moderation'

// «Trae tus instancias»: las de otros launchers (oficial, CurseForge, Prism Launcher, Modrinth App) agrupadas por
// launcher, cada una con su casilla. Se copian a instancias nuevas: los originales no se tocan. Y la oferta de la
// primera vez. Cada launcher va con un monograma de texto (nunca su logo).

type Launcher = McImportable['launcher']
const LAUNCHERS: Launcher[] = ['curseforge', 'modrinth', 'prism', 'official']
const MONOGRAM: Record<Launcher, string> = { official: 'ML', curseforge: 'CF', prism: 'PL', modrinth: 'MA' }

type Result = { id?: string; error?: McError; disabled?: string[] }

const pickable = (i: McImportable): boolean => !i.unsupported
/** Marcada al abrir: se puede traer, no se ha traído ya y no comparte carpeta con otra jugada después */
const byDefault = (i: McImportable): boolean => pickable(i) && !i.imported && !i.shares
const freshKeys = (list: McImportable[]): Set<string> => new Set(list.filter(byDefault).map((i) => i.key))

export function ImportDialog({ initial, onClose }: { initial?: McImportable[]; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const mc = useStore((s) => s.mc)
  const [list, setList] = useState<McImportable[] | null>(initial ?? null)
  const [picked, setPicked] = useState<Set<string>>(() => freshKeys(initial ?? []))
  const [worlds, setWorlds] = useState(true)
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<Record<string, Result>>({})
  // Ya se ha traído y hay algo que contar (mods desactivados, fallos): solo queda cerrar
  const [finished, setFinished] = useState(false)
  // Instancias que ya había al empezar (las nuevas de esta vez se reconocen por su origen)
  const [before, setBefore] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (initial) return
    void invoke('mc:importScan')
      .catch(() => [] as McImportable[])
      .then((l) => {
        setList(l)
        setPicked(freshKeys(l))
      })
  }, [initial])

  const groups = useMemo(() => LAUNCHERS.map((l) => ({ launcher: l, items: (list ?? []).filter((i) => i.launcher === l) })).filter((g) => g.items.length), [list])
  const chosen = (list ?? []).filter((i) => picked.has(i.key))
  const worldsSize = chosen.reduce((s, i) => s + i.worldsSize, 0)
  const total = chosen.reduce((s, i) => s + i.size + (worlds ? i.worldsSize : 0), 0)
  /** Cómo va cada una mientras se traen: la instancia nueva lleva la clave de su origen */
  const live = (key: string): RowState => {
    const made = mc?.instances.find((i) => i.importedFrom === key && !before.has(i.id))
    if (!made) return 'queued'
    if (mc?.busy?.stage === 'import' && mc.busy.instanceId === made.id) return { done: mc.busy.done, total: mc.busy.total }
    return made.incomplete ? { done: 0, total: 0 } : { id: made.id }
  }

  const toggle = (key: string): void =>
    setPicked((p) => {
      const n = new Set(p)
      if (!n.delete(key)) n.add(key)
      return n
    })

  const go = async (): Promise<void> => {
    // En el orden en que se ven
    const keys = groups.flatMap((g) => g.items.filter((i) => picked.has(i.key)).map((i) => i.key))
    setBefore(new Set(mc?.instances.map((i) => i.id)))
    setRunning(true)
    setResults({})
    const r: ({ key: string } & Result)[] = await invoke('mc:importRun', keys, worlds).catch(() => keys.map((key) => ({ key, error: 'mc.import.failed' as const })))
    setRunning(false)
    const ok = r.filter((x) => x.id)
    if (ok.length) {
      const one = list?.find((i) => i.key === ok[0].key)
      toast(ok.length === 1 && one ? { kind: 'success', key: 'mc.import.doneOne', params: { name: one.name } } : { kind: 'success', key: 'mc.import.doneMany', params: { n: String(ok.length) } })
    }
    if (!r.some((x) => x.error || x.disabled?.length)) return onClose()
    // Algo que contar (alguna ha fallado o lleva mods desactivados): se queda abierta con lo de cada una
    setFinished(true)
    setResults(Object.fromEntries(r.map((x) => [x.key, x])))
    setList((l) => l?.map((i) => ({ ...i, imported: r.find((x) => x.key === i.key)?.id ?? i.imported })) ?? l)
    setPicked(new Set())
  }

  return (
    <Modal
      className="mc-modal imp"
      wide
      title={t('mc.import.title')}
      onClose={running ? () => undefined : onClose}
      actions={
        list?.length && !finished ? (
          <>
            <button className="mc-btn" disabled={running} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button className="mc-btn mc-btn-emerald" disabled={running || !chosen.length} onClick={() => void go()}>
              {running ? <Loader2 size={16} className="spin" /> : <FolderInput size={16} />} {t('mc.import.go', { n: String(chosen.length) })}
            </button>
          </>
        ) : (
          <button className={`mc-btn ${finished ? 'mc-btn-emerald' : ''}`} onClick={onClose}>
            {t('common.close')}
          </button>
        )
      }
    >
      <p>{t('mc.import.intro')}</p>
      {!list ? (
        <p className="mc-hint imp-searching">
          <Loader2 size={16} className="spin" /> {t('mc.import.searching')}
        </p>
      ) : !list.length ? (
        <div className="mc-empty mc-empty-sm imp-empty">
          <SearchX size={32} />
          <b>{t('mc.import.emptyTitle')}</b>
          <p>{t('mc.import.empty')}</p>
        </div>
      ) : (
        <>
          <div className="imp-groups">
            {groups.map((g) => (
              <section key={g.launcher} className="imp-group">
                <header className="imp-group-head">
                  <span className={`imp-mono imp-mono-${g.launcher}`} aria-hidden>
                    {MONOGRAM[g.launcher]}
                  </span>
                  <b>{t(`mc.import.launchers.${g.launcher}`)}</b>
                  <span className="imp-count">{g.items.length}</span>
                </header>
                <ul className="imp-list">
                  {g.items.map((i) => (
                    <Row
                      key={i.key}
                      item={i}
                      on={picked.has(i.key)}
                      disabled={running || finished || !pickable(i)}
                      onToggle={() => toggle(i.key)}
                      state={results[i.key] ?? (running && picked.has(i.key) ? live(i.key) : null)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {!finished && (
            <div className="imp-foot">
              <Check on={worlds} onChange={(v) => !running && setWorlds(v)}>
                {worldsSize ? t('mc.import.worlds', { size: formatBytes(worldsSize) }) : t('mc.import.worldsPlain')}
              </Check>
              <span className="imp-total">{chosen.length > 0 && t('mc.import.total', { size: formatBytes(total) })}</span>
            </div>
          )}
          <p className="mc-hint imp-accounts">{t('mc.import.accounts')}</p>
        </>
      )}
    </Modal>
  )
}

type RowState = Result | 'queued' | { done: number; total: number } | null

function Row({ item: i, on, disabled, onToggle, state }: { item: McImportable; on: boolean; disabled: boolean; onToggle: () => void; state: RowState }): React.JSX.Element {
  const t = useT()
  const progress = state && typeof state === 'object' && 'total' in state ? state : null
  const result = state && typeof state === 'object' && !('total' in state) ? state : null
  // La que se está copiando, siempre a la vista
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (progress) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [!!progress]) // eslint-disable-line react-hooks/exhaustive-deps
  const meta = i.unsupported
    ? [t(i.unsupported)]
    : [
        `${t(`mc.loader.${i.loader}`)} ${i.version}`,
        ...(i.loader !== 'vanilla' ? [i.mods === 1 ? t('mc.import.modsOne') : t('mc.import.mods', { n: String(i.mods) })] : []),
        ...(i.worlds ? [i.worlds === 1 ? t('mc.import.worldsOne') : t('mc.import.worldsN', { n: String(i.worlds) })] : []),
        formatBytes(i.size + i.worldsSize)
      ]
  return (
    <li ref={ref} className={`imp-row ${i.unsupported ? 'imp-off' : ''}`}>
      <button type="button" role="checkbox" aria-checked={on} className={`imp-pick ${on ? 'on' : ''}`} disabled={disabled} onClick={onToggle}>
        <span className={`check-box ${on ? 'on' : ''}`} aria-hidden>
          {on && <CheckIcon size={14} strokeWidth={3.5} />}
        </span>
        <span className="imp-text">
          <b title={i.name}>{i.name}</b>
          <small title={meta.join(' · ')}>{meta.join(' · ')}</small>
          {result?.error && <small className="imp-why">{t(result.error)}</small>}
          {!!result?.disabled?.length && (
            <small className="imp-warn" title={result.disabled.join(', ')}>
              {t(result.disabled.length === 1 ? 'mc.import.disabledOne' : 'mc.import.disabled', { n: String(result.disabled.length), loader: t(`mc.loader.${i.loader}`), mc: i.version })}
            </small>
          )}
          {!result && i.shares && !i.imported && <small className="imp-note">{t(i.shares.mods ? 'mc.import.sharesAll' : 'mc.import.sharesWorlds', { name: i.shares.name })}</small>}
        </span>
      </button>
      <span className="imp-state">
        {progress ? (
          <span className="imp-progress">
            <span className="imp-progress-num">
              {formatBytes(progress.done)} / {formatBytes(progress.total)}
            </span>
            <span className="mc-bar">
              <span className="mc-bar-fill" style={{ width: `${progress.total ? Math.min(100, (progress.done / progress.total) * 100) : 0}%` }} />
            </span>
          </span>
        ) : state === 'queued' ? (
          <span className="mc-tag mc-tag-soft">{t('mc.import.queued')}</span>
        ) : result?.id ? (
          <span className="mc-tag imp-ok">
            <CheckIcon size={12} /> {t('mc.import.done')}
          </span>
        ) : result?.error ? (
          <X size={18} className="imp-x" aria-hidden />
        ) : i.imported ? (
          <span className="mc-tag mc-tag-gold">{t('mc.import.imported')}</span>
        ) : null}
      </span>
    </li>
  )
}

/** La primera vez: «Hemos encontrado N instancias en CurseForge y M en…» */
export function ImportOffer({ list, onOpen, onClose }: { list: McImportable[]; onOpen: () => void; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const lang = useStore((s) => s.settings?.lang ?? 'es')
  const fresh = list.filter(byDefault)
  const found = LAUNCHERS.map((l) => ({ l, n: fresh.filter((i) => i.launcher === l).length })).filter((x) => x.n)
  const text = new Intl.ListFormat(lang, { type: 'conjunction' }).format(
    found.map(({ l, n }) => (n === 1 ? t('mc.import.offer.countOne', { where: t(`mc.import.where.${l}`) }) : t('mc.import.offer.count', { n: String(n), where: t(`mc.import.where.${l}`) })))
  )
  return (
    <Modal
      className="mc-modal imp-offer"
      title={t('mc.import.offer.title')}
      onClose={onClose}
      actions={
        <>
          <button className="mc-btn" onClick={onClose}>
            {t('mc.import.offer.later')}
          </button>
          <button className="mc-btn mc-btn-emerald" onClick={onOpen}>
            <FolderInput size={16} /> {t('mc.import.offer.see')}
          </button>
        </>
      }
    >
      <div className="imp-offer-monos" aria-hidden>
        {found.map(({ l }) => (
          <span key={l} className={`imp-mono imp-mono-${l}`}>
            {MONOGRAM[l]}
          </span>
        ))}
      </div>
      <p>{t('mc.import.offer.text', { list: text })}</p>
    </Modal>
  )
}
