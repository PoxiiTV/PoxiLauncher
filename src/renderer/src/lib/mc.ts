import type { McInstance, McSnapshot } from '@shared/types'
import type { McResult } from '@shared/ipc'
import { navigate, toast } from '../store'
import { invoke } from '../api'
import type { T } from '../i18n'

/** Resultado de un cambio en una instancia: avisa si ha fallado o si algo no se ha podido recuperar */
export function reportResult(r: McResult): boolean {
  if (r.error) toast({ kind: 'error', key: r.error })
  else if (r.missing?.length) toast({ kind: 'error', key: 'mc.content.missing', params: { list: r.missing.join(', ') } })
  return r.ok
}

/** Texto de una foto del historial ("Quitar Sodium", "Actualizar 5 elementos"…) */
export function snapshotLabel(s: McSnapshot, t: T): string {
  const base = s.key.replace('mc.history.', '')
  const one = !!s.params?.name
  const key = ['update', 'remove', 'enable', 'disable'].includes(base) ? `${base}${one ? 'One' : 'Many'}` : base === 'version' ? 'versionOne' : base
  return t(`mc.history.${key}`, s.params)
}

type Cause = NonNullable<McInstance['crash']>['causes'][number]

/** Explicación de una causa de crasheo */
export function crashLabel(c: Cause, t: T): string {
  const key = c.key === 'mc.crash.missingDep' && !c.params?.mod ? 'mc.crash.missingDepAny' : c.key
  return t(key, c.params)
}

/** Texto del botón que lo arregla (null si no tiene arreglo automático) */
export function crashFixLabel(c: Cause, t: T): string | null {
  const f = c.fix
  if (!f || f.type === 'drivers') return null
  return 'modId' in f ? t(`mc.crash.fix.${f.type}`, { mod: f.modId, want: 'want' in f ? f.want : '' }) : t(`mc.crash.fix.${f.type}`)
}

/** Qué hizo alguien del grupo en el pack ("Instaló Sodium", "Quitó 3 elementos"…) */
export function packNoteLabel(note: { key: string; params?: Record<string, string> }, t: T): string {
  const many = !!note.params?.n && !note.params?.name
  return t(`mc.pack.notes.${note.key}${many ? 'Many' : ''}`, note.params)
}

/** "Unirme a mi amigo": su pack (instalado o al día) y a su servidor si está en uno */
export async function joinFriend(friendId: string): Promise<void> {
  const r = await invoke('mc:joinFriend', friendId).catch(() => ({ ok: false, error: 'mc.share.failed' as const, id: undefined }))
  if (r.error) toast({ kind: 'error', key: r.error })
  if (r.id) navigate({ name: 'mcInstance', id: r.id })
}
