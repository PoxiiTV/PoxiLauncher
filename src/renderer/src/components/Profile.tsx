import { useRef, useState } from 'react'
import { Check, ImagePlus, Loader2, Palette, RotateCcw, Save, Trash2 } from 'lucide-react'
import type { Friend } from '@shared/types'
import {
  FRAMES,
  MAX_ABOUT,
  MAX_CUSTOM,
  MAX_DISPLAY,
  MAX_PRONOUNS,
  NAME_EFFECTS,
  NAME_FONTS,
  richParts,
  BANNER_H,
  BANNER_W,
  MAX_BANNER,
  type BannerImage,
  type Badge,
  type ProfilePatch,
  type UserProfile
} from '@shared/profile'
import { invoke } from '../api'
import { getState, toast, useStore } from '../store'
import { useT } from '../i18n'
import { Avatar } from './Account'
import { ColorPicker } from './ColorPicker'
import { Select } from './Select'
import { Plate, plateRow } from './Plate'
import { Tip } from './Tip'
import '../styles/profile.css'

const HEX = /^#[0-9a-f]{6}$/i
const BADGE_EMOJI: Record<Badge, string> = { founder: '👑', pioneer: '🚀' }

/** Nombre con su estilo (colores, efecto y fuente del perfil) */
export function UserName({ name, profile, className = '' }: { name: string; profile?: UserProfile; className?: string }): React.JSX.Element {
  const n = profile?.name
  const [c1, c2] = (n?.colors ?? []).filter((c) => HEX.test(c))
  const style = c1 ? ({ '--n1': c1, '--n2': c2 ?? c1 } as React.CSSProperties) : undefined
  const cls = c1 ? `uname ${c2 ? 'grad' : 'solid'} fx-${n!.effect} font-${n!.font}` : 'uname'
  return (
    <span className={`${cls} ${className}`} style={style} data-text={name}>
      {name}
    </span>
  )
}

/** «Sobre mí» con su formato; los spoilers se destapan al pulsarlos */
export function RichText({ text }: { text: string }): React.JSX.Element {
  const [open, setOpen] = useState<number[]>([])
  return (
    <>
      {richParts(text).map((p, i) =>
        p.kind === 'bold' ? (
          <b key={i}>{p.text}</b>
        ) : p.kind === 'italic' ? (
          <em key={i}>{p.text}</em>
        ) : p.kind === 'spoiler' ? (
          <button key={i} className={`spoiler ${open.includes(i) ? 'open' : ''}`} onClick={() => setOpen((o) => [...o, i])}>
            {p.text}
          </button>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </>
  )
}

/** Banner subido (imagen o GIF animado) con su encuadre: se centra donde se eligió y se acerca con el zoom */
function BannerImg({ userId, banner }: { userId: string; banner: BannerImage }): React.JSX.Element {
  const pos = `${banner.x}% ${banner.y}%`
  return (
    <img
      className="pcard-banner-img"
      src={`poxi-img://banner/${userId}/${banner.v}`}
      alt=""
      draggable={false}
      style={{ objectPosition: pos, transform: `scale(${banner.zoom})`, transformOrigin: pos }}
    />
  )
}

/** La tarjeta de perfil: la tuya (vista previa del editor) y la de cada amigo */
export function ProfileCard({
  userId,
  name,
  username,
  profile,
  badges = [],
  avatar,
  state,
  presence,
  createdAt,
  actions,
  stats
}: {
  userId?: string
  /** El nombre que se ve (apodo, nombre visible o usuario) */
  name: string
  /** Su usuario (se enseña con @ si no es el que se ve) */
  username: string
  profile: UserProfile
  badges?: Badge[]
  avatar?: string | null
  state?: Friend['state']
  /** Qué está haciendo («Jugando a…», «Conectado»…) */
  presence?: string
  createdAt?: number
  actions?: React.ReactNode
  /** Cifras debajo de los botones (perfil de un amigo) */
  stats?: React.ReactNode
}): React.JSX.Element {
  const t = useT()
  const lang = useStore((s) => s.settings?.lang ?? 'es')
  const [t1, t2] = profile.theme ?? []
  const b = profile.banner
  const bannerStyle =
    b?.kind === 'color' ? { background: b.colors[1] ? `linear-gradient(120deg, ${b.colors[0]}, ${b.colors[1]})` : b.colors[0] } : undefined
  const cardStyle = t1 ? ({ '--pt1': t1, '--pt2': t2 } as React.CSSProperties) : undefined
  return (
    <section className={`pcard ${t1 ? 'themed' : ''}`} style={cardStyle}>
      <div className="pcard-banner" style={bannerStyle}>
        {b?.kind === 'image' && userId && <BannerImg userId={userId} banner={b} />}
      </div>
      <div className="pcard-body">
        <div className="pcard-top">
          <div className="pcard-avatar">
            <Avatar name={name} userId={userId} version={avatar} state={state} profile={profile} className="pcard-ava" />
          </div>
          {badges.length > 0 && (
            <div className="pcard-badges">
              {badges.map((x) => (
                <Tip key={x} className={`pbadge b-${x}`} label={t(`uprofile.badges.${x}`)} sub={t(`uprofile.badgeInfo.${x}`)}>
                  {BADGE_EMOJI[x]}
                </Tip>
              ))}
            </div>
          )}
        </div>
        <h2 className="pcard-name">
          <UserName name={name} profile={profile} />
        </h2>
        <div className="pcard-sub">
          {name !== username && <span>@{username}</span>}
          {profile.pronouns && <span>{profile.pronouns}</span>}
        </div>
        {profile.custom && (
          <div className="pcard-custom">
            {profile.custom.emoji && <span className="pcard-custom-emoji">{profile.custom.emoji}</span>}
            {profile.custom.text}
          </div>
        )}
        {presence && (
          <div className={`pcard-presence ${state ?? ''}`}>
            <i /> {presence}
          </div>
        )}
        {actions && <div className="pcard-actions">{actions}</div>}
        {stats}
        {profile.about && (
          <div className="pcard-block">
            <h3>{t('uprofile.about')}</h3>
            <p className="pcard-about">
              <RichText text={profile.about} />
            </p>
          </div>
        )}
        {createdAt && (
          <div className="pcard-since">
            {t('account.page.memberSince', {
              date: new Date(createdAt).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
            })}
          </div>
        )}
      </div>
    </section>
  )
}

// ——— Editor ———

const NAME_PRESETS = ['#ffffff', '#f43f5e', '#f97316', '#facc15', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899']
const BANNER_PRESETS = ['#1e1b4b', '#7c3aed', '#db2777', '#0ea5e9', '#059669', '#f59e0b', '#dc2626', '#111827']
type Duration = 'never' | '1h' | '4h' | 'today' | 'week'

function untilOf(d: Duration): number | null {
  const now = Date.now()
  if (d === '1h') return now + 3600_000
  if (d === '4h') return now + 4 * 3600_000
  if (d === 'week') return now + 7 * 86400_000
  if (d === 'today') {
    const e = new Date()
    e.setHours(23, 59, 59, 0)
    return e.getTime()
  }
  return null
}

/** Un color: los de siempre y cualquier otro con nuestro selector */
function ColorRow({ value, onChange, presets, label }: { value: string; onChange: (c: string) => void; presets: string[]; label: string }): React.JSX.Element {
  const btn = useRef<HTMLButtonElement>(null)
  const [picking, setPicking] = useState(false)
  const custom = !presets.includes(value)
  return (
    <div className="swatches pe-swatches" role="group" aria-label={label}>
      {presets.map((c) => (
        <button key={c} className={`swatch pe-swatch ${value === c ? 'on' : ''}`} style={{ background: c }} onClick={() => onChange(c)} aria-label={c} aria-pressed={value === c}>
          {value === c && <Check size={13} strokeWidth={3} />}
        </button>
      ))}
      <button
        ref={btn}
        className={`swatch pe-swatch pe-swatch-custom ${custom ? 'on' : ''}`}
        style={custom ? { background: value } : undefined}
        onClick={() => setPicking((p) => !p)}
        aria-label={label}
        aria-expanded={picking}
      >
        {custom ? <Check size={13} strokeWidth={3} /> : <Palette size={14} />}
      </button>
      {picking && <ColorPicker value={value} anchor={btn.current} onChange={onChange} onClose={() => setPicking(false)} />}
    </div>
  )
}

/** Encuadre del banner subido: se arrastra para elegir qué parte se ve (en la proporción de verdad, 5:2) */
function BannerFramer({ userId, banner, onChange }: { userId: string; banner: BannerImage; onChange: (b: BannerImage) => void }): React.JSX.Element {
  const t = useT()
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; bx: number; by: number } | null>(null)
  const clamp = (v: number): number => Math.round(Math.min(100, Math.max(0, v)) * 10) / 10
  return (
    <div
      ref={box}
      className="pe-framer"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, y: e.clientY, bx: banner.x, by: banner.y }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        const r = box.current?.getBoundingClientRect()
        if (!d || !r) return
        // Arrastrar a la derecha enseña lo de la izquierda (como mover una foto con la mano)
        const k = 100 / banner.zoom
        onChange({ ...banner, x: clamp(d.bx - ((e.clientX - d.x) / r.width) * k), y: clamp(d.by - ((e.clientY - d.y) / r.height) * k) })
      }}
      onPointerUp={() => (drag.current = null)}
    >
      <BannerImg userId={userId} banner={banner} />
      <span className="pe-framer-hint">{t('uprofile.edit.drag')}</span>
    </div>
  )
}

/** Interruptor propio (el de Ajustes), con su texto al lado */
function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }): React.JSX.Element {
  return (
    <div className="pe-switch">
      <span>{label}</span>
      <button className={`toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />
    </div>
  )
}

/** Buscar un juego del catálogo (para el banner y los favoritos) */
/** Lo que cambia respecto a lo guardado (lo quitado va como null o '', que el servidor borra) */
function patchOf(before: UserProfile, after: UserProfile): ProfilePatch {
  const out: ProfilePatch = {}
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof UserProfile>
  for (const k of keys) {
    if (JSON.stringify(before[k]) === JSON.stringify(after[k])) continue
    const v = after[k]
    ;(out as Record<string, unknown>)[k] =
      v === undefined ? (k === 'displayName' || k === 'pronouns' || k === 'about' ? '' : k === 'frame' ? 'none' : null) : v
  }
  return out
}

/** Mi cuenta → Personalizar perfil: los controles a la izquierda y la tarjeta en vivo a la derecha (te sigue al bajar) */
export function ProfileEditor(): React.JSX.Element | null {
  const t = useT()
  const user = useStore((s) => s.account.user)
  const saved = user?.profile ?? {}
  const [p, setP] = useState<UserProfile>(saved)
  const [duration, setDuration] = useState<Duration>(saved.custom?.until ? 'today' : 'never')
  const [busy, setBusy] = useState(false)
  const [bannerMode, setBannerMode] = useState<'color' | 'image'>(saved.banner?.kind === 'image' ? 'image' : 'color')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  if (!user) return null
  const set = (patch: Partial<UserProfile>): void => setP((x) => ({ ...x, ...patch }))
  const changed = JSON.stringify(saved) !== JSON.stringify(p)
  const name = p.name ?? { colors: ['#ffffff'], effect: 'none' as const, font: 'default' as const }
  // Sobre lo último (varios cambios seguidos no se pisan)
  const setName = (patch: Partial<NonNullable<UserProfile['name']>>): void =>
    setP((x) => ({ ...x, name: { colors: ['#ffffff'], effect: 'none', font: 'default', ...x.name, ...patch } }))
  const setCustom = (patch: Partial<NonNullable<UserProfile['custom']>>): void =>
    setP((x) => {
      const c = { emoji: '', text: '', until: null, ...x.custom, ...patch }
      return { ...x, custom: c.emoji || c.text ? c : undefined }
    })
  const bannerColors = p.banner?.kind === 'color' ? p.banner.colors : null
  const bannerImg = p.banner?.kind === 'image' ? p.banner : null

  // Se sube al momento (como la foto): la vista previa ya lo enseña animado
  const upload = async (f: File | undefined): Promise<void> => {
    if (fileRef.current) fileRef.current.value = ''
    if (!f) return
    if (f.size > MAX_BANNER) return void toast({ kind: 'error', key: 'uprofile.edit.bannerTooBig' })
    setUploading(true)
    const r = await invoke('account:setBanner', new Uint8Array(await f.arrayBuffer())).catch(() => ({ ok: false }))
    setUploading(false)
    if (!r.ok) return void toast({ kind: 'error', key: 'uprofile.edit.bannerBad' })
    const b = getState().account.user?.profile?.banner
    if (b?.kind === 'image') setP((x) => ({ ...x, banner: b }))
  }
  const removeImage = async (): Promise<void> => {
    setUploading(true)
    await invoke('account:removeBanner').catch(() => undefined)
    setUploading(false)
    setP((x) => ({ ...x, banner: undefined }))
  }

  const save = async (): Promise<void> => {
    const sameCustom = !!saved.custom && JSON.stringify(saved.custom) === JSON.stringify(p.custom)
    const next = { ...p, ...(p.custom ? { custom: { ...p.custom, until: sameCustom ? p.custom.until : untilOf(duration) } } : {}) }
    setBusy(true)
    const r = await invoke('account:setProfile', patchOf(saved, next)).catch(() => ({ ok: false, error: 'offline' as const }))
    setBusy(false)
    if (r.ok) {
      toast({ kind: 'success', key: 'uprofile.edit.saved' })
      setP(next)
    } else toast({ kind: 'error', key: r.error === 'taken' ? 'uprofile.edit.taken' : 'account.err.offline' })
  }

  return (
    <div className="pe">
      <div className="pe-controls">
        {/* Quién eres (y tu estado personalizado) */}
        <section className="panel pe-group">
          <h3 className="pe-title">{t('uprofile.edit.who')}</h3>
          <div className="pe-row2">
            <label className="pe-field">
              <span>{t('uprofile.edit.displayName')}</span>
              <input value={p.displayName ?? ''} maxLength={MAX_DISPLAY} placeholder={user.username} onChange={(e) => set({ displayName: e.target.value || undefined })} />
            </label>
            <label className="pe-field">
              <span>{t('uprofile.edit.pronouns')}</span>
              <input value={p.pronouns ?? ''} maxLength={MAX_PRONOUNS} placeholder={t('uprofile.edit.pronounsHint')} onChange={(e) => set({ pronouns: e.target.value || undefined })} />
            </label>
          </div>
          <small className="pe-hint">{t('uprofile.edit.displayNameSub')}</small>
          <label className="pe-field">
            <span>
              {t('uprofile.edit.about')} <em className="num">{(p.about ?? '').length}/{MAX_ABOUT}</em>
            </span>
            <textarea value={p.about ?? ''} maxLength={MAX_ABOUT} rows={3} placeholder={t('uprofile.edit.aboutHint')} onChange={(e) => set({ about: e.target.value || undefined })} />
          </label>
          <small className="pe-hint">{t('uprofile.edit.aboutSub')}</small>
          <div className="pe-sub">{t('uprofile.edit.custom')}</div>
          <div className="pe-custom">
            <input className="pe-emoji" value={p.custom?.emoji ?? ''} maxLength={8} placeholder="🎮" onChange={(e) => setCustom({ emoji: e.target.value })} aria-label={t('uprofile.edit.customEmoji')} />
            <input value={p.custom?.text ?? ''} maxLength={MAX_CUSTOM} placeholder={t('uprofile.edit.customHint')} onChange={(e) => setCustom({ text: e.target.value })} />
            <Select<Duration>
              ariaLabel={t('uprofile.edit.customUntil')}
              value={duration}
              onChange={setDuration}
              options={(['never', '1h', '4h', 'today', 'week'] as const).map((d) => ({ value: d, label: t(`uprofile.until.${d}`) }))}
            />
          </div>
        </section>

        {/* Estilo del nombre */}
        <section className="panel pe-group">
          <div className="pe-title-row">
            <h3 className="pe-title">{t('uprofile.edit.nameStyle')}</h3>
            {p.name && (
              <button className="link-btn" onClick={() => set({ name: undefined })}>
                {t('uprofile.edit.resetName')}
              </button>
            )}
          </div>
          <ColorRow label={t('uprofile.edit.color1')} presets={NAME_PRESETS} value={name.colors[0]} onChange={(c) => setName({ colors: [c, ...name.colors.slice(1)] })} />
          <Switch on={name.colors.length > 1} label={t('uprofile.edit.gradient')} onChange={(v) => setName({ colors: v ? [name.colors[0], '#8b5cf6'] : [name.colors[0]] })} />
          {name.colors.length > 1 && (
            <ColorRow label={t('uprofile.edit.color2')} presets={NAME_PRESETS} value={name.colors[1]} onChange={(c) => setName({ colors: [name.colors[0], c] })} />
          )}
          <div className="pe-sub">{t('uprofile.edit.effect')}</div>
          <div className="pe-tiles">
            {NAME_EFFECTS.map((e) => (
              <button key={e} className={`pe-tile ${name.effect === e ? 'on' : ''}`} aria-pressed={name.effect === e} onClick={() => setName({ effect: e })}>
                <UserName name={t(`uprofile.effects.${e}`)} profile={{ name: { colors: name.colors.length > 1 ? name.colors : [name.colors[0], name.colors[0]], effect: e, font: 'default' } }} />
              </button>
            ))}
          </div>
          <div className="pe-sub">{t('uprofile.edit.font')}</div>
          <div className="pe-tiles">
            {NAME_FONTS.map((f) => (
              <button key={f} className={`pe-tile font-${f} ${name.font === f ? 'on' : ''}`} aria-pressed={name.font === f} onClick={() => setName({ font: f })}>
                {t(`uprofile.fonts.${f}`)}
              </button>
            ))}
          </div>
        </section>

        {/* Banner y tema, juntos */}
        <section className="panel pe-group">
          <div className="pe-title-row">
            <h3 className="pe-title">{t('uprofile.edit.banner')}</h3>
            <div className="seg pe-seg">
              {(['color', 'image'] as const).map((m) => (
                <button key={m} className={bannerMode === m ? 'on' : ''} onClick={() => setBannerMode(m)}>
                  {t(`uprofile.edit.banner_${m}`)}
                </button>
              ))}
            </div>
          </div>
          {bannerMode === 'color' ? (
            <>
              <ColorRow
                label={t('uprofile.edit.banner')}
                presets={BANNER_PRESETS}
                value={bannerColors?.[0] ?? BANNER_PRESETS[1]}
                onChange={(c) => set({ banner: { kind: 'color', colors: [c, ...(bannerColors?.slice(1) ?? [])] } })}
              />
              <Switch
                on={(bannerColors?.length ?? 0) > 1}
                label={t('uprofile.edit.gradient')}
                onChange={(v) => {
                  const c0 = bannerColors?.[0] ?? BANNER_PRESETS[1]
                  set({ banner: { kind: 'color', colors: v ? [c0, '#db2777'] : [c0] } })
                }}
              />
              {bannerColors && bannerColors.length > 1 && (
                <ColorRow label={t('uprofile.edit.color2')} presets={BANNER_PRESETS} value={bannerColors[1]} onChange={(c) => set({ banner: { kind: 'color', colors: [bannerColors[0], c] } })} />
              )}
            </>
          ) : (
            <div className="pe-banner-img">
              <input ref={fileRef} type="file" accept="image/gif,image/png,image/jpeg,image/webp" hidden onChange={(e) => void upload(e.target.files?.[0])} />
              {bannerImg ? (
                <>
                  <BannerFramer userId={user.id} banner={bannerImg} onChange={(b) => set({ banner: b })} />
                  <div className="pe-zoom">
                    <span>{t('uprofile.edit.zoom')}</span>
                    <input
                      type="range"
                      min={1}
                      max={3}
                      step={0.05}
                      value={bannerImg.zoom}
                      aria-label={t('uprofile.edit.zoom')}
                      onChange={(e) => set({ banner: { ...bannerImg, zoom: Number(e.target.value) } })}
                    />
                  </div>
                  <div className="pe-banner-actions">
                    <button className="btn btn-sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                      {uploading ? <Loader2 size={15} className="spin" /> : <ImagePlus size={15} />} {t('uprofile.edit.bannerChange')}
                    </button>
                    <button className="btn btn-sm" disabled={uploading} onClick={() => void removeImage()}>
                      <Trash2 size={15} /> {t('uprofile.edit.bannerRemove')}
                    </button>
                  </div>
                </>
              ) : (
                <button className="pe-drop" disabled={uploading} onClick={() => fileRef.current?.click()}>
                  {uploading ? <Loader2 size={22} className="spin" /> : <ImagePlus size={22} />}
                  <b>{t('uprofile.edit.bannerUpload')}</b>
                  <small>{t('uprofile.edit.bannerHint', { w: BANNER_W, h: BANNER_H })}</small>
                </button>
              )}
            </div>
          )}
          {p.banner && p.banner.kind !== 'image' && (
            <button className="link-btn pe-reset" onClick={() => set({ banner: undefined })}>
              {t('uprofile.edit.resetBanner')}
            </button>
          )}
          <Switch on={!!p.theme} label={t('uprofile.edit.themeOn')} onChange={(v) => set({ theme: v ? ['#1e1b4b', '#7c3aed'] : undefined })} />
          {p.theme && (
            <>
              <ColorRow label={t('uprofile.edit.color1')} presets={BANNER_PRESETS} value={p.theme[0]} onChange={(c) => set({ theme: [c, p.theme![1]] })} />
              <ColorRow label={t('uprofile.edit.color2')} presets={BANNER_PRESETS} value={p.theme[1]} onChange={(c) => set({ theme: [p.theme![0], c] })} />
            </>
          )}
        </section>

        {/* Marco del avatar */}
        <section className="panel pe-group">
          <h3 className="pe-title">{t('uprofile.edit.frame')}</h3>
          <div className="pe-frames">
            {FRAMES.map((f) => (
              <button
                key={f}
                className={`pe-frame ${(p.frame ?? 'none') === f ? 'on' : ''}`}
                aria-pressed={(p.frame ?? 'none') === f}
                title={t(`uprofile.frames.${f}`)}
                onClick={() => set({ frame: f === 'none' ? undefined : f })}
              >
                <Avatar name={user.username} userId={user.id} version={user.avatar} frame={f === 'none' ? undefined : f} />
                <span>{t(`uprofile.frames.${f}`)}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Placa de nombre: el fondo de tu fila en la lista de amigos y los chats */}
        <section className="panel pe-group">
          <h3 className="pe-title">{t('uprofile.edit.plate')}</h3>
          <small className="pe-hint">{t('uprofile.edit.plateSub')}</small>
          <Switch on={!!p.plate} label={t('uprofile.edit.plateOn')} onChange={(v) => set({ plate: v ? ['#7c3aed'] : undefined })} />
          {p.plate && (
            <>
              <ColorRow label={t('uprofile.edit.color1')} presets={BANNER_PRESETS} value={p.plate[0]} onChange={(c) => set({ plate: [c, ...p.plate!.slice(1)] })} />
              <Switch on={p.plate.length > 1} label={t('uprofile.edit.gradient')} onChange={(v) => set({ plate: v ? [p.plate![0], '#db2777'] : [p.plate![0]] })} />
              {p.plate.length > 1 && (
                <ColorRow label={t('uprofile.edit.color2')} presets={BANNER_PRESETS} value={p.plate[1]} onChange={(c) => set({ plate: [p.plate![0], c] })} />
              )}
            </>
          )}
        </section>

      </div>

      {/* La vista previa te acompaña al bajar (pegada arriba) */}
      <aside className="pe-preview">
        <div className="pe-sub">{t('uprofile.edit.preview')}</div>
        <ProfileCard
          userId={user.id}
          name={p.displayName || user.username}
          username={user.username}
          profile={p}
          badges={user.badges}
          avatar={user.avatar}
          state="online"
          presence={t('account.page.stateOnline')}
          createdAt={user.createdAt}
        />
        {/* Así te ven tus amigos en su lista (placa, marco y nombre) */}
        <div className="pe-sub">{t('uprofile.edit.inList')}</div>
        <div className={`friend pe-row ${plateRow(p)}`}>
          <Plate profile={p} />
          <Avatar name={p.displayName || user.username} userId={user.id} version={user.avatar} state="online" profile={p} />
          <span className="acc-who">
            <b>
              <UserName name={p.displayName || user.username} profile={p} />
            </b>
            <small>{p.custom ? `${p.custom.emoji} ${p.custom.text}`.trim() : t('friends.online')}</small>
          </span>
        </div>
        <div className="pe-save">
          <button className="btn" disabled={!changed || busy} onClick={() => setP(saved)}>
            <RotateCcw size={15} /> {t('uprofile.edit.undo')}
          </button>
          <button className="btn btn-primary" disabled={!changed || busy} onClick={() => void save()}>
            <Save size={15} /> {t('uprofile.edit.save')}
          </button>
        </div>
      </aside>
    </div>
  )
}
