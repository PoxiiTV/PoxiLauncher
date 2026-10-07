import type { McSkinInfo } from '@shared/types'
import { safeFetch } from '../net'
import { isSkinPng } from './rules'

// Skin y capa de una cuenta Microsoft (API oficial de Mojang). Las cuentas sin conexión no tienen: los demás
// jugadores no la verían.

const PROFILE = 'https://api.minecraftservices.com/minecraft/profile'

interface Profile {
  skins?: { url: string; state: string; variant: string }[]
  capes?: { id: string; alias: string; url: string; state: string }[]
}

const auth = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` })

export async function getSkinInfo(token: string): Promise<McSkinInfo> {
  const res = await safeFetch(PROFILE, 3, auth(token))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const p = (await res.json()) as Profile
  const s = p.skins?.find((x) => x.state === 'ACTIVE')
  return {
    skin: s ? { url: s.url, variant: s.variant?.toLowerCase() === 'slim' ? 'slim' : 'classic' } : null,
    capes: (p.capes ?? []).map((c) => ({ id: c.id, alias: c.alias, url: c.url, active: c.state === 'ACTIVE' }))
  }
}

/**
 * Las texturas como data: (unos KB cada una): el visor 3D las pinta con WebGL, que no acepta imágenes de otra web si
 * esa web no lo permite (textures.minecraft.net no lo hace). Si alguna no baja, se queda su dirección.
 */
export async function withTextures(info: McSkinInfo): Promise<McSkinInfo> {
  const inline = async (url: string): Promise<string> => {
    const res = await safeFetch(url, 2).catch(() => null)
    return res?.ok ? `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}` : url
  }
  const [skin, ...capes] = await Promise.all([info.skin ? inline(info.skin.url) : '', ...info.capes.map((c) => inline(c.url))])
  return { skin: info.skin && { ...info.skin, url: skin }, capes: info.capes.map((c, i) => ({ ...c, url: capes[i] })) }
}

/** Sube una skin nueva; devuelve la dirección de la textura activa */
export async function uploadSkin(token: string, png: Buffer, variant: 'classic' | 'slim'): Promise<string | null> {
  if (!isSkinPng(png)) throw new Error('No es una skin')
  const form = new FormData()
  form.append('variant', variant)
  form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'skin.png')
  const res = await safeFetch(`${PROFILE}/skins`, 1, auth(token), form)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await getSkinInfo(token)).skin?.url ?? null
}

/** Vuelve a la skin por defecto */
export async function resetSkin(token: string): Promise<void> {
  const res = await safeFetch(`${PROFILE}/skins/active`, 1, auth(token), undefined, 'DELETE')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

/** Pone una capa (o ninguna, con null) */
export async function setCape(token: string, capeId: string | null): Promise<void> {
  const res = capeId
    ? await safeFetch(`${PROFILE}/capes/active`, 1, { ...auth(token), 'Content-Type': 'application/json' }, JSON.stringify({ capeId }), 'PUT')
    : await safeFetch(`${PROFILE}/capes/active`, 1, auth(token), undefined, 'DELETE')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}
