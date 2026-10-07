import { z } from 'zod'

// Perfil personalizable (estilo Discord). OJO: las listas son copia de src/shared/profile.ts de la app.

export const NAME_EFFECTS = ['none', 'glow', 'neon', 'rainbow', 'shine', 'flow', 'pulse', 'fire', 'ice', 'gold', 'chrome', 'glitch', 'retro', 'outline', 'toon', 'holo']
export const NAME_FONTS = ['default', 'display', 'serif', 'mono', 'hand', 'impact', 'tech', 'ink', 'elegant', 'script', 'comic', 'classic', 'typewriter', 'news', 'boli', 'modern']
export const FRAMES = ['none', 'gold', 'silver', 'bronze', 'neon', 'fire', 'ice', 'rainbow', 'pixel', 'leaf', 'ruby', 'emerald', 'sapphire', 'amethyst', 'sakura', 'toxic', 'sunset', 'ocean', 'shadow', 'galaxy', 'aurora', 'pulse', 'holo', 'candy', 'electric']

const hex = z.string().regex(/^#[0-9a-f]{6}$/i)
// Sin caracteres de control (los saltos de línea solo en «Sobre mí»)
const line = (max) => z.string().max(max).regex(/^[^\p{Cc}]*$/u)
const lines = (max) => z.string().max(max).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/)

/** Lo que se puede cambiar (todo opcional: se manda solo lo que cambia; null o '' lo quita) */
export const profileBody = z
  .object({
    displayName: line(32).optional(),
    pronouns: line(40).optional(),
    about: lines(300).optional(),
    name: z.object({ colors: z.array(hex).min(1).max(2), effect: z.enum(NAME_EFFECTS), font: z.enum(NAME_FONTS) }).strict().nullable().optional(),
    banner: z
      .union([
        z.object({ kind: z.literal('color'), colors: z.array(hex).min(1).max(2) }).strict(),
        // El subido (su versión tiene que ser la del archivo que hay): solo cambia el encuadre
        z
          .object({
            kind: z.literal('image'),
            v: z.string().regex(/^[0-9a-f]{16}$/),
            x: z.number().min(0).max(100),
            y: z.number().min(0).max(100),
            zoom: z.number().min(1).max(3)
          })
          .strict()
      ])
      .nullable()
      .optional(),
    theme: z.array(hex).length(2).nullable().optional(),
    /** Placa de nombre: el fondo de tu fila en las listas, de un color o degradado */
    plate: z.array(hex).min(1).max(2).nullable().optional(),
    frame: z.enum(FRAMES).optional(),
    custom: z
      .object({ emoji: line(16), text: line(80), until: z.number().int().min(0).max(1e13).nullable() })
      .strict()
      .nullable()
      .optional()
  })
  .strict()

/** Junta lo nuevo con lo que había (lo vacío se quita) */
export function mergeProfile(old = {}, patch) {
  const p = { ...old }
  for (const [k, v] of Object.entries(patch)) {
    const empty = v === null || v === '' || (Array.isArray(v) && !v.length) || (k === 'frame' && v === 'none')
    if (empty) delete p[k]
    else p[k] = typeof v === 'string' ? v.trim() : v
    if (p[k] === '') delete p[k]
  }
  return p
}

/** El perfil que ven los demás: sin el estado personalizado si ya caducó */
export function visibleProfile(p, now = Date.now()) {
  if (!p) return {}
  const { custom, ...rest } = p
  return custom && (custom.until === null || custom.until > now) ? { ...rest, custom } : rest
}

// ponytail: fecha fija; cuando se sepa el día del lanzamiento, que sean sus primeras semanas
const PIONEER_UNTIL = Date.UTC(2026, 11, 1)

/** Insignias: fundador (la primera cuenta) y pionero (de las primeras semanas) */
export function badgesOf(u, firstId) {
  const out = []
  if (u.id === firstId) out.push('founder')
  if (u.createdAt && u.createdAt < PIONEER_UNTIL) out.push('pioneer')
  return out
}
