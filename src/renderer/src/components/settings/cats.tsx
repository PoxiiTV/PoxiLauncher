import { useEffect, useState } from 'react'
import { Bell, Camera, Copy, Download, Eye, FileText, FolderOpen, Info, MonitorPlay, SlidersHorizontal, Sparkles } from 'lucide-react'
import { CLIP_QUALITIES, CLIP_SECONDS, SHOT_HOTKEY, type ClipDevices, type ClipStatus } from '@shared/capture'
import { hotkeyLabel, OVERLAY_HOTKEY } from '@shared/hotkey'
import { invoke, on } from '../../api'
import { setState, toast, updateSettings, useStore } from '../../store'
import { useT, type T } from '../../i18n'
import { Select } from '../Select'
import { Logo } from '../Logo'
import { HotkeyButton } from '../Hotkey'
import { Card, Expander, Group, Nested, Row, Saved, Seg, ToggleRow, useSaved } from './parts'
import flagEs from '../../assets/flags/es.png'
import flagGb from '../../assets/flags/gb.png'

export type CatId = 'general' | 'notif' | 'privacy' | 'ingame' | 'capture' | 'about'

/** El menú de la capa: tres grupos y sus categorías, en orden */
export const CATS: { id: CatId; group: 'app' | 'games' | 'support'; Icon: typeof Bell }[] = [
  { id: 'general', group: 'app', Icon: SlidersHorizontal },
  { id: 'notif', group: 'app', Icon: Bell },
  { id: 'privacy', group: 'app', Icon: Eye },
  { id: 'ingame', group: 'games', Icon: MonitorPlay },
  { id: 'capture', group: 'games', Icon: Camera },
  { id: 'about', group: 'support', Icon: Info }
]

/**
 * Lo que encuentra el buscador: cada fila con su categoría y sus textos (prefs.<key>.label / .help) y alguna palabra
 * más con la que se busca. `parent`: si la fila está dentro de una tarjeta que se despliega, se salta a esa si no se ve.
 */
export const INDEX: { id: string; cat: CatId; key: string; kw?: string; parent?: string }[] = [
  { id: 'lang', cat: 'general', key: 'lang', kw: 'language english español idioma' },
  { id: 'startWin', cat: 'general', key: 'startWin', kw: 'inicio arranque startup' },
  { id: 'minimize', cat: 'general', key: 'minimize' },
  { id: 'notifications', cat: 'notif', key: 'notifications', kw: 'avisos windows' },
  { id: 'friendAlerts', cat: 'notif', key: 'friendAlerts', kw: 'aviso amigos friends' },
  { id: 'discord', cat: 'privacy', key: 'discord', kw: 'rich presence estado' },
  { id: 'overlayMenu', cat: 'ingame', key: 'overlayMenu', kw: 'overlay atajo menú shift f1' },
  { id: 'shot', cat: 'capture', key: 'shot', kw: 'f12 screenshot foto atajo captura' },
  { id: 'clips', cat: 'capture', key: 'clips', kw: 'vídeo grabar clip' },
  { id: 'clipSeconds', cat: 'capture', key: 'clipSeconds', kw: 'segundos duración', parent: 'clips' },
  { id: 'clipQuality', cat: 'capture', key: 'clipQuality', kw: 'resolución calidad 1080p 720p', parent: 'clips' },
  { id: 'clipFps', cat: 'capture', key: 'clipFps', kw: 'fps fotogramas', parent: 'clips' },
  { id: 'clipScreen', cat: 'capture', key: 'clipScreen', kw: 'monitor pantalla', parent: 'clips' },
  { id: 'clipAudio', cat: 'capture', key: 'clipAudio', kw: 'audio sonido', parent: 'clips' },
  { id: 'clipDevice', cat: 'capture', key: 'clipDevice', kw: 'audio cascos altavoces', parent: 'clipAudio' },
  { id: 'about', cat: 'about', key: 'about.version', kw: 'versión update actualización' },
  { id: 'news', cat: 'about', key: 'about.news', kw: 'changelog novedades' },
  { id: 'legal', cat: 'about', key: 'about.legal', kw: 'privacidad términos privacy terms datos rgpd' },
  { id: 'contact', cat: 'about', key: 'about.contact', kw: 'email correo soporte contacto' }
]

const LANGS = ['spanish', 'english', 'french', 'german', 'italian', 'portuguese', 'russian', 'japanese', 'chinese']

/** Un desplegable de la app en una fila, con su «Guardado» */
function SelectRow<V extends string | number>({ id, k, value, options, onChange }: { id: string; k: string; value: V; options: { value: V; label: string }[]; onChange: (v: V) => void }): React.JSX.Element {
  const t = useT()
  const [saved, flash] = useSaved()
  return (
    <Row id={id} label={t(`prefs.${k}.label`)} help={t(`prefs.${k}.help`)} info={info(t, k)}>
      <Saved on={saved} />
      <Select<V>
        className="pf-select"
        ariaLabel={t(`prefs.${k}.label`)}
        value={value}
        options={options}
        onChange={(v) => {
          onChange(v)
          flash()
        }}
      />
    </Row>
  )
}

function SegRow<V extends string | number>({ id, k, value, options, onChange }: { id: string; k: string; value: V; options: { value: V; label: React.ReactNode }[]; onChange: (v: V) => void }): React.JSX.Element {
  const t = useT()
  const [saved, flash] = useSaved()
  const help = t(`prefs.${k}.help`)
  return (
    <Row id={id} label={t(`prefs.${k}.label`)} help={help === `prefs.${k}.help` ? undefined : help} info={info(t, k)}>
      <Saved on={saved} />
      <Seg<V>
        label={t(`prefs.${k}.label`)}
        value={value}
        options={options}
        onChange={(v) => {
          onChange(v)
          flash()
        }}
      />
    </Row>
  )
}

function HotkeyRow({ id, k, field, fallback, pill, help }: { id: string; k: string; field: 'overlayHotkey' | 'shotHotkey'; fallback: string; pill?: React.ReactNode; help?: string }): React.JSX.Element {
  const t = useT()
  const [saved, flash] = useSaved()
  return (
    <Row id={id} label={t(`prefs.${k}.label`)} help={help ?? t(`prefs.${k}.help`)} info={info(t, k)} pill={pill}>
      <Saved on={saved} />
      <HotkeyButton field={field} fallback={fallback} label={t(`prefs.${k}.label`)} onSaved={flash} />
    </Row>
  )
}

/** El texto técnico de la (i), si esa fila lo tiene */
const info = (t: T, k: string): string | undefined => {
  const v = t(`prefs.${k}.info`)
  return v === `prefs.${k}.info` ? undefined : v
}

/** Interruptor con sus textos de prefs.<k> */
function TRow({ id, k, field, disabled, note }: { id: string; k: string; field: Parameters<typeof ToggleRow>[0]['field']; disabled?: boolean; note?: string }): React.JSX.Element {
  const t = useT()
  const help = t(`prefs.${k}.help`)
  return <ToggleRow id={id} field={field} label={t(`prefs.${k}.label`)} help={help === `prefs.${k}.help` ? undefined : help} info={info(t, k)} disabled={disabled} note={note} />
}

// ——— Aplicación ———
function General(): React.JSX.Element {
  const t = useT()
  const lang = useStore((s) => s.settings?.lang ?? 'es')
  return (
    <Group>
      <Card>
        <SegRow
          id="lang"
          k="lang"
          value={lang}
          onChange={(l) => void updateSettings({ lang: l })}
          options={(['es', 'en'] as const).map((l) => ({
            value: l,
            label: (
              <span className="lang-btn">
                <img className="flag" src={l === 'es' ? flagEs : flagGb} alt="" />
                {l === 'es' ? 'Español' : 'English'}
              </span>
            )
          }))}
        />
        <TRow id="startWin" k="startWin" field="startWithWindows" />
        <TRow id="minimize" k="minimize" field="minimizeWhilePlaying" />
      </Card>
    </Group>
  )
}

function Notif(): React.JSX.Element {
  return (
    <Group>
      <Card>
        <TRow id="notifications" k="notifications" field="notifications" />
        <TRow id="friendAlerts" k="friendAlerts" field="friendAlerts" />
      </Card>
    </Group>
  )
}

function Privacy(): React.JSX.Element {
  const t = useT()
  return (
    <Group title={t('prefs.g.discord')}>
      <Card>
        <TRow id="discord" k="discord" field="discordPresence" />
      </Card>
    </Group>
  )
}

// ——— Dentro del juego ———
function InGame(): React.JSX.Element {
  const t = useT()
  return (
    <Group>
      <Card>
        <HotkeyRow id="overlayMenu" k="overlayMenu" field="overlayHotkey" fallback={OVERLAY_HOTKEY} pill={<span className="pf-pill beta">{t('prefs.beta')}</span>} />
      </Card>
    </Group>
  )
}

function useClipStatus(): ClipStatus {
  const [status, setStatus] = useState<ClipStatus>({ state: 'off' })
  useEffect(() => {
    void invoke('capture:status').then(setStatus)
    return on('clipStatus', setStatus)
  }, [])
  return status
}

function CaptureCat(): React.JSX.Element {
  const t = useT()
  const s = useStore((st) => st.settings)
  const status = useClipStatus()
  const [devs, setDevs] = useState<ClipDevices | null>(null)
  const clipsOn = !!s?.clips
  useEffect(() => {
    if (clipsOn) void invoke('capture:devices').then(setDevs).catch(() => setDevs({ screens: [], audio: [] }))
  }, [clipsOn])
  if (!s) return <></>
  const key = hotkeyLabel(s.shotHotkey || SHOT_HOTKEY, s.lang)
  const secs = (n: number): string => (n < 60 ? `${n} s` : `${n / 60} min`)
  const pill =
    status.state === 'error' ? (
      <span className="pf-pill warn">{t('prefs.clipStatus.error')}</span>
    ) : (
      <span className={`pf-pill ${status.state === 'ready' || status.state === 'recording' ? 'ok' : ''}`}>
        <i className={`pf-dot ${status.state === 'recording' ? 'live' : ''}`} />
        {status.state === 'download'
          ? t('prefs.clipStatus.download', { pct: status.pct ?? 0 })
          : status.state === 'recording'
            ? t('prefs.clipStatus.recording', { enc: t(`settings.capture.encoders.${status.encoder ?? 'libx264'}`) })
            : t(`prefs.clipStatus.${status.state}`)}
      </span>
    )
  const summary = [secs(s.clipSeconds), t(`settings.capture.qualities.${s.clipQuality}`), `${s.clipFps} FPS`].join(' · ')
  return (
    <Group>
      <Card>
        <HotkeyRow id="shot" k="shot" field="shotHotkey" fallback={SHOT_HOTKEY} />
      </Card>
      <Expander id="clips" field="clips" label={t('prefs.clips.label')} help={t('prefs.clips.help', { key })} info={info(t, 'clips')} summary={summary} status={pill}>
        {status.state === 'error' && <div className="pf-warn-note">{t('settings.capture.status.error')}</div>}
        <SegRow id="clipSeconds" k="clipSeconds" value={s.clipSeconds} onChange={(v) => void updateSettings({ clipSeconds: v })} options={CLIP_SECONDS.map((n) => ({ value: n, label: secs(n) }))} />
        <SegRow
          id="clipQuality"
          k="clipQuality"
          value={s.clipQuality}
          onChange={(v) => void updateSettings({ clipQuality: v })}
          options={CLIP_QUALITIES.map((q) => ({ value: q, label: t(`settings.capture.qualities.${q}`) }))}
        />
        <SegRow id="clipFps" k="clipFps" value={s.clipFps} onChange={(v) => void updateSettings({ clipFps: v })} options={[30, 60].map((n) => ({ value: n as 30 | 60, label: String(n) }))} />
        <SelectRow<string>
          id="clipScreen"
          k="clipScreen"
          value={s.clipScreen}
          onChange={(v) => void updateSettings({ clipScreen: v })}
          options={[
            { value: '', label: t('settings.capture.screenAuto') },
            ...(devs?.screens ?? []).map((x) => ({ value: x.name, label: x.primary ? `${x.label} · ${t('settings.capture.primary')}` : x.label }))
          ]}
        />
        <TRow id="clipAudio" k="clipAudio" field="clipAudio" />
        <Nested show={s.clipAudio}>
          <SelectRow<string>
            id="clipDevice"
            k="clipDevice"
            value={s.clipAudioDevice}
            onChange={(v) => void updateSettings({ clipAudioDevice: v })}
            options={[
              { value: '', label: t('settings.capture.deviceAuto') },
              ...(devs?.audio ?? []).map((a) => ({ value: a.id, label: a.default ? `${a.name} · ${t('settings.capture.default')}` : a.name }))
            ]}
          />
        </Nested>
      </Expander>
      <div className="pf-links">
        <button className="btn btn-ghost btn-sm" onClick={() => void invoke('capture:openFolder', 'pictures')}>
          <FolderOpen size={15} /> {t('settings.capture.openShots')}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => void invoke('capture:openFolder', 'videos')}>
          <FolderOpen size={15} /> {t('settings.capture.openClips')}
        </button>
      </div>
    </Group>
  )
}

// ——— Soporte ———
/** Email de contacto (el mismo de la privacidad y los términos) */
const CONTACT = 'alexissjuarezz10@gmail.com'

function About(): React.JSX.Element {
  const t = useT()
  const [version, setVersion] = useState('')
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    void invoke('app:info').then((i) => setVersion(i.version))
  }, [])
  const checkUpdate = async (): Promise<void> => {
    try {
      const r = await invoke('system:checkUpdate')
      if (r.available && r.version) setState({ update: { state: 'available', version: r.version, progress: 0 } })
      else setNote(t('settings.upToDate'))
    } catch {
      setNote(t('toast.error'))
    }
  }
  return (
    <>
      <Group>
        <Card>
          <div className="pf-about" data-row="about">
            <Logo size={56} />
            <div className="pf-text">
              <div className="pf-about-n">PoxiLauncher</div>
              <div className="pf-about-v num">
                {t('prefs.about.version', { v: version })}
                {note && <span className="pf-pill ok">{note}</span>}
              </div>
            </div>
            <button className="btn" onClick={() => void checkUpdate()}>
              <Download size={16} /> {t('settings.checkUpdate')}
            </button>
          </div>
        </Card>
      </Group>
      <Group>
        <Card>
          <Row id="news" label={t('prefs.about.news')} help={t('prefs.about.newsHelp')}>
            <button className="btn" disabled={!version} onClick={() => setState({ whatsNew: { from: version, to: version } })}>
              <Sparkles size={16} /> {t('prefs.about.newsBtn')}
            </button>
          </Row>
          <Row id="legal" label={t('legal.about')} help={t('legal.aboutHelp')}>
            <div className="row-buttons">
              <button className="btn" onClick={() => void invoke('app:openLegal', 'privacidad')}>
                <FileText size={16} /> {t('legal.privacy')}
              </button>
              <button className="btn" onClick={() => void invoke('app:openLegal', 'terminos')}>
                <FileText size={16} /> {t('legal.terms')}
              </button>
            </div>
          </Row>
          <Row id="contact" label={t('legal.contact')} help={t('legal.contactHelp')}>
            <button
              className="btn"
              onClick={() => {
                void navigator.clipboard.writeText(CONTACT)
                toast({ kind: 'success', key: 'legal.copied' })
              }}
            >
              <Copy size={16} /> {CONTACT}
            </button>
          </Row>
        </Card>
      </Group>
      <p className="muted pf-notice">{t('legal.notOfficial')}</p>
    </>
  )
}

/** El contenido de cada categoría */
export function CatBody({ id }: { id: CatId }): React.JSX.Element {
  switch (id) {
    case 'general':
      return <General />
    case 'notif':
      return <Notif />
    case 'privacy':
      return <Privacy />
    case 'ingame':
      return <InGame />
    case 'capture':
      return <CaptureCat />
    case 'about':
      return <About />
  }
}
