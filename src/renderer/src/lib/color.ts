// Colores: hex ↔ HSV (tono 0-360, saturación y brillo 0-1), para el selector de color
export interface Hsv {
  h: number
  s: number
  v: number
}
export const clamp = (n: number, a = 0, b = 1): number => Math.min(b, Math.max(a, n))

export function hexToHsv(hex: string): Hsv {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  const h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max }
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (k: number): number => {
    const x = (k + h / 60) % 6
    return Math.round((v - v * s * clamp(Math.min(x, 4 - x))) * 255)
  }
  return `#${[f(5), f(3), f(1)].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/** "#abc", "abc" o "#aabbcc" → "#aabbcc" (null si no es un color) */
/** ¿Color claro? (entonces encima va texto oscuro para que se lea) */
export function isLight(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return false
  const n = parseInt(m[1], 16)
  // Luminancia percibida (0-255)
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 170
}

export function parseHex(text: string): string | null {
  const t = text.trim().replace(/^#/, '').toLowerCase()
  if (/^[0-9a-f]{3}$/.test(t)) return `#${[...t].map((c) => c + c).join('')}`
  return /^[0-9a-f]{6}$/.test(t) ? `#${t}` : null
}
