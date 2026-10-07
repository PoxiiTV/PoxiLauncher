// Versiones de cada loader de mods para una versión de Minecraft (de más nueva a más vieja; la recomendada primero
// cuando el loader la marca). Sin Electron: se piden con fetch normal a sus webs oficiales.

export type ModLoader = 'fabric' | 'quilt' | 'forge' | 'neoforge'
export interface LoaderVersion {
  id: string
  /** Estable / recomendada por el propio loader */
  stable: boolean
}

const getJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}
const getText = async (url: string): Promise<string> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/** "1.21.1" → prefijo de NeoForge "21.1."; "1.21" → "21.0."; las versiones nuevas ("26.1") → "26.1." */
export function neoforgePrefix(mc: string): string {
  if (!mc.startsWith('1.')) return `${mc}.`
  const [minor, patch = '0'] = mc.slice(2).split('.')
  return `${minor}.${patch}.`
}

/** Compara versiones numéricas con puntos ("47.10.2" > "47.9.0") */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}

/** Versiones de Forge de un Minecraft a partir del índice de su maven ("1.20.1-47.3.0" → "47.3.0") */
export function forgeVersionsFrom(metadataXml: string, mc: string, recommended?: string): LoaderVersion[] {
  const all = [...metadataXml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1].trim())
  return all
    .filter((v) => v.startsWith(`${mc}-`))
    .map((v) => v.slice(mc.length + 1))
    // Las de 1.7-1.9 llevan sufijo con la versión de MC repetida ("10.13.4.1614-1.7.10"): fuera
    .filter((v) => /^[\d.]+$/.test(v))
    .sort((a, b) => compareVersions(b, a))
    .map((id) => ({ id, stable: id === recommended }))
}

/** Versiones de NeoForge (su API las da todas; se filtran por el prefijo de la versión de MC) */
export function neoforgeVersionsFrom(all: string[], mc: string): LoaderVersion[] {
  const prefix = neoforgePrefix(mc)
  return all
    .filter((v) => v.startsWith(prefix))
    .sort((a, b) => compareVersions(b, a))
    .map((id) => ({ id, stable: !/beta|alpha/i.test(id) }))
}

export async function loaderVersions(loader: ModLoader, mc: string): Promise<LoaderVersion[]> {
  switch (loader) {
    case 'fabric': {
      const list = await getJson<{ loader: { version: string; stable: boolean } }[]>(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}`)
      return list.map((x) => ({ id: x.loader.version, stable: x.loader.stable }))
    }
    case 'quilt': {
      const list = await getJson<{ loader: { version: string } }[]>(`https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(mc)}`)
      return list.map((x) => ({ id: x.loader.version, stable: !/beta|alpha|pre|rc/i.test(x.loader.version) }))
    }
    case 'forge': {
      const [xml, promos] = await Promise.all([
        getText('https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml'),
        getJson<{ promos: Record<string, string> }>('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json').catch(() => ({ promos: {} as Record<string, string> }))
      ])
      const rec = promos.promos[`${mc}-recommended`] ?? promos.promos[`${mc}-latest`]
      const list = forgeVersionsFrom(xml, mc, rec)
      // La recomendada, primero
      return [...list.filter((v) => v.stable), ...list.filter((v) => !v.stable)]
    }
    case 'neoforge': {
      const { versions } = await getJson<{ versions: string[] }>('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge')
      return neoforgeVersionsFrom(versions, mc)
    }
  }
}

/** La versión que se elige por defecto: la primera estable (o la primera, si no hay estables) */
export const defaultLoaderVersion = (list: LoaderVersion[]): string | undefined => (list.find((v) => v.stable) ?? list[0])?.id
