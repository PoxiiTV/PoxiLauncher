import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import es from '../src/shared/i18n/es'
import en from '../src/shared/i18n/en'

// Una clave sin texto sale tal cual en pantalla («mc.play.x»): toda clave escrita en el código tiene que existir en
// los dos idiomas. (Las que se montan con plantillas, `prefs.${k}.label`, no se pueden comprobar así.)

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === 'i18n' ? [] : files(join(dir, e.name))) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []
  )

const has = (dict: unknown, key: string): boolean =>
  typeof key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], dict) === 'string'

/** Claves literales: t('a.b'), translate(lang, 'a.b'), notify('a.b'), key: 'a.b' */
function usedKeys(): string[] {
  const rx = /(?:\bt|translate\([^,()]+,|notify|\bkey:)\s*\(?\s*'([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+)'/g
  const out = new Set<string>()
  for (const f of files('src')) for (const m of readFileSync(f, 'utf8').matchAll(rx)) out.add(m[1])
  return [...out]
}

describe('textos', () => {
  const keys = usedKeys()
  it('encuentra las claves del código', () => {
    expect(keys.length).toBeGreaterThan(200)
  })
  // El índice de Ajustes (settings/cats.tsx) da sus claves sin «prefs.» delante
  const exists = (dict: unknown, k: string): boolean => has(dict, k) || has(dict, `prefs.${k}`)
  it('todas existen en español y en inglés', () => {
    expect(keys.filter((k) => !exists(es, k))).toEqual([])
    expect(keys.filter((k) => !exists(en, k))).toEqual([])
  })
})
