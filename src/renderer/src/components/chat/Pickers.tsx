import { useEffect, useMemo, useRef, useState } from 'react'
import { ImagePlus, Loader2, Plus, Search, Star, X } from 'lucide-react'
import { emoteUrl, packStickerUrl, STICKER_PACKS, userStickerUrl, type ChatGif, type Emote, type Sticker } from '@shared/chat'
import { favoriteEmotes, rememberEmotes, toggleFavorite } from '../../lib/emotes'
import { shrinkAnimated } from '../../lib/gifshrink'
import { Logo } from '../Logo'
import { invoke } from '../../api'
import { toast, useStore } from '../../store'
import { useT } from '../../i18n'
import { EMOJI_GROUPS } from '../../lib/emojis'
import { Menu } from '../Menu'

// Selectores del chat: todos propios (nada del de Windows ni del de Chromium), anclados a su botón.

/** Emotes animados de la app (salen de 7TV y los clásicos de BetterTTV): buscador, los más usados y tus favoritos */
function EmoteSearch({ onPick }: { onPick: (e: Emote) => void }): React.JSX.Element {
  const t = useT()
  const [q, setQ] = useState('')
  const [items, setItems] = useState<Emote[] | null>(null)
  const [off, setOff] = useState(false)
  const [favs, setFavs] = useState(favoriteEmotes)
  // Scroll infinito: la página siguiente se pide al acercarse al final
  const next = useRef<{ q: string; page: number; more: boolean; busy: boolean }>({ q: '', page: 1, more: false, busy: false })
  const [loadingMore, setLoadingMore] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const query = q.trim()
      setItems(null)
      setOff(false)
      next.current = { q: query, page: 1, more: false, busy: true }
      void invoke('chat:emotes', query)
        .then((r) => {
          if (next.current.q !== query) return
          next.current = { q: query, page: 1, more: !!r?.more, busy: false }
          if (r === null) setOff(true)
          else setItems(r.items)
        })
        .catch(() => setOff(true))
    }, 300)
    return () => clearTimeout(timer.current)
  }, [q])
  const loadMore = async (): Promise<void> => {
    const n = next.current
    if (!n.more || n.busy) return
    n.busy = true
    setLoadingMore(true)
    const r = await invoke('chat:emotes', n.q, n.page + 1).catch(() => null)
    setLoadingMore(false)
    if (next.current !== n) return
    n.busy = false
    n.page++
    n.more = !!r?.more
    // Sin repetidos (las páginas de 7TV a veces se solapan)
    if (r) setItems((x) => [...(x ?? []), ...r.items.filter((e) => !(x ?? []).some((y) => y.id === e.id))])
  }
  useEffect(() => {
    const el = end.current
    if (!el || !items) return
    const io = new IntersectionObserver((es) => es[0].isIntersecting && void loadMore(), { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  })
  const cell = (e: Emote): React.JSX.Element => (
    <div key={e.id} className="cp-emote">
      <button className="cp-emote-btn" onClick={() => onPick(e)} title={`:${e.name}:`}>
        <img src={emoteUrl(e.id, 2)} alt={e.name} loading="lazy" draggable={false} />
      </button>
      <button
        className={`cp-emote-fav ${favs.some((f) => f.id === e.id) ? 'on' : ''}`}
        onClick={() => setFavs(toggleFavorite(e))}
        title={t('chat.emoteFav')}
        aria-label={t('chat.emoteFav')}
      >
        <Star size={10} strokeWidth={3} />
      </button>
    </div>
  )
  return (
    <>
      <label className="cp-search">
        <Search size={15} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('chat.emoteSearch')} />
      </label>
      <div className="cp-emotes-scroll">
        {!q && favs.length > 0 && (
          <>
            <div className="cp-title">{t('chat.emoteFavs')}</div>
            <div className="cp-grid cp-emotes">{favs.map(cell)}</div>
          </>
        )}
        <div className="cp-title">{q ? t('chat.emoteResults') : t('chat.emotePopular')}</div>
        {off ? (
          <div className="cp-empty">{t('chat.emoteOff')}</div>
        ) : !items ? (
          <div className="cp-empty">
            <Loader2 size={20} className="spin" />
          </div>
        ) : items.length ? (
          <>
            <div className="cp-grid cp-emotes">{items.map(cell)}</div>
            <div ref={end} className="cp-more">
              {loadingMore && <Loader2 size={18} className="spin" />}
            </div>
          </>
        ) : (
          <div className="cp-empty">{t('chat.noResults')}</div>
        )}
      </div>
    </>
  )
}

/** Emojis por categorías (los últimos que usaste, primero) y, en el chat, los emotes animados */
export function EmojiPicker({
  anchor,
  onPick,
  onClose,
  onEmote
}: {
  anchor: HTMLElement
  onPick: (e: string) => void
  onClose: () => void
  /** Con esto aparece la pestaña de emotes (en reacciones no: allí solo van emojis) */
  onEmote?: (e: Emote) => void
}): React.JSX.Element {
  const t = useT()
  // En el chat se abre en los emotes; en reacciones (sin emotes), en los emojis
  const [group, setGroup] = useState(onEmote ? -2 : 0)
  const recent = useMemo(() => {
    try {
      return (JSON.parse(localStorage.getItem('chat.recentEmoji') ?? '[]') as string[]).slice(0, 16)
    } catch {
      return []
    }
  }, [])
  const pick = (e: string): void => {
    try {
      localStorage.setItem('chat.recentEmoji', JSON.stringify([e, ...recent.filter((x) => x !== e)].slice(0, 16)))
    } catch {
      /* sin memoria: no pasa nada */
    }
    onPick(e)
  }
  const shown = group === -1 ? recent : group === -2 ? [] : EMOJI_GROUPS[group].emojis
  return (
    <Menu anchor={anchor} onClose={onClose} closeOnClick={false} className="cp cp-emoji" align="left">
      <div className="cp-tabs">
        {onEmote && (
          <button className={`cp-tab-emotes ${group === -2 ? 'on' : ''}`} onClick={() => setGroup(-2)} title={t('chat.emotes')} aria-label={t('chat.emotes')}>
            <Logo size={20} />
          </button>
        )}
        {recent.length > 0 && (
          <button className={group === -1 ? 'on' : ''} onClick={() => setGroup(-1)} title={t('chat.recent')}>
            🕘
          </button>
        )}
        {EMOJI_GROUPS.map((g, i) => (
          <button key={g.id} className={group === i ? 'on' : ''} onClick={() => setGroup(i)} title={t(`chat.emojiGroups.${g.id}`)}>
            {g.icon}
          </button>
        ))}
      </div>
      {group === -2 && onEmote ? (
        <EmoteSearch
          onPick={(e) => {
            rememberEmotes([e])
            onEmote(e)
          }}
        />
      ) : (
        <div className="cp-grid">
          {shown.map((e) => (
            <button key={e} className="cp-emoji-btn" onClick={() => pick(e)}>
              {e}
            </button>
          ))}
        </div>
      )}
    </Menu>
  )
}

const MAX_STICKER = 512 * 1024

/** Deja una imagen en 512 KB: si pesa más se pasa a WebP de 320 px (un GIF no se puede reducir sin perder la animación) */
async function stickerBytes(file: File): Promise<Uint8Array | 'too-big'> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (file.size <= MAX_STICKER) return bytes
  // Animado (GIF o WebP con animación): se rehace el GIF más pequeño, con su animación
  if (file.type === 'image/gif' || (file.type === 'image/webp' && new TextDecoder('latin1').decode(bytes.subarray(0, 64)).includes('ANIM')))
    return (await shrinkAnimated(file, MAX_STICKER).catch(() => null)) ?? 'too-big'
  const img = await createImageBitmap(file)
  const k = Math.min(1, 320 / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * k)
  c.height = Math.round(img.height * k)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', 0.9))
  return blob && blob.size <= MAX_STICKER ? new Uint8Array(await blob.arrayBuffer()) : 'too-big'
}

/** Tus stickers: subir (botón propio) y quitar */
function MyStickers({ onPick }: { onPick: (s: Sticker) => void }): React.JSX.Element {
  const t = useT()
  const me = useStore((s) => s.account.user?.id)
  const [ids, setIds] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => void invoke('chat:stickers').then(setIds), [])
  const upload = async (f: File | undefined): Promise<void> => {
    if (!f) return
    setBusy(true)
    const bytes = await stickerBytes(f).catch(() => null)
    const r =
      bytes === 'too-big'
        ? { error: 'too-big' as const }
        : bytes
          ? await invoke('chat:stickerAdd', bytes).catch(() => ({
              error: 'offline' as const,
              id: undefined
            }))
          : { error: 'invalid' as const }
    setBusy(false)
    if ('id' in r && r.id) {
      const id = r.id
      setIds((x) => [id, ...(x ?? []).filter((y) => y !== id)])
    } else
      toast({
        kind: 'error',
        key:
          r.error === 'too-big'
            ? 'chat.err.stickerBig'
            : r.error === 'full'
              ? 'chat.err.stickerFull'
              : r.error === 'invalid'
                ? 'chat.err.stickerBad'
                : 'chat.err.sticker'
      })
  }
  return (
    <>
      <div className="cp-title">{t('chat.mine')}</div>
      <div className="cp-grid cp-stickers">
        <input
          ref={file}
          type="file"
          accept="image/gif,image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            void upload(f)
          }}
        />
        <button
          className="cp-sticker-btn cp-sticker-add"
          disabled={busy || (ids?.length ?? 0) >= 30}
          onClick={() => file.current?.click()}
          title={t('chat.stickerAdd')}
          aria-label={t('chat.stickerAdd')}
        >
          {busy ? <Loader2 size={22} className="spin" /> : <Plus size={24} />}
        </button>
        {me &&
          ids?.map((id) => (
            <div key={id} className="cp-sticker-mine">
              <button className="cp-sticker-btn" onClick={() => onPick({ kind: 'user', owner: me, id })}>
                <img src={userStickerUrl(me, id)} alt="" loading="lazy" />
              </button>
              <button
                className="cp-sticker-del"
                title={t('chat.stickerRemove')}
                aria-label={t('chat.stickerRemove')}
                onClick={() => void invoke('chat:stickerRemove', id).then((ok) => ok && setIds((x) => (x ?? []).filter((y) => y !== id)))}
              >
                <X size={11} strokeWidth={3} />
              </button>
            </div>
          ))}
      </div>
      {ids?.length === 0 && <p className="cp-mine-empty">{t('chat.mineEmpty')}</p>}
      <div className="cp-foot">{t('chat.stickerHint')}</div>
    </>
  )
}

/** Stickers: los tuyos (subidos) y los packs incluidos (animados al pasar el ratón) */
export function StickerPicker({ anchor, onPick, onClose }: { anchor: HTMLElement; onPick: (s: Sticker) => void; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const [pack, setPack] = useState(0)
  return (
    <Menu anchor={anchor} onClose={onClose} closeOnClick={false} className="cp cp-sticker" align="left">
      <div className="cp-tabs">
        <button className={pack === -1 ? 'on' : ''} onClick={() => setPack(-1)} title={t('chat.mine')} aria-label={t('chat.mine')}>
          <ImagePlus size={19} />
        </button>
        <button className={pack === -2 ? 'on' : ''} onClick={() => setPack(-2)} title={t('chat.stickerSearch')} aria-label={t('chat.stickerSearch')}>
          <Search size={18} />
        </button>
        {STICKER_PACKS.map((p, i) => (
          <button key={p.id} className={pack === i ? 'on' : ''} onClick={() => setPack(i)} title={t(`chat.packs.${p.id}`)}>
            <img src={packStickerUrl(p.icon, false)} alt="" />
          </button>
        ))}
      </div>
      {pack === -1 ? (
        <MyStickers onPick={onPick} />
      ) : pack === -2 ? (
        <KlipySearch kind="stickers" onPick={(g) => onPick({ kind: 'klipy', url: g.url })} />
      ) : (
        <>
          <div className="cp-title">{t(`chat.packs.${STICKER_PACKS[pack].id}`)}</div>
          <div className="cp-grid cp-stickers">
            {STICKER_PACKS[pack].codes.map((c) => (
              <button key={c} className="cp-sticker-btn" onClick={() => onPick({ kind: 'pack', code: c })}>
                {/* Animados también aquí (se cargan según se ven y quedan en caché) */}
                <img src={packStickerUrl(c)} alt="" loading="lazy" />
              </button>
            ))}
          </div>
          <div className="cp-foot">{t('chat.stickersCredit')}</div>
        </>
      )}
    </Menu>
  )
}

interface GifItem {
  id: string
  preview: string
  url: string
  w: number
  h: number
}

/** Buscador de KLIPY (a través de nuestro servidor: la clave nunca está en la app): GIFs o stickers animados */
function KlipySearch({ kind, onPick }: { kind: 'gifs' | 'stickers'; onPick: (g: GifItem) => void }): React.JSX.Element {
  const t = useT()
  const [q, setQ] = useState('')
  const [items, setItems] = useState<GifItem[] | null>(null)
  // Sin KLIPY en el servidor, o gastadas las búsquedas de esta hora (se comparten entre todos)
  const [off, setOff] = useState<'off' | 'limit' | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    clearTimeout(timer.current)
    // Busca al dejar de escribir: cada búsqueda gasta una llamada de KLIPY
    timer.current = setTimeout(() => {
      setItems(null)
      setOff(null)
      void invoke('chat:gifs', q.trim(), kind)
        .then((r) => {
          if (r === null || r === 'limit') setOff(r === null ? 'off' : 'limit')
          else setItems(r)
        })
        .catch(() => setOff('off'))
    }, 600)
    return () => clearTimeout(timer.current)
  }, [q, kind])
  return (
    <>
      <label className="cp-search">
        <Search size={15} />
        {/* Lo pide KLIPY en su texto de búsqueda */}
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(kind === 'gifs' ? 'chat.gifSearch' : 'chat.stickerSearch')} />
      </label>
      {off ? (
        <div className="cp-empty">{t(off === 'limit' ? 'chat.gifLimit' : kind === 'gifs' ? 'chat.gifOff' : 'chat.stickerOff')}</div>
      ) : !items ? (
        <div className="cp-empty">
          <Loader2 size={20} className="spin" />
        </div>
      ) : (
        <div className={kind === 'gifs' ? 'cp-gifs' : 'cp-grid cp-stickers cp-klipy'}>
          {kind === 'gifs' ? (
            // Mosaico en dos columnas dentro de su caja con scroll (con alto fijo, las columnas se repartían a lo ancho)
            <div className="cp-gifs-cols">
              {items.map((g) => (
                <button key={g.id} className="cp-gif-btn" onClick={() => onPick(g)}>
                  <img src={g.preview} alt="" loading="lazy" style={{ aspectRatio: `${g.w} / ${g.h}` }} />
                </button>
              ))}
            </div>
          ) : (
            items.map((g) => (
              <button key={g.id} className="cp-sticker-btn" onClick={() => onPick(g)}>
                <img src={g.preview} alt="" loading="lazy" />
              </button>
            ))
          )}
          {!items.length && <div className="cp-empty">{t('chat.noResults')}</div>}
        </div>
      )}
      <div className="cp-foot">Powered by KLIPY</div>
    </>
  )
}

/** GIFs con buscador (KLIPY) */
export function GifPicker({ anchor, onPick, onClose }: { anchor: HTMLElement; onPick: (g: ChatGif) => void; onClose: () => void }): React.JSX.Element {
  return (
    <Menu anchor={anchor} onClose={onClose} closeOnClick={false} className="cp cp-gif" align="left">
      <KlipySearch kind="gifs" onPick={(g) => onPick({ url: g.url, w: g.w, h: g.h })} />
    </Menu>
  )
}

