import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Film, Loader2, Maximize, Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { SHOT_HOTKEY, type CaptureItem } from '@shared/capture'
import { mediaUrl, type ChatMedia } from '@shared/chat'
import { hotkeyLabel } from '@shared/hotkey'
import { invoke, on } from '../../api'
import { useStore } from '../../store'
import { useT } from '../../i18n'
import { Menu } from '../Menu'
import { Lightbox } from '../Lightbox'

const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Elegir una captura o un clip tuyo para mandarlo: por pestañas (capturas / clips) y por juego, lo último primero */
export function CapturePicker({ anchor, onPick, onClose }: { anchor: HTMLElement; onPick: (c: CaptureItem) => void; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const s = useStore((st) => st.settings)
  const lang = s?.lang ?? 'es'
  const [items, setItems] = useState<CaptureItem[] | null>(null)
  const [kind, setKind] = useState<'image' | 'video'>('image')
  useEffect(() => {
    void invoke('capture:list').then(setItems)
    return on('captures', setItems)
  }, [])
  // Por juego: primero el de lo más reciente (la lista ya viene de lo más nuevo a lo más viejo)
  const groups = useMemo(() => {
    const by = new Map<string, CaptureItem[]>()
    for (const c of items ?? []) if (c.kind === kind) by.set(c.game, [...(by.get(c.game) ?? []), c])
    return [...by.entries()]
  }, [items, kind])
  const count = (k: 'image' | 'video'): number => (items ?? []).filter((c) => c.kind === k).length
  const key = hotkeyLabel(s?.shotHotkey || SHOT_HOTKEY, lang)
  const when = (at: number): string => new Date(at).toLocaleString(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <Menu anchor={anchor} onClose={onClose} closeOnClick={false} className="cp cp-captures" align="left">
      <div className="seg cp-cap-tabs" role="tablist">
        {(['image', 'video'] as const).map((k) => (
          <button key={k} role="tab" className={kind === k ? 'on' : ''} aria-selected={kind === k} onClick={() => setKind(k)}>
            {k === 'image' ? <Camera size={14} /> : <Film size={14} />} {t(k === 'image' ? 'chat.media.shots' : 'chat.media.clips')}
            <span className="cp-cap-n num">{count(k)}</span>
          </button>
        ))}
      </div>
      {items && !groups.length ? (
        <div className="cp-empty">{t(kind === 'image' ? 'chat.media.empty' : 'chat.media.noClips', { key })}</div>
      ) : (
        <div key={kind} className="cp-cap-scroll">
          {groups.map(([game, list]) => (
            <section key={game}>
              <h4 className="cp-cap-game">
                <span>{game}</span>
                <span className="num">{list.length}</span>
              </h4>
              <div className="cp-cap-grid">
                {list.map((c) => (
                  <button key={c.id} className="cp-cap" onClick={() => onPick(c)} title={`${game} · ${when(c.at)}`}>
                    <img src={`poxi-img://capture/${c.id}`} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                    <span className="cp-cap-badge num">{c.kind === 'video' ? clock(c.seconds ?? 0) : when(c.at)}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </Menu>
  )
}

/** Una captura o un clip dentro de un mensaje. Si ya no está en el servidor (a los 30 días), lo dice */
export function MediaView({ chat, media }: { chat: string; media: ChatMedia }): React.JSX.Element {
  const t = useT()
  const [gone, setGone] = useState(false)
  const [big, setBig] = useState(false)
  const src = mediaUrl(chat, media.id)
  const ratio = { aspectRatio: `${media.w} / ${media.h}` }
  if (gone) return <div className="cm-media cm-media-gone">{t('chat.media.gone')}</div>
  return (
    <figure className="cm-media-wrap">
      {media.kind === 'image' ? (
        <>
          <img
            className="cm-media"
            src={src}
            alt={media.game ?? t('chat.media.image')}
            loading="lazy"
            style={ratio}
            onClick={() => setBig(true)}
            onError={() => setGone(true)}
          />
          {big && <Lightbox images={[src]} index={0} onIndex={() => undefined} onClose={() => setBig(false)} />}
        </>
      ) : (
        <ClipPlayer src={src} ratio={ratio} onGone={() => setGone(true)} />
      )}
      {media.game && <figcaption className="cm-media-game">{media.game}</figcaption>}
    </figure>
  )
}

/** Reproductor propio (sin los controles de Chromium): reproducir, barra para ir a otro momento, sonido y pantalla completa */
function ClipPlayer({ src, ratio, onGone }: { src: string; ratio: React.CSSProperties; onGone: () => void }): React.JSX.Element {
  const t = useT()
  const box = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [muted, setMuted] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const toggle = (): void => {
    const v = video.current
    if (!v) return
    if (v.paused) void v.play().catch(() => undefined)
    else v.pause()
  }
  const seekTo = (clientX: number): void => {
    const v = video.current
    const r = bar.current?.getBoundingClientRect()
    if (!v || !r || !duration) return
    v.currentTime = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration
  }
  const onBarDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    seekTo(e.clientX)
  }
  return (
    <div ref={box} className={`clip ${playing ? 'playing' : ''}`} style={ratio}>
      <video
        ref={video}
        src={src}
        preload="metadata"
        playsInline
        muted={muted}
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onError={onGone}
      />
      {!playing && (
        <button className="clip-big" onClick={toggle} aria-label={t('chat.media.play')}>
          <Play size={26} fill="currentColor" />
        </button>
      )}
      {waiting && playing && <Loader2 className="clip-wait spin" size={28} />}
      <div className="clip-bar" onClick={(e) => e.stopPropagation()}>
        <button onClick={toggle} aria-label={playing ? t('chat.media.pause') : t('chat.media.play')}>
          {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        </button>
        <div
          ref={bar}
          className="clip-track"
          role="slider"
          aria-label={t('chat.media.seek')}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          tabIndex={0}
          onPointerDown={onBarDown}
          onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && seekTo(e.clientX)}
          onKeyDown={(e) => {
            const v = video.current
            if (!v) return
            if (e.key === 'ArrowRight') v.currentTime = Math.min(duration, v.currentTime + 5)
            if (e.key === 'ArrowLeft') v.currentTime = Math.max(0, v.currentTime - 5)
          }}
        >
          <i style={{ transform: `scaleX(${duration ? time / duration : 0})` }} />
        </div>
        <span className="clip-time num">
          {clock(time)} / {clock(duration)}
        </span>
        <button onClick={() => setMuted((m) => !m)} aria-label={muted ? t('chat.media.unmute') : t('chat.media.mute')}>
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
        <button
          onClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void box.current?.requestFullscreen())}
          aria-label={t('chat.media.fullscreen')}
        >
          <Maximize size={15} />
        </button>
      </div>
    </div>
  )
}
