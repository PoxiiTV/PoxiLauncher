import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, Search, X } from 'lucide-react'
import { setState, useStore } from '../../store'
import { hotkeyLabel } from '@shared/hotkey'
import { SHOT_HOTKEY } from '@shared/capture'
import { useT } from '../../i18n'
import { CATS, CatBody, INDEX, type CatId } from './cats'
import '../../styles/settings.css'

// Ajustes como una ventana grande por encima de la app (que se ve detrás, desenfocada): menú propio agrupado, buscador
// y cada categoría en su vista. Esc cierra y vuelve a donde estabas.

const isCat = (c: string | undefined): c is CatId => !!c && CATS.some((x) => x.id === c)
/** La última categoría que viste (al volver a abrir Ajustes, sale esa) */
let lastCat: CatId = 'general'

/** Sin tildes ni mayúsculas, para buscar */
const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** ¿Hay algo encima (una ventana, un desplegable)? Entonces Esc es suyo */
const busy = (): boolean => !!document.querySelector('.modal-backdrop, .menu.floating, .mo-backdrop')

export function SettingsLayer(): React.JSX.Element | null {
  const open = useStore((s) => s.settingsOpen)
  if (!open) return null
  return <Layer key={`${open.cat ?? ''}-${open.row ?? ''}`} cat={isCat(open.cat) ? open.cat : lastCat} row={open.row} />
}

function Layer({ cat: first, row }: { cat: CatId; row?: string }): React.JSX.Element {
  const t = useT()
  const [cat, setCat] = useState<CatId>(first)
  const [q, setQ] = useState('')
  const [jump, setJump] = useState<string | null>(row ?? null)
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const win = useRef<HTMLDivElement>(null)
  // Abrir y cerrar como en Mac: la ventana sale del botón «Ajustes» de la barra lateral y vuelve a él
  const [origin, setOrigin] = useState<string>()
  const [closing, setClosing] = useState(false)
  useLayoutEffect(() => {
    const b = document.querySelector('[data-nav="settings"]')?.getBoundingClientRect()
    const w = win.current
    const layer = w?.offsetParent?.getBoundingClientRect()
    // offsetLeft/Top: la posición sin la animación (getBoundingClientRect ya sale encogida)
    if (b?.width && w && layer) setOrigin(`${b.left + b.width / 2 - layer.left - w.offsetLeft}px ${b.top + b.height / 2 - layer.top - w.offsetTop}px`)
  }, [])
  const close = (): void => {
    if (closing) return
    setClosing(true)
    setTimeout(() => setState({ settingsOpen: null }), 230)
  }

  const go = (c: CatId, to: string | null = null): void => {
    lastCat = c
    setCat(c)
    setQ('')
    setJump(to)
    scroller.current?.scrollTo({ top: 0 })
  }
  useEffect(() => {
    lastCat = first
  }, [first])

  // Esc cierra (si no hay otra cosa encima); Ctrl + F, al buscador
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'f' && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        input.current?.focus()
        input.current?.select()
        return
      }
      if (e.key !== 'Escape' || busy()) return
      if (q) return setQ('')
      close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [q])

  // Ir a una fila (desde el buscador): se busca en la vista y se resalta; si está dentro de algo plegado, su padre
  useEffect(() => {
    if (!jump || q) return
    const id = requestAnimationFrame(() => {
      let target = jump
      let el = scroller.current?.querySelector<HTMLElement>(`[data-row="${target}"]`)
      while (!el) {
        const parent = INDEX.find((x) => x.id === target)?.parent
        if (!parent) break
        target = parent
        el = scroller.current?.querySelector<HTMLElement>(`[data-row="${target}"]`)
      }
      if (!el) return
      el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
      el.classList.remove('pf-pulse')
      void el.offsetWidth
      el.classList.add('pf-pulse')
      setTimeout(() => el?.classList.remove('pf-pulse'), 2000)
      setJump(null)
    })
    return () => cancelAnimationFrame(id)
  }, [jump, cat, q])

  // El buscador: etiqueta, ayuda, palabras clave y el nombre de la categoría
  const shotKey = useStore((s) => hotkeyLabel(s.settings?.shotHotkey || SHOT_HOTKEY, s.settings?.lang ?? 'es'))
  const results = useMemo(() => {
    const n = norm(q.trim())
    if (!n) return []
    return INDEX.filter((x) => {
      const help = t(`prefs.${x.key}.help`, { key: shotKey })
      const text = [t(`prefs.${x.key}.label`), help.startsWith('prefs.') ? '' : help, x.kw ?? '', t(`prefs.cats.${x.cat}`)].join(' ')
      return n.split(/\s+/).every((w) => norm(text).includes(w))
    })
  }, [q, t, shotKey])

  const label = (k: string): string => {
    const v = t(`prefs.${k}.label`)
    return v.startsWith('prefs.') ? t(`prefs.${k}`) : v
  }
  const meta = CATS.find((c) => c.id === cat)!

  return createPortal(
    // Fuera de la ventana (el fondo desenfocado): un clic la cierra
    <div className={`pf-layer ${closing ? 'closing' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && !busy() && close()}>
      <div ref={win} className="pf-window" style={origin ? { transformOrigin: origin } : undefined} role="dialog" aria-modal="true" aria-label={t('prefs.title')}>
        <aside className="pf-side">
          <nav className="pf-nav">
            <div className={`pf-search ${q ? 'has' : ''}`}>
              <Search size={16} className="pf-search-i" />
              <input
                ref={input}
                type="text"
                value={q}
                placeholder={t('prefs.search')}
                aria-label={t('prefs.search')}
                spellCheck={false}
                onChange={(e) => setQ(e.target.value)}
              />
              <kbd className="pf-search-k">Ctrl F</kbd>
              <button className="pf-search-x" aria-label={t('prefs.clear')} onClick={() => setQ('')}>
                <X size={14} />
              </button>
            </div>
            {(['app', 'games', 'support'] as const).map((g) => (
              <div key={g} className="pf-nav-g">
                <div className="pf-nav-h">{t(`prefs.groups.${g}`)}</div>
                {CATS.filter((c) => c.group === g).map(({ id, Icon }) => (
                  <button
                    key={id}
                    className={`pf-nav-i ${!q && cat === id ? 'on' : ''}`}
                    aria-current={!q && cat === id ? 'page' : undefined}
                    onClick={() => go(id)}
                  >
                    <Icon size={17} />
                    <span>{t(`prefs.cats.${id}`)}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </aside>
        <div className="pf-main" ref={scroller}>
          <div className="pf-wrap">
            <div className="pf-host">
              {q ? (
                <div className="pf-results pf-enter" key="search">
                  {results.length ? (
                    <>
                      <p className="pf-res-h">
                        {results.length === 1 ? t('prefs.resultsOne', { q: q.trim() }) : t('prefs.results', { n: results.length, q: q.trim() })}
                      </p>
                      <div className="pf-card">
                        {results.map((r) => {
                          const C = CATS.find((c) => c.id === r.cat)!
                          const help = t(`prefs.${r.key}.help`, { key: shotKey })
                          return (
                            <button key={r.id} className="pf-res" onClick={() => go(r.cat, r.id)}>
                              <span className="pf-res-ic">
                                <C.Icon size={17} />
                              </span>
                              <span className="pf-res-t">
                                <b>{label(r.key)}</b>
                                <span>
                                  {t(`prefs.groups.${C.group}`)} › {t(`prefs.cats.${r.cat}`)}
                                  {help.startsWith('prefs.') ? '' : ` · ${help}`}
                                </span>
                              </span>
                              <ChevronRight size={18} />
                            </button>
                          )
                        })}
                      </div>
                    </>
                  ) : (
                    <div className="pf-empty">
                      <Search size={28} />
                      <b>{t('prefs.none', { q: q.trim() })}</b>
                      <span>{t('prefs.noneSub')}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="pf-enter" key={cat}>
                  <header className="pf-head">
                    <div className="pf-kicker">{t(`prefs.groups.${meta.group}`)}</div>
                    <h1 className="pf-title">{t(`prefs.cats.${cat}`)}</h1>
                    <p className="pf-sub">{t(`prefs.subs.${cat}`)}</p>
                  </header>
                  <CatBody id={cat} />
                </div>
              )}
            </div>
            <div className="pf-close">
              <button onClick={close} aria-label={t('prefs.close')}>
                <X size={20} />
              </button>
              <span>ESC</span>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
