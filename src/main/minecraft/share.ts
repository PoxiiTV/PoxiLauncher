import type { McError, McInstance, McLoader, McPack, McPackDiff, McPresence } from '@shared/types'
import { accountCall, freshAccess, getAccount, onMcPacks, setMcPresence, signedIn } from '../account/service'
import { UPDATE_BASE } from '../net'
import { joinTunnel, type JoinedTunnel } from './tunnel'
import { scan } from './content'
import * as mods from './mods'
import { changeOps, diffEmpty, packDiff, shareable, type PackOp } from './rules'

// Packs de Minecraft compartidos con amigos: la receta (versión, loader y lista de Modrinth) vive en nuestro
// servidor. Cada cambio tuyo en una instancia compartida se sube al momento; los de tus amigos llegan con el
// latido (o al instante por los avisos en directo) y se te enseñan antes de aplicarlos. También "Unirme": entrar
// en la partida de un amigo con su mismo pack.

/** Lo que este módulo necesita de las instancias (se lo da el servicio al arrancar: así no se importan en círculo) */
export interface ShareHost {
  instances(): McInstance[]
  find(id: string): McInstance
  ctx(id: string): mods.ContentCtx
  create(name: string, mc: string, loader: McLoader, loaderVersion: string | undefined, icon: string | null): Promise<string>
  setPack(id: string, packId: string | undefined): void
  changed(): void
  play(id: string, server?: { host: string; port: number }): Promise<{ ok: boolean; error?: McError }>
  presence(): McPresence | null
  /** Tu cuenta activa es de Microsoft */
  premium(): boolean
  /** Al terminar la partida en curso */
  onGameEnd(fn: () => void): void
}

type Result = { ok: boolean; error?: McError; id?: string }

let host: ShareHost
let packs: McPack[] = []
let diffs: Record<string, McPackDiff> = {}
/** Cambios que no se pudieron subir (sin conexión): se reintentan en el siguiente latido */
const unpushed = new Map<string, { ops: PackOp[]; note: { key: string; params?: Record<string, string> } }[]>()

export const packState = (): { packs: McPack[]; packDiffs: Record<string, McPackDiff> } => ({ packs, packDiffs: diffs })

const HISTORY_TO_NOTE: Record<string, string> = {
  'mc.history.install': 'install',
  'mc.history.optimize': 'install',
  'mc.history.update': 'update',
  'mc.history.version': 'version',
  'mc.history.remove': 'remove',
  'mc.history.rollback': 'sync'
}

export function initShare(h: ShareHost): void {
  host = h
  setMcPresence(() => host.presence())
  onMcPacks(async (list) => {
    packs = list
    await retryPushes()
    await refreshDiffs()
    host.changed()
  })
  mods.onContentChange((inst, before, after, key) => void pushChange(inst, before, after, key))
}

const packOf = (inst: McInstance): McPack | undefined => packs.find((p) => p.id === inst.packId && !p.invited)

/** Diferencias entre cada instancia compartida y su pack (solo con archivos locales: sin red) */
async function refreshDiffs(): Promise<void> {
  const next: Record<string, McPackDiff> = {}
  for (const inst of host.instances()) {
    if (!inst.packId) continue
    const p = packOf(inst)
    // El pack ya no existe (o te has salido desde otro PC): la instancia se queda como está, sin grupo
    if (!p) {
      if (signedIn()) host.setPack(inst.id, undefined)
      continue
    }
    const { items } = await scan(host.ctx(inst.id).dir)
    const d = packDiff(p.items, items)
    if (!diffEmpty(d)) next[inst.id] = d
  }
  diffs = next
}

const replacePack = (p: McPack): void => {
  packs = [...packs.filter((x) => x.id !== p.id), p]
}

async function send(packId: string, ops: PackOp[], note: { key: string; params?: Record<string, string> }): Promise<boolean> {
  try {
    const r = await accountCall('POST', `/mc/packs/${packId}/items`, { ops, note })
    if (r.status !== 200) return false
    replacePack((r.data as { pack: McPack }).pack)
    return true
  } catch {
    return false
  }
}

/** Un cambio tuyo en una instancia compartida: se sube al grupo */
async function pushChange(inst: McInstance, before: Parameters<typeof changeOps>[0], after: Parameters<typeof changeOps>[1], key: string): Promise<void> {
  const noteKey = HISTORY_TO_NOTE[key]
  if (!inst.packId || !noteKey) return
  const ops = changeOps(before, after)
  if (!ops.length) return
  const one = ops.length === 1 ? ops[0] : null
  const name = one ? (one.op === 'set' ? one.item.title : (before.find((c) => c.projectId === one.projectId)?.title ?? '')) : ''
  const params: Record<string, string> = one ? { name } : { n: String(ops.length) }
  const note = { key: noteKey, params }
  if (!(await send(inst.packId, ops, note))) unpushed.set(inst.id, [...(unpushed.get(inst.id) ?? []), { ops, note }])
  await refreshDiffs()
  host.changed()
}

async function retryPushes(): Promise<void> {
  for (const [id, list] of unpushed) {
    const inst = host.instances().find((i) => i.id === id)
    if (!inst?.packId) {
      unpushed.delete(id)
      continue
    }
    while (list.length && (await send(inst.packId, list[0].ops, list[0].note))) list.shift()
    if (!list.length) unpushed.delete(id)
  }
}

// ——— Lo que hace el usuario ———
/** Comparte la instancia con estos amigos (la primera vez crea el pack) */
export async function sharePack(id: string, friendIds: string[]): Promise<Result> {
  const inst = host.find(id)
  try {
    if (!inst.packId) {
      const { items } = await scan(host.ctx(id).dir)
      const info = {
        name: inst.name,
        mc: inst.version,
        loader: inst.loader,
        ...(inst.loaderVersion ? { loaderVersion: inst.loaderVersion } : {}),
        icon: inst.icon && /^https:\/\//.test(inst.icon) ? inst.icon : null
      }
      const r = await accountCall('POST', '/mc/packs', { info, items: shareable(items) })
      if (r.status !== 200) return { ok: false, error: 'mc.share.failed' }
      const p = (r.data as { pack: McPack }).pack
      replacePack(p)
      host.setPack(id, p.id)
    }
    const packId = host.find(id).packId!
    for (const f of friendIds) {
      const r = await accountCall('POST', `/mc/packs/${packId}/invite`, { friendId: f })
      if (r.status === 200) replacePack((r.data as { pack: McPack }).pack)
    }
    host.changed()
    return { ok: true }
  } catch {
    return { ok: false, error: 'mc.share.failed' }
  }
}

export async function leavePack(id: string): Promise<Result> {
  const inst = host.find(id)
  if (!inst.packId) return { ok: true }
  try {
    await accountCall('DELETE', `/mc/packs/${inst.packId}`)
  } catch {
    return { ok: false, error: 'mc.share.failed' }
  }
  packs = packs.filter((p) => p.id !== inst.packId)
  host.setPack(id, undefined)
  delete diffs[id]
  host.changed()
  return { ok: true }
}

/** Crea una instancia con el pack del grupo y la deja igual que él */
async function instanceFromPack(p: McPack): Promise<Result> {
  const id = await host.create(p.name, p.mc, p.loader, p.loaderVersion ?? undefined, p.icon)
  host.setPack(id, p.id)
  const r = await mods.syncTo(host.ctx(id), p.items, p.owner.username)
  await refreshDiffs()
  host.changed()
  return { ...r, id }
}

/** Contestar a una invitación: al aceptar se crea la instancia con el pack */
export async function answerPack(packId: string, accept: boolean): Promise<Result> {
  try {
    const r = await accountCall('POST', `/mc/packs/${packId}/${accept ? 'accept' : 'decline'}`)
    if (r.status !== 200) return { ok: false, error: 'mc.share.failed' }
    if (!accept) {
      packs = packs.filter((p) => p.id !== packId)
      host.changed()
      return { ok: true }
    }
    const p = (r.data as { pack: McPack }).pack
    replacePack(p)
    return await instanceFromPack(p)
  } catch {
    return { ok: false, error: 'mc.share.failed' }
  }
}

/** Ponerse al día con el pack del grupo (antes se ha enseñado qué cambia) */
export async function applyPack(id: string): Promise<Result> {
  const inst = host.find(id)
  const p = packOf(inst)
  if (!p) return { ok: false }
  const r = await mods.syncTo(host.ctx(id), p.items, p.history[0]?.by.username ?? '')
  await refreshDiffs()
  host.changed()
  return r
}

/** Todo el grupo vuelve a como estaba el pack en esa revisión (y tú te pones al día) */
export async function rollbackPack(id: string, rev: number): Promise<Result> {
  const inst = host.find(id)
  if (!inst.packId) return { ok: false }
  try {
    const r = await accountCall('POST', `/mc/packs/${inst.packId}/rollback`, { rev })
    if (r.status !== 200) return { ok: false, error: 'mc.share.failed' }
    replacePack((r.data as { pack: McPack }).pack)
  } catch {
    return { ok: false, error: 'mc.share.failed' }
  }
  return applyPack(id)
}

/**
 * "Unirme a mi amigo": su pack (si juega con uno; te unes y se instala o se pone al día) o una instancia con su misma
 * versión, y a su servidor directamente si está en uno.
 */
export async function joinFriend(friendId: string): Promise<Result> {
  const f = getAccount().friends.find((x) => x.id === friendId)
  const mc = f?.mc
  if (!mc) return { ok: false, error: 'mc.join.notPlaying' }
  let id: string | undefined
  if (mc.packId) {
    id = host.instances().find((i) => i.packId === mc.packId)?.id
    if (!id) {
      try {
        const r = await accountCall('POST', `/mc/packs/${mc.packId}/join`)
        if (r.status !== 200) return { ok: false, error: 'mc.share.failed' }
        const p = (r.data as { pack: McPack }).pack
        replacePack(p)
        const made = await instanceFromPack(p)
        if (!made.ok) return made
        id = made.id
      } catch {
        return { ok: false, error: 'mc.share.failed' }
      }
    } else if (diffs[id]) {
      // Ya la tienes: primero al día con el grupo, o no te dejaría entrar
      const r = await applyPack(id)
      if (!r.ok) return r
    }
  } else {
    // Sin pack solo se puede con vanilla (con mods sin compartir no sabríamos cuáles son)
    if (mc.loader !== 'vanilla') return { ok: false, error: 'mc.join.needsPack' }
    id = host.instances().find((i) => i.loader === 'vanilla' && i.version === mc.version && !i.packId)?.id
    id ??= await host.create(`Minecraft ${mc.version}`, mc.version, 'vanilla', undefined, null)
  }
  // Mundo o servidor alojado por PoxiLauncher: por el túnel (un puerto local que lleva hasta tu amigo)
  let server = mc.server
  let tunnel: JoinedTunnel | null = null
  if (mc.tunnel) {
    // A un mundo LAN de una cuenta Microsoft solo entran cuentas Microsoft (Minecraft lo comprueba)
    if (mc.premium && !host.premium()) return { ok: false, error: 'mc.join.needsPremium', id }
    try {
      tunnel = await joinTunnel(UPDATE_BASE, freshAccess, mc.tunnel)
      server = { host: '127.0.0.1', port: tunnel.port }
    } catch {
      return { ok: false, error: 'mc.join.tunnelFailed', id }
    }
  }
  const played = await host.play(id!, server)
  if (tunnel) {
    const t = tunnel
    if (played.ok) host.onGameEnd(() => t.close())
    else t.close()
  }
  return { ...played, id }
}

/**
 * Instancias en la nube: un pack en el que estás pero que no tienes en este PC (otro PC tuyo, o un pack solo tuyo
 * que guardaste). Se instala aquí igual que al aceptar una invitación.
 */
/** Quita de la nube un pack que no tienes en este PC: sales de él (si eras el último, se borra con su mundo del grupo) */
export async function removeCloudPack(packId: string): Promise<Result> {
  if (host.instances().some((i) => i.packId === packId)) return { ok: false }
  try {
    const r = await accountCall('DELETE', `/mc/packs/${packId}`)
    if (r.status !== 200) return { ok: false, error: 'mc.share.failed' }
  } catch {
    return { ok: false, error: 'mc.share.failed' }
  }
  packs = packs.filter((p) => p.id !== packId)
  host.changed()
  return { ok: true }
}

export async function installFromCloud(packId: string): Promise<Result> {
  const p = packs.find((x) => x.id === packId && !x.invited)
  if (!p) return { ok: false }
  const have = host.instances().find((i) => i.packId === packId)
  if (have) return { ok: true, id: have.id }
  try {
    return await instanceFromPack(p)
  } catch {
    return { ok: false, error: 'mc.share.failed' }
  }
}
