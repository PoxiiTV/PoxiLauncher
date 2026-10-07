import { translate } from '@shared/i18n'
import { useStore } from '../store'

export type T = (key: string, params?: Record<string, string | number>) => string

export function useT(): T {
  const lang = useStore((s) => s.settings?.lang ?? 'es')
  return (key, params) => translate(lang, key, params)
}
