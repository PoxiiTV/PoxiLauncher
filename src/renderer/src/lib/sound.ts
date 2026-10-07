// El «plin» de un mensaje nuevo: dos notas suaves hechas al vuelo (sin archivos de audio)

let ctx: AudioContext | null = null
let last = 0

export function playMessageSound(): void {
  // Varios mensajes seguidos: un solo sonido
  if (Date.now() - last < 800) return
  last = Date.now()
  try {
    ctx ??= new AudioContext()
    void ctx.resume()
    const gain = ctx.createGain()
    gain.gain.value = 0.0001
    gain.connect(ctx.destination)
    const t = ctx.currentTime
    for (const [freq, at] of [
      [987.8, 0],
      [1318.5, 0.08]
    ]) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = freq
      o.connect(gain)
      o.start(t + at)
      o.stop(t + at + 0.35)
    }
    gain.gain.exponentialRampToValueAtTime(0.1, t + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45)
  } catch {
    /* sin audio: no pasa nada */
  }
}

/** Un «tic» corto cada vez que un objeto de la ruleta de PoxiDrops pasa por la marca (como las cajas de CS) */
export function playTick(): void {
  try {
    ctx ??= new AudioContext()
    void ctx.resume()
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'triangle'
    o.frequency.setValueAtTime(1900, t)
    o.frequency.exponentialRampToValueAtTime(900, t + 0.03)
    g.gain.setValueAtTime(0.09, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045)
    o.connect(g)
    g.connect(ctx.destination)
    o.start(t)
    o.stop(t + 0.05)
  } catch {
    /* sin audio: no pasa nada */
  }
}

/** Al parar la ruleta: más notas y más brillo cuanto más raro es lo que ha tocado */
export function playLand(rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'): void {
  const notes = {
    common: [523.3],
    uncommon: [523.3, 659.3],
    rare: [523.3, 659.3, 784],
    epic: [523.3, 659.3, 784, 1046.5],
    legendary: [523.3, 659.3, 784, 1046.5, 1318.5, 1568]
  }[rarity]
  try {
    ctx ??= new AudioContext()
    void ctx.resume()
    const t = ctx.currentTime
    notes.forEach((freq, i) => {
      const o = ctx!.createOscillator()
      const g = ctx!.createGain()
      o.type = i % 2 ? 'triangle' : 'sine'
      o.frequency.value = freq
      const at = t + i * 0.09
      g.gain.setValueAtTime(0.0001, at)
      g.gain.exponentialRampToValueAtTime(0.12, at + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.9)
      o.connect(g)
      g.connect(ctx!.destination)
      o.start(at)
      o.stop(at + 0.95)
    })
  } catch {
    /* sin audio: no pasa nada */
  }
}
