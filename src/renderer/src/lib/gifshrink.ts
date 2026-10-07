import { applyPalette, GIFEncoder, quantize } from 'gifenc'

// Encoge un GIF (o WebP) animado hasta que pese lo pedido sin perder la animación: se leen sus fotogramas con el
// decodificador del navegador y se vuelve a hacer el GIF más pequeño (y, si hace falta, con menos fotogramas).

interface Frame {
  image: VideoFrame
  /** Lo que dura en pantalla, en ms */
  ms: number
}

/** Máximo de fotogramas que se leen (un GIF de sticker larguísimo no merece más) */
const MAX_FRAMES = 200
/** Tamaños (lado mayor) y saltos de fotogramas que se prueban, de mejor a peor calidad */
const SIZES = [320, 256, 200, 160, 128, 96]
const STEPS = [1, 2, 3]

function encode(frames: Frame[], w0: number, h0: number, side: number, step: number): Uint8Array {
  const k = Math.min(1, side / Math.max(w0, h0))
  const w = Math.max(1, Math.round(w0 * k))
  const h = Math.max(1, Math.round(h0 * k))
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const gif = GIFEncoder()
  for (let i = 0; i < frames.length; i += step) {
    // Al saltar fotogramas, el que queda dura lo de los saltados
    const delay = frames.slice(i, i + step).reduce((s, f) => s + f.ms, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(frames[i].image, 0, 0, w, h)
    const { data } = ctx.getImageData(0, 0, w, h)
    const palette = quantize(data, 256, { format: 'rgba4444', oneBitAlpha: true })
    const index = applyPalette(data, palette, 'rgba4444')
    const transparentIndex = palette.findIndex((c) => c[3] === 0)
    gif.writeFrame(index, w, h, { palette, delay, transparent: transparentIndex >= 0, transparentIndex: Math.max(0, transparentIndex), dispose: 2 })
  }
  gif.finish()
  return gif.bytes()
}

/** El GIF más grande (de mejor calidad) que quepa en `max` bytes, o null si no se puede (o no es animado) */
export async function shrinkAnimated(file: Blob, max: number): Promise<Uint8Array | null> {
  if (typeof ImageDecoder === 'undefined' || !(await ImageDecoder.isTypeSupported(file.type))) return null
  const decoder = new ImageDecoder({ data: file.stream(), type: file.type })
  const frames: Frame[] = []
  try {
    await decoder.tracks.ready
    const count = Math.min(decoder.tracks.selectedTrack?.frameCount ?? 1, MAX_FRAMES)
    for (let i = 0; i < count; i++) {
      const { image } = await decoder.decode({ frameIndex: i })
      // Algunos GIFs dicen 0 ms (los navegadores los ponen a 100)
      frames.push({ image, ms: Math.max(20, (image.duration ?? 100_000) / 1000) || 100 })
    }
    if (!frames.length) return null
    const w0 = frames[0].image.displayWidth
    const h0 = frames[0].image.displayHeight
    for (const side of SIZES)
      for (const step of STEPS) {
        if (step > 1 && frames.length < 4) break
        const out = encode(frames, w0, h0, side, step)
        if (out.length <= max) return out
        // Si pasa por mucho, ni probar a quitar fotogramas: mejor bajar el tamaño
        if (out.length > max * 3) break
      }
    return null
  } finally {
    for (const f of frames) f.image.close()
    decoder.close()
  }
}
