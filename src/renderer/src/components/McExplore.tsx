import { useEffect, useRef, useState } from 'react'
import { Check, Download, Loader2, Package, Search } from 'lucide-react'
import type { McContent, McContentKind, McHit, McInstance } from '@shared/types'
import { invoke } from '../api'
import { navigate, toast } from '../store'
import { useT } from '../i18n'
import { formatCount } from '../lib/format'
import { Select } from './Select'
import { reportResult } from '../lib/mc'

// Buscar en Modrinth lo que vale para la instancia (su versión y su loader) e instalarlo con un clic

type Sort = 'relevance' | 'downloads' | 'updated' | 'newest'

/** Con instancia: mods, resource packs y shaders para ella. Sin instancia: modpacks (cada uno crea la suya). */
export function McExplore({ inst, installed }: { inst: McInstance | null; installed: McContent[] }): React.JSX.Element {
  const t = useT()
  const [kind, setKind] = useState<McContentKind | 'modpack'>(!inst ? 'modpack' : inst.loader === 'vanilla' ? 'resourcepack' : 'mod')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('relevance')
  const [hits, setHits] = useState<McHit[] | null>(null)
  const [total, setTotal] = useState(0)
  const [failed, setFailed] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const seq = useRef(0)

  // Buscar al escribir (con una pausa corta para no pedir a cada tecla)
  useEffect(() => {
    const n = ++seq.current
    setHits(null)
    setFailed(false)
    const timer = setTimeout(() => {
      invoke('mc:search', inst?.id ?? null, q, kind, sort, 0)
        .then((r) => {
          if (n !== seq.current) return
          setHits(r.hits)
          setTotal(r.total)
        })
        .catch(() => n === seq.current && setFailed(true))
    }, 320)
    return () => clearTimeout(timer)
  }, [inst?.id, q, kind, sort])

  const more = async (): Promise<void> => {
    if (!hits) return
    setLoadingMore(true)
    try {
      const r = await invoke('mc:search', inst?.id ?? null, q, kind, sort, hits.length)
      setHits([...hits, ...r.hits.filter((h) => !hits.some((x) => x.id === h.id))])
    } catch {
      toast({ kind: 'error', key: 'mc.explore.failed' })
    } finally {
      setLoadingMore(false)
    }
  }

  const install = async (h: McHit): Promise<void> => {
    setInstalling(h.id)
    if (!inst || kind === 'modpack') {
      const m = await invoke('mc:installModpack', h.id).finally(() => setInstalling(null))
      if (m.error) toast({ kind: 'error', key: m.error })
      else if (m.id) {
        toast({ kind: 'success', key: 'mc.modpacks.installed', params: { name: h.title } })
        navigate({ name: 'mcInstance', id: m.id })
      }
      return
    }
    const r = await invoke('mc:install', inst.id, h.id, kind).finally(() => setInstalling(null))
    if (reportResult(r)) toast({ kind: 'success', key: 'mc.installedToast', params: { name: h.title } })
  }

  const have = new Set(installed.map((c) => c.projectId))
  const kinds: McContentKind[] = !inst ? [] : inst.loader === 'vanilla' ? ['resourcepack', 'shader'] : ['mod', 'resourcepack', 'shader']

  return (
    <section className="mc-explore">
      <div className="mc-toolbar">
        {!!kinds.length && (
          <div className="mc-seg">
            {kinds.map((k) => (
              <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
                {t(`mc.content.kinds.${k}`)}
              </button>
            ))}
          </div>
        )}
        <label className="mc-search">
          <Search size={16} />
          <input className="mc-input" value={q} placeholder={t('mc.explore.search')} onChange={(e) => setQ(e.target.value)} />
        </label>
        <Select
          value={sort}
          onChange={setSort}
          className="mc-select mc-select-sm"
          menuClassName="mc-menu"
          options={(['relevance', 'downloads', 'updated', 'newest'] as Sort[]).map((s) => ({ value: s, label: t(`mc.explore.sort.${s}`) }))}
          ariaLabel={t('mc.explore.sort.relevance')}
        />
      </div>

      {kind === 'shader' && <p className="mc-hint mc-pad">{t('mc.explore.shaderHint')}</p>}

      {failed ? (
        <p className="mc-warn">{t('mc.explore.failed')}</p>
      ) : !hits ? (
        <p className="mc-hint mc-pad">
          <Loader2 size={15} className="spin" />
        </p>
      ) : !hits.length ? (
        <p className="mc-hint mc-pad">{t('mc.explore.none')}</p>
      ) : (
        <>
          <ul className="mc-cards">
            {hits.map((h) => {
              const already = have.has(h.id)
              return (
                <li key={h.id} className="mc-mod">
                  <div className="mc-mod-top">
                    <span className="mc-slot mc-slot-sm">
                      {h.icon ? <img src={h.icon} alt="" loading="lazy" draggable={false} /> : <Package size={20} />}
                    </span>
                    <div className="mc-row-text">
                      <b title={h.title}>{h.title}</b>
                      <span className="mc-row-sub">{t('mc.explore.by', { author: h.author })}</span>
                    </div>
                  </div>
                  <p className="mc-mod-desc">{h.description}</p>
                  <div className="mc-mod-foot">
                    <small>
                      <Download size={12} /> {formatCount(h.downloads)}
                    </small>
                    {already ? (
                      <span className="mc-tag mc-tag-on">
                        <Check size={12} /> {t('mc.explore.installed')}
                      </span>
                    ) : (
                      <button className="mc-btn mc-btn-emerald mc-btn-sm" disabled={!!installing} onClick={() => void install(h)}>
                        {installing === h.id ? <Loader2 size={14} className="spin" /> : <Download size={14} />} {t('mc.explore.install')}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          {hits.length < total && (
            <div className="mc-more">
              <button className="mc-btn" disabled={loadingMore} onClick={() => void more()}>
                {loadingMore && <Loader2 size={16} className="spin" />} {t('mc.explore.more')}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
