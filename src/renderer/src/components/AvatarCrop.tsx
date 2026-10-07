import { useEffect, useRef, useState } from 'react'
import { ZoomIn, ZoomOut } from 'lucide-react'
import { invoke } from '../api'
import { toast } from '../store'
import { useT } from '../i18n'
import { Modal } from './Overlays'

// Recortar la foto de perfil: se arrastra para moverla y se acerca con la rueda o la barra. La foto siempre
// cubre el recuadro (no quedan huecos). Al guardar se recorta a 256×256, se convierte a WebP y se sube.

const VIEW = 280
const OUT = 256
const MAX_ZOOM = 4

export function AvatarCrop({ file, onClose }: { file: File; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  useEffect(() => {
    // Como data: (la CSP de la interfaz no deja cargar imágenes blob:, y así se queda)
    const failed = (): void => {
      toast({ kind: 'error', key: 'account.page.photoError' })
      onClose()
    }
    const reader = new FileReader()
    reader.onload = () => {
      const i = new Image()
      i.onload = () => setImg(i)
      i.onerror = failed
      i.src = String(reader.result)
    }
    reader.onerror = failed
    reader.readAsDataURL(file)
    return () => reader.abort()
  }, [file]) // eslint-disable-line react-hooks/exhaustive-deps

  // Escala para que la foto cubra el recuadro, por el zoom elegido
  const scale = img ? Math.max(VIEW / img.naturalWidth, VIEW / img.naturalHeight) * zoom : 1
  /** Nunca se puede mover tanto que asome un hueco */
  const clamp = (x: number, y: number, s = scale): { x: number; y: number } => {
    if (!img) return { x: 0, y: 0 }
    const mx = Math.max(0, (img.naturalWidth * s - VIEW) / 2)
    const my = Math.max(0, (img.naturalHeight * s - VIEW) / 2)
    return { x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) }
  }
  const setZoomSafe = (z: number): void => {
    const next = Math.min(MAX_ZOOM, Math.max(1, z))
    setZoom(next)
    if (img) setPos((p) => clamp(p.x, p.y, Math.max(VIEW / img.naturalWidth, VIEW / img.naturalHeight) * next))
  }

  const save = async (): Promise<void> => {
    if (!img || busy) return
    setBusy(true)
    // Punto del recuadro → punto de la foto
    const sx = (0 - VIEW / 2 - pos.x) / scale + img.naturalWidth / 2
    const sy = (0 - VIEW / 2 - pos.y) / scale + img.naturalHeight / 2
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = OUT
    const g = canvas.getContext('2d')!
    g.imageSmoothingQuality = 'high'
    g.drawImage(img, sx, sy, VIEW / scale, VIEW / scale, 0, 0, OUT, OUT)
    const r = await invoke('account:setAvatar', canvas.toDataURL('image/webp', 0.86)).catch(() => ({ ok: false }))
    setBusy(false)
    if (!r.ok) return void toast({ kind: 'error', key: 'account.page.photoError' })
    toast({ kind: 'success', key: 'account.page.photoSaved' })
    onClose()
  }

  return (
    <Modal
      title={t('account.page.cropTitle')}
      onClose={busy ? () => undefined : onClose}
      actions={
        <>
          <button className="btn" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" disabled={!img || busy} onClick={() => void save()}>
            {busy ? t('account.page.saving') : t('account.page.savePhoto')}
          </button>
        </>
      }
    >
      <p className="muted">{t('account.page.cropText')}</p>
      <div
        className="crop-view"
        style={{ width: VIEW, height: VIEW }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (d) setPos(clamp(d.px + e.clientX - d.x, d.py + e.clientY - d.y))
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onWheel={(e) => setZoomSafe(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))}
      >
        {img && (
          <img
            src={img.src}
            alt=""
            draggable={false}
            style={{
              width: img.naturalWidth,
              height: img.naturalHeight,
              transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px) scale(${scale})`
            }}
          />
        )}
        <span className="crop-mask" />
      </div>
      <label className="crop-zoom">
        <ZoomOut size={16} />
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          aria-label={t('account.page.zoom')}
          onChange={(e) => setZoomSafe(Number(e.target.value))}
        />
        <ZoomIn size={16} />
      </label>
    </Modal>
  )
}
