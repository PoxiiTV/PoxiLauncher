import es from './es'
import en from './en'
import type { Lang } from '../types'

const dicts = { es, en } as const

function lookup(dict: unknown, key: string): string | undefined {
  const v = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], dict)
  return typeof v === 'string' ? v : undefined
}

/** Traduce con fallback a español; {param} se sustituye. */
export function translate(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const raw = lookup(dicts[lang], key) ?? lookup(es, key) ?? key
  return params ? raw.replace(/\{(\w+)\}/g, (_, p: string) => String(params[p] ?? `{${p}}`)) : raw
}
