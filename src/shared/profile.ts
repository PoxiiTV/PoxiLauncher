// Perfil personalizable (estilo Discord): nombre visible y su estilo, banner, tema, marco del avatar, «Sobre mí»,
// pronombres, estado personalizado y placa de nombre. El servidor valida cada campo (con una copia de estas listas)
// y la app lo vuelve a comprobar antes de pintarlo (sanitizeProfile).

export const NAME_EFFECTS = ['none', 'glow', 'neon', 'rainbow', 'shine', 'flow', 'pulse', 'fire', 'ice', 'gold', 'chrome', 'glitch', 'retro', 'outline', 'toon', 'holo'] as const
export const NAME_FONTS = ['default', 'display', 'serif', 'mono', 'hand', 'impact', 'tech', 'ink', 'elegant', 'script', 'comic', 'classic', 'typewriter', 'news', 'boli', 'modern'] as const
export const FRAMES = ['none', 'gold', 'silver', 'bronze', 'neon', 'fire', 'ice', 'rainbow', 'pixel', 'leaf', 'ruby', 'emerald', 'sapphire', 'amethyst', 'sakura', 'toxic', 'sunset', 'ocean', 'shadow', 'galaxy', 'aurora', 'pulse', 'holo', 'candy', 'electric'] as const
export const BADGES = ['founder', 'pioneer'] as const

export type NameEffect = (typeof NAME_EFFECTS)[number]
export type NameFont = (typeof NAME_FONTS)[number]
export type Frame = (typeof FRAMES)[number]
export type Badge = (typeof BADGES)[number]

export const MAX_DISPLAY = 32
export const MAX_ABOUT = 300
export const MAX_PRONOUNS = 40
export const MAX_CUSTOM = 80

export type BannerColor = { kind: 'color'; colors: string[] }
/** Subido (imagen o GIF): su versión y el encuadre (dónde se centra, en %, y cuánto se acerca) */
export type BannerImage = { kind: 'image'; v: string; x: number; y: number; zoom: number }

/** El banner se ve siempre con esta proporción (5:2): el tamaño recomendado para subirlo */
export const BANNER_W = 960
export const BANNER_H = 384
export const MAX_BANNER = 20 * 1024 * 1024

/** Tipo de imagen por su cabecera real (gif, png, jpg o webp); null si no es una imagen */
export function imageType(b: Uint8Array): 'gif' | 'png' | 'jpg' | 'webp' | null {
  if (b.length < 16 || b.length > MAX_BANNER) return null
  const ascii = (o: number, n: number): string => String.fromCharCode(...b.slice(o, o + n))
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'gif'
  if (b[0] === 0x89 && ascii(1, 3) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'webp'
  return null
}

export interface UserProfile {
  /** Nombre que ven todos (si no, el usuario) */
  displayName?: string
  pronouns?: string
  /** «Sobre mí» (con **negrita**, *cursiva* y ||spoiler||) */
  about?: string
  name?: { colors: string[]; effect: NameEffect; font: NameFont }
  banner?: BannerColor | BannerImage | null
  /** Tema del perfil: degradado de dos colores */
  theme?: string[] | null
  frame?: Frame
  /** Estado personalizado (caduca en `until`, ms; null = nunca) */
  custom?: { emoji: string; text: string; until: number | null } | null
  /** Placa de nombre (el fondo de tu fila en las listas): un color o un degradado */
  plate?: string[] | null
}

/** Un cambio del perfil: solo lo que cambia; null o '' lo quita */
export type ProfilePatch = { [K in keyof UserProfile]?: UserProfile[K] | null }

const HEX = /^#[0-9a-f]{6}$/i
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
const clean = (v: unknown, max: number, lines = false): string | undefined => {
  if (typeof v !== 'string') return undefined
  const s = (lines ? v : v.replace(/[\r\n]+/g, ' ')).replace(CTRL, '').trim().slice(0, max)
  return s || undefined
}
const colors = (v: unknown, min: number, max: number): string[] | undefined => {
  if (!Array.isArray(v)) return undefined
  const c = v.filter((x): x is string => typeof x === 'string' && HEX.test(x)).slice(0, max)
  return c.length >= min ? c : undefined
}
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined => (list.includes(v as T) ? (v as T) : undefined)

/** Perfil limpio: solo lo que se sabe pintar (colores #rrggbb, opciones conocidas, textos cortos) */
export function sanitizeProfile(p: unknown, now = Date.now()): UserProfile {
  if (!p || typeof p !== 'object') return {}
  const o = p as Record<string, unknown>
  const out: UserProfile = {}
  const displayName = clean(o.displayName, MAX_DISPLAY)
  if (displayName) out.displayName = displayName
  const pronouns = clean(o.pronouns, MAX_PRONOUNS)
  if (pronouns) out.pronouns = pronouns
  const about = clean(o.about, MAX_ABOUT, true)
  if (about) out.about = about
  const n = o.name as Record<string, unknown> | undefined
  const nc = n && colors(n.colors, 1, 2)
  if (n && nc) out.name = { colors: nc, effect: oneOf(NAME_EFFECTS, n.effect) ?? 'none', font: oneOf(NAME_FONTS, n.font) ?? 'default' }
  const b = o.banner as Record<string, unknown> | undefined
  if (b?.kind === 'color') {
    const bc = colors(b.colors, 1, 2)
    if (bc) out.banner = { kind: 'color', colors: bc }
  } else if (b?.kind === 'image' && typeof b.v === 'string' && /^[0-9a-f]{16}$/.test(b.v)) {
    const num = (v: unknown, min: number, max: number, def: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def)
    out.banner = { kind: 'image', v: b.v, x: num(b.x, 0, 100, 50), y: num(b.y, 0, 100, 50), zoom: num(b.zoom, 1, 3, 1) }
  }
  const theme = colors(o.theme, 2, 2)
  if (theme) out.theme = theme
  const frame = oneOf(FRAMES, o.frame)
  if (frame && frame !== 'none') out.frame = frame
  const c = o.custom as Record<string, unknown> | undefined
  if (c) {
    const text = clean(c.text, MAX_CUSTOM)
    const emoji = clean(c.emoji, 16)
    const until = typeof c.until === 'number' && Number.isFinite(c.until) ? c.until : null
    if ((text || emoji) && (until === null || until > now)) out.custom = { emoji: emoji ?? '', text: text ?? '', until }
  }
  const plate = colors(o.plate, 1, 2)
  if (plate) out.plate = plate
  return out
}

/** Nombre que se ve: el apodo que le pusiste tú, el nombre visible que eligió él o su usuario */
export const shownName = (username: string, profile?: UserProfile, nickname?: string): string =>
  nickname || profile?.displayName || username

/** «Sobre mí» en trozos: texto, **negrita**, *cursiva* y ||spoiler|| (sin HTML: la interfaz pinta cada trozo) */
export type RichPart = { kind: 'text' | 'bold' | 'italic' | 'spoiler'; text: string }
export function richParts(s: string): RichPart[] {
  const out: RichPart[] = []
  const re = /\*\*(.+?)\*\*|\|\|(.+?)\|\||\*(.+?)\*/gs
  let last = 0
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push({ kind: 'text', text: s.slice(last, m.index) })
    out.push(m[1] !== undefined ? { kind: 'bold', text: m[1] } : m[2] !== undefined ? { kind: 'spoiler', text: m[2] } : { kind: 'italic', text: m[3] })
    last = m.index! + m[0].length
  }
  if (last < s.length) out.push({ kind: 'text', text: s.slice(last) })
  return out
}
