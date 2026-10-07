// Lee del CHANGELOG.md (empaquetado en la app) las novedades por versión y en el idioma pedido.
import raw from '../../../../CHANGELOG.md?raw'
import { isNewer } from '@shared/version'

export interface ChangeItem {
  emoji: string
  title: string
  text: string
}

const EMOJI = /^(\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*)\s*/u

const plain = (t: string): string => t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')

export function changesFor(version: string, lang: 'es' | 'en'): ChangeItem[] {
  const start = raw.indexOf(`## ${version}\n`) >= 0 ? raw.indexOf(`## ${version}\n`) : raw.indexOf(`## ${version}\r\n`)
  if (start < 0) return []
  const next = raw.indexOf('\n## ', start + 4)
  const section = raw.slice(start, next < 0 ? undefined : next)
  const marker = lang === 'es' ? '### 🇪🇸' : '### 🇬🇧'
  const langStart = section.indexOf(marker)
  if (langStart < 0) return []
  const langEnd = section.indexOf('\n### ', langStart + 4)
  const body = section.slice(langStart, langEnd < 0 ? undefined : langEnd)

  return body
    .split('\n')
    .filter((l) => l.startsWith('- '))
    .map((l) => {
      let line = l.slice(2).trim()
      const e = EMOJI.exec(line)
      const emoji = e ? e[1] : '✨'
      if (e) line = line.slice(e[0].length)
      const m = /^\*\*(.+?)\*\*[:.]?\s*(.*)$/.exec(line)
      // Sin puntuación suelta al principio, con mayúscula inicial y sin marcas de Markdown dentro del texto
      // (**negrita** y `código` se ven bien en GitHub, pero aquí saldrían tal cual)
      const text = plain(m?.[2] ?? '').replace(/^[\s,;:.–-]+/, '')
      return m ? { emoji, title: m[1], text: text.charAt(0).toUpperCase() + text.slice(1) } : { emoji, title: line, text: '' }
    })
}

/** Versiones que aparecen en el changelog, de la más nueva a la más vieja. */
const versions = (): string[] => [...raw.matchAll(/^## (\d+\.\d+\.\d+)\s*$/gm)].map((m) => m[1])

/**
 * Todo lo nuevo desde `from` (sin incluir) hasta `to` (incluida), lo más reciente primero
 * y sin repetir tarjetas con el mismo título.
 */
export function changesSince(from: string, to: string, lang: 'es' | 'en'): ChangeItem[] {
  const seen = new Set<string>()
  const out: ChangeItem[] = []
  for (const v of versions()) {
    if (!isNewer(v, from) || isNewer(v, to)) continue
    for (const item of changesFor(v, lang)) {
      const key = item.title.toLowerCase().replace(/[\s:.,;!¡]+$/u, '')
      if (seen.has(key)) continue
      seen.add(key)
      out.push(item)
    }
  }
  return out
}

/**
 * Novedades de la ventana de la app: todo lo de la versión principal, desde su X.0.0 (incluida) hasta `to`. Así se
 * ven siempre todas las novedades de verdad, no solo las del último arreglo. Con la 5.0.0 empieza otra lista.
 */
export function majorChanges(to: string, lang: 'es' | 'en'): ChangeItem[] {
  const major = to.split('.')[0]
  // Justo antes de la X.0.0: la última versión posible de la principal anterior
  return changesSince(`${Number(major) - 1}.9999.9999`, to, lang)
}
