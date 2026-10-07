import { useEffect, useRef, useState } from 'react'
import { Loader2, RotateCcw, Upload } from 'lucide-react'
import type { SkinViewer } from 'skinview3d'
import type { McAccount, McSkinInfo } from '@shared/types'
import { invoke } from '../api'
import { toast } from '../store'
import { useT } from '../i18n'
import { Modal } from './Overlays'

// Skin y capa de una cuenta Microsoft: vista en 3D, subir una nueva (clásica o fina), volver a la de por
// defecto y elegir capa.

/**
 * Personaje en 3D con su segunda capa (sombrero, chaqueta…) y la capa: quieto y de medio lado, se gira
 * arrastrando. El visor (three.js) se carga al abrir el diálogo, no con la app.
 */
function Skin3D({ skin, slim, cape }: { skin: string | null; slim: boolean; cape: string | null }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const [viewer, setViewer] = useState<SkinViewer | null>(null)

  useEffect(() => {
    let v: SkinViewer | null = null
    let gone = false
    void import('skinview3d').then(({ SkinViewer }) => {
      if (gone || !ref.current) return
      v = new SkinViewer({ canvas: ref.current, width: 180, height: 280, zoom: 0.85 })
      // De medio lado (se ve la cara y un costado); el ratón mueve la cámara a partir de ahí
      v.playerObject.rotation.y = 0.5
      v.controls.enableZoom = false
      setViewer(v)
    })
    return () => {
      gone = true
      v?.dispose()
    }
  }, [])

  useEffect(() => {
    if (!viewer) return
    if (skin) void viewer.loadSkin(skin, { model: slim ? 'slim' : 'default' })?.catch(() => undefined)
    else viewer.loadSkin(null)
  }, [viewer, skin, slim])

  useEffect(() => {
    if (!viewer) return
    if (cape) void viewer.loadCape(cape)?.catch(() => undefined)
    else viewer.loadCape(null)
  }, [viewer, cape])

  return <canvas ref={ref} className="mc-skin-canvas" />
}

export function SkinDialog({ account, onClose }: { account: McAccount; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const [info, setInfo] = useState<McSkinInfo | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  // Capa bajo el ratón: se prueba en el personaje antes de elegirla
  const [preview, setPreview] = useState<string | null | undefined>(undefined)
  const file = useRef<HTMLInputElement>(null)
  const slim = info?.skin?.variant === 'slim'
  const cape = preview !== undefined ? preview : (info?.capes.find((c) => c.active)?.url ?? null)

  useEffect(() => {
    void invoke('mc:skin', account.id).then(setInfo)
  }, [account.id])

  const run = async (fn: () => Promise<McSkinInfo | null>): Promise<void> => {
    setBusy(true)
    try {
      const r = await fn()
      if (r) {
        setInfo(r)
        toast({ kind: 'success', key: 'mc.skin.saved' })
      }
    } catch {
      toast({ kind: 'error', key: 'mc.skin.failed' })
    } finally {
      setBusy(false)
    }
  }

  const upload = (f: File | undefined, variant: 'classic' | 'slim'): void => {
    if (file.current) file.current.value = ''
    if (!f || f.type !== 'image/png' || f.size > 64 * 1024) return void toast({ kind: 'error', key: 'mc.skin.failed' })
    const reader = new FileReader()
    reader.onload = () => void run(() => invoke('mc:setSkin', account.id, String(reader.result), variant))
    reader.readAsDataURL(f)
  }

  return (
    <Modal
      className="mc-modal"
      title={t('mc.skin.title', { name: account.name })}
      onClose={onClose}
      actions={
        <button className="mc-btn" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      {info === undefined ? (
        <p className="mc-hint">
          <Loader2 size={15} className="spin" />
        </p>
      ) : info === null ? (
        <p className="mc-warn">{t('mc.skin.unavailable')}</p>
      ) : (
        <div className="mc-skin">
          <div className="mc-skin-view mc-slot">
            <Skin3D skin={info.skin?.url ?? null} slim={slim} cape={cape} />
          </div>
          <div className="mc-skin-side">
            <div className="mc-field">
              <span>{t('mc.skin.variant')}</span>
              <div className="mc-seg">
                {(['classic', 'slim'] as const).map((v) => (
                  <button
                    key={v}
                    className={(info.skin?.variant ?? 'classic') === v ? 'on' : ''}
                    disabled={busy}
                    onClick={() => {
                      // Cambiar de modelo es volver a subir la misma skin con el otro modelo: se elige el archivo
                      if (file.current) {
                        file.current.dataset.variant = v
                        file.current.click()
                      }
                    }}
                  >
                    {t(`mc.skin.${v}`)}
                  </button>
                ))}
              </div>
            </div>
            <input
              ref={file}
              type="file"
              accept="image/png"
              hidden
              onChange={(e) => upload(e.target.files?.[0], (e.target.dataset.variant as 'classic' | 'slim') ?? info.skin?.variant ?? 'classic')}
            />
            <div className="mc-skin-actions">
              <button
                className="mc-btn mc-btn-emerald"
                disabled={busy}
                onClick={() => {
                  if (file.current) {
                    file.current.dataset.variant = info.skin?.variant ?? 'classic'
                    file.current.click()
                  }
                }}
              >
                {busy ? <Loader2 size={16} className="spin" /> : <Upload size={16} />} {t('mc.skin.upload')}
              </button>
              <button className="mc-btn" disabled={busy} onClick={() => void run(() => invoke('mc:resetSkin', account.id))}>
                <RotateCcw size={16} /> {t('mc.skin.reset')}
              </button>
            </div>
            {!!info.capes.length && (
              <div className="mc-field">
                <span>{t('mc.skin.capes')}</span>
                <div className="mc-capes" onMouseLeave={() => setPreview(undefined)}>
                  <button className={`mc-cape ${info.capes.some((c) => c.active) ? '' : 'on'}`} disabled={busy} onMouseEnter={() => setPreview(null)} onClick={() => void run(() => invoke('mc:setCape', account.id, null))}>
                    {t('mc.skin.noCape')}
                  </button>
                  {info.capes.map((c) => (
                    <button key={c.id} className={`mc-cape ${c.active ? 'on' : ''}`} disabled={busy} title={c.alias} onMouseEnter={() => setPreview(c.url)} onClick={() => void run(() => invoke('mc:setCape', account.id, c.id))}>
                      <span className="mc-cape-img" style={{ backgroundImage: `url("${c.url.replace(/"/g, '')}")` }} />
                      {c.alias}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
