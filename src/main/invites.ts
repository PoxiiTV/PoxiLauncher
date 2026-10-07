import { app } from 'electron'
import type { InviteLink, InvitePreview, InviteResult } from '@shared/types'
import { accountCall, getAccount, signedIn, syncNow } from './account/service'
import { joinFriend, installFromCloud, sharePack } from './minecraft/share'
import { getMinecraft } from './minecraft/service'
import { serverFetch, UPDATE_BASE } from './net'
import { emit } from './events'

// Enlaces de invitación (<servidor>/i/<código>): la página abre poxilauncher://invite/<código>, Windows
// abre la app (o se lo pasa a la que ya está abierta) y aquí se acepta: amigos, el pack instalado y, si quien invita
// está jugando, directo a su partida.

const PROTOCOL = 'poxilauncher'
const LINK = /^poxilauncher:\/\/invite\/([A-HJKMNP-Z2-9]{8})\/?$/i
const CODE = /^[A-HJKMNP-Z2-9]{8}$/

/** El enlace que ha abierto la app y aún no ha visto la ventana */
let pending: string | null = null

/** Que Windows abra la app con los enlaces poxilauncher:// (el instalador ya lo registra; el portable, aquí con su ruta) */
export function registerProtocol(portableExe: string | undefined): void {
  if (!app.isPackaged) return
  if (portableExe) app.setAsDefaultProtocolClient(PROTOCOL, portableExe, [])
  else app.setAsDefaultProtocolClient(PROTOCOL)
}

/** Busca un enlace de invitación entre los argumentos con los que se abrió la app */
export function inviteFromArgv(argv: string[]): void {
  const code = argv.map((a) => LINK.exec(a.trim())?.[1]).find(Boolean)
  if (!code) return
  pending = code.toUpperCase()
  emit('invite', pending)
}

/** La ventana pregunta al abrirse si llegó con un enlace (y lo consume) */
export function takeInvite(): string | null {
  const code = pending
  pending = null
  return code
}

const view = (i: Omit<InviteLink, 'url'>): InviteLink => ({ ...i, url: `${UPDATE_BASE}/i/${i.code}` })

/** Tu enlace: de amistad (sin instancia) o de una instancia (la comparte en un pack si aún no lo estaba) */
export async function createInvite(instanceId: string | null): Promise<InviteLink | null> {
  let pack: string | null = null
  if (instanceId) {
    const packOf = (): string | undefined => getMinecraft().instances.find((i) => i.id === instanceId)?.packId
    if (!packOf() && !(await sharePack(instanceId, [])).ok) return null
    pack = packOf() ?? null
    if (!pack) return null
  }
  const r = await accountCall('POST', '/invites', { pack }).catch(() => null)
  return r?.status === 200 ? view((r.data as { invite: Omit<InviteLink, 'url'> }).invite) : null
}

export async function revokeInvite(code: string): Promise<boolean> {
  const r = await accountCall('DELETE', `/invites/${code}`).catch(() => null)
  return r?.status === 200
}

/** Quién invita y a qué (no hace falta cuenta). null si ya no vale; 'offline' sin conexión */
export async function previewInvite(code: string): Promise<InvitePreview | null | 'offline'> {
  if (!CODE.test(code)) return null
  try {
    const res = await serverFetch(`/api/invites/${code}`, { method: 'GET' })
    return res.ok ? ((await res.json()) as InvitePreview) : null
  } catch {
    return 'offline'
  }
}

/** Aceptar: amigos y su pack; si está jugando con túnel o en un servidor, directo a su partida */
export async function acceptInvite(code: string): Promise<InviteResult> {
  if (!signedIn() || !CODE.test(code)) return { ok: false, error: 'invite.gone' }
  const r = await accountCall('POST', `/invites/${code}/accept`).catch(() => null)
  if (!r) return { ok: false, error: 'invite.offline' }
  if (r.status !== 200) return { ok: false, error: r.status === 400 ? 'invite.self' : 'invite.gone' }
  const { friend, pack, full } = r.data as { friend: string; pack: string | null; full: boolean }
  // Su estado y el pack nuevo llegan con el latido
  await syncNow()
  const f = getAccount().friends.find((x) => x.id === friend)
  const playing = f?.state === 'playing' && !!(f.mc?.tunnel || f.mc?.server) && (!pack || f.mc?.packId === pack)
  const done = playing ? await joinFriend(friend) : pack ? await installFromCloud(pack) : { ok: true }
  return { ok: done.ok, error: done.error, id: done.id, friend, full, joined: playing && done.ok }
}
