import { useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/** Imagen a pantalla completa, con flechas (y ← → del teclado) si hay varias; Esc o un clic fuera la cierra */
export function Lightbox({
  images,
  index,
  onIndex,
  onClose
}: {
  images: string[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
}): React.JSX.Element {
  const many = images.length > 1
  const go = (d: number): void => onIndex((index + d + images.length) % images.length)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      if (!many) return
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="lightbox" onClick={onClose}>
      {many && (
        <button
          className="btn btn-icon lb-nav left"
          onClick={(e) => {
            e.stopPropagation()
            go(-1)
          }}
        >
          <ChevronLeft />
        </button>
      )}
      <img src={images[index]} alt="" onClick={(e) => e.stopPropagation()} />
      {many && (
        <button
          className="btn btn-icon lb-nav right"
          onClick={(e) => {
            e.stopPropagation()
            go(1)
          }}
        >
          <ChevronRight />
        </button>
      )}
    </div>
  )
}
