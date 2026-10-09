import type { T } from '../i18n'
import { getState } from '../store'

export function formatBytes(n: number): string {
  if (!n) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  // Con el idioma de la app, no el de Windows: «2,9 GB» en español, «2.9 GB» en inglés
  const d = n >= 100 || i < 2 ? 0 : 1
  return `${n.toLocaleString(getState().settings?.lang ?? 'es', { minimumFractionDigits: d, maximumFractionDigits: d })} ${u[i]}`
}

/** 9261 → "9.261" (en español los números de 4 cifras no llevan punto por defecto) */
export const formatCount = (n: number): string => n.toLocaleString(undefined, { useGrouping: 'always' } as Intl.NumberFormatOptions)

export const formatSpeed = (bps: number): string => (bps > 0 ? `${formatBytes(bps)}/s` : '—')

export function formatDuration(sec: number, t: T): string {
  if (sec < 0 || !Number.isFinite(sec)) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return t('time.hm', { h, m })
  if (m > 0) return t('time.minutes', { n: m })
  return t('time.minutes', { n: '<1' })
}

export function formatRelative(ts: number, t: T): string {
  const days = Math.floor((Date.now() - ts) / 86_400_000)
  if (Date.now() - ts < 60_000) return t('time.now')
  if (days <= 0) return t('time.today')
  if (days === 1) return t('time.yesterday')
  if (days < 60) return t('time.days', { n: days })
  if (days < 730) return t('time.months', { n: Math.round(days / 30) })
  return t('time.years', { n: Math.floor(days / 365) })
}

/** "12 sept" (con el año si no es este: "12 sept 2025") */
export function formatDate(ts: number, lang: string): string {
  const sameYear = new Date(ts).getFullYear() === new Date().getFullYear()
  return new Date(ts).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}
