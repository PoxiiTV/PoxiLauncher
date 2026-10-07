import type { Emote } from '@shared/chat'

// Emotes que conoces (los últimos que usaste y tus favoritos), en este PC. Con ellos, escribir :NOMBRE: se convierte
// en el emote al enviar y el autocompletado los sugiere.

const read = (key: string): Emote[] => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]') as Emote[]
    return Array.isArray(v) ? v.filter((e) => e && typeof e.id === 'string' && typeof e.name === 'string') : []
  } catch {
    return []
  }
}
const write = (key: string, list: Emote[]): void => {
  try {
    localStorage.setItem(key, JSON.stringify(list))
  } catch {
    /* sin memoria: no pasa nada */
  }
}

export const recentEmotes = (): Emote[] => read('chat.recentEmotes')
export const favoriteEmotes = (): Emote[] => read('chat.favEmotes')

/** Usado ahora: el primero de recientes (hasta 60) */
export function rememberEmotes(list: Emote[]): void {
  if (!list.length) return
  const ids = new Set(list.map((e) => e.id))
  write('chat.recentEmotes', [...list, ...recentEmotes().filter((e) => !ids.has(e.id))].slice(0, 60))
}

export function toggleFavorite(e: Emote): Emote[] {
  const favs = favoriteEmotes()
  const next = favs.some((f) => f.id === e.id) ? favs.filter((f) => f.id !== e.id) : [e, ...favs].slice(0, 100)
  write('chat.favEmotes', next)
  return next
}

/** Favoritos primero (ganan si dos se llaman igual), luego los recientes */
export function knownEmotes(): Emote[] {
  const seen = new Set<string>()
  return [...favoriteEmotes(), ...recentEmotes()].filter((e) => !seen.has(e.id) && seen.add(e.id))
}
