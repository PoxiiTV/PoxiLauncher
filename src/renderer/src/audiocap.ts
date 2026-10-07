// Audio del sistema para los clips (una ventana oculta, sin la interfaz): lo que suena en el PC (Electron lo pide a
// Windows como «loopback», como Medal) se pasa a PCM de 16 bits estéreo a 48 kHz y se manda en trozos a FFmpeg.
// Aunque no suene nada, el audio sigue corriendo (silencio): así el sonido del clip no se descuadra con la imagen.
import { AUDIO_RATE } from '@shared/capture'
import { invoke } from './api'

async function start(): Promise<void> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
  // La imagen la graba FFmpeg: aquí solo hace falta el sonido
  for (const t of stream.getVideoTracks()) t.stop()
  const tracks = stream.getAudioTracks()
  if (!tracks.length) throw new Error('sin audio')
  const ctx = new AudioContext({ sampleRate: AUDIO_RATE })
  const src = ctx.createMediaStreamSource(new MediaStream(tracks))
  // ponytail: ScriptProcessor (obsoleto pero sin archivos aparte ni CSP); AudioWorklet si algún día desaparece
  const proc = ctx.createScriptProcessor(4096, 2, 2)
  proc.onaudioprocess = (e) => {
    const l = e.inputBuffer.getChannelData(0)
    const r = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : l
    const out = new Int16Array(l.length * 2)
    for (let i = 0; i < l.length; i++) {
      out[i * 2] = Math.max(-1, Math.min(1, l[i])) * 0x7fff
      out[i * 2 + 1] = Math.max(-1, Math.min(1, r[i])) * 0x7fff
    }
    void invoke('capture:pcm', new Uint8Array(out.buffer))
  }
  src.connect(proc)
  // Tiene que ir a algún sitio para que funcione; lo que sale es silencio (no se escribe nada en la salida)
  proc.connect(ctx.destination)
  await ctx.resume()
}

start().catch((e) => void invoke('capture:audioFailed', String((e as Error)?.message ?? e).slice(0, 200)))
