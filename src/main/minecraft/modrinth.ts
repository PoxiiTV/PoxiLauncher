import { app } from 'electron'
import { safeFetch } from '../net'

// API de Modrinth (v2). Modrinth pide un User-Agent que identifique la app. Todo pasa por safeFetch (lista blanca,
// reintentos). Las descargas se comprueban con el sha512 que da la propia API.

const API = 'https://api.modrinth.com/v2'
const headers = (): Record<string, string> => ({ 'User-Agent': `Poxi/PoxiLauncher/${app.getVersion()}` })

export type ContentKind = 'mod' | 'resourcepack' | 'shader' | 'modpack'

export interface MrHit {
  project_id: string
  slug: string
  title: string
  description: string
  icon_url: string | null
  downloads: number
  follows: number
  author: string
  categories: string[]
  client_side: string
  server_side: string
  date_modified: string
  project_type: string
}

export interface MrFile {
  url: string
  filename: string
  primary: boolean
  size: number
  hashes: { sha1: string; sha512: string }
}

export interface MrVersion {
  id: string
  project_id: string
  name: string
  version_number: string
  version_type: 'release' | 'beta' | 'alpha'
  date_published: string
  loaders: string[]
  game_versions: string[]
  files: MrFile[]
  dependencies: { project_id: string | null; version_id: string | null; file_name: string | null; dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded' }[]
}

export interface MrProject {
  id: string
  slug: string
  title: string
  description: string
  icon_url: string | null
  project_type: string
  client_side: string
  server_side: string
  downloads: number
}

// Modrinth a veces contesta 503 ("no available server") unos segundos: se reintenta con espera creciente
const TRIES = 5

async function get<T>(path: string): Promise<T> {
  const res = await safeFetch(`${API}${path}`, TRIES, headers())
  if (!res.ok) throw new Error(`Modrinth ${res.status}`)
  return (await res.json()) as T
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await safeFetch(`${API}${path}`, TRIES, { ...headers(), 'Content-Type': 'application/json' }, JSON.stringify(body))
  if (!res.ok) throw new Error(`Modrinth ${res.status}`)
  return (await res.json()) as T
}

/**
 * Loaders cuyos mods valen para una instancia. Quilt carga también los de Fabric. Para resource packs y shaders
 * no se filtra por loader (valen en cualquiera).
 */
export const loadersFor = (loader: string): string[] => (loader === 'quilt' ? ['quilt', 'fabric'] : [loader])

export type SearchSort = 'relevance' | 'downloads' | 'updated' | 'newest'

/** Filtros de búsqueda en el formato de Modrinth: dentro de cada lista, "o"; entre listas, "y" */
export function searchFacets(kind: ContentKind, mc: string | null, loader: string | null): string[][] {
  const facets = [[`project_type:${kind}`]]
  if (mc) facets.push([`versions:${mc}`])
  if (kind === 'mod' && loader && loader !== 'vanilla') facets.push(loadersFor(loader).map((l) => `categories:${l}`))
  if (kind === 'modpack' && loader && loader !== 'vanilla') facets.push([`categories:${loader}`])
  return facets
}

export async function search(q: string, kind: ContentKind, mc: string | null, loader: string | null, sort: SearchSort, offset: number): Promise<{ hits: MrHit[]; total: number }> {
  const params = new URLSearchParams({
    query: q,
    facets: JSON.stringify(searchFacets(kind, mc, loader)),
    index: sort,
    offset: String(offset),
    limit: '20'
  })
  const r = await get<{ hits: MrHit[]; total_hits: number }>(`/search?${params}`)
  return { hits: r.hits, total: r.total_hits }
}

export const getProject = (id: string): Promise<MrProject> => get(`/project/${encodeURIComponent(id)}`)

export async function getProjects(ids: string[]): Promise<MrProject[]> {
  if (!ids.length) return []
  return get(`/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`)
}

export const getVersion = (id: string): Promise<MrVersion> => get(`/version/${encodeURIComponent(id)}`)

export async function getVersions(ids: string[]): Promise<MrVersion[]> {
  if (!ids.length) return []
  return get(`/versions?ids=${encodeURIComponent(JSON.stringify(ids))}`)
}

/** Versiones de un proyecto que valen para esta versión de Minecraft y este loader (la más nueva primero) */
export function projectVersions(id: string, mc: string, loaders: string[] | null): Promise<MrVersion[]> {
  const params = new URLSearchParams({ game_versions: JSON.stringify([mc]) })
  if (loaders) params.set('loaders', JSON.stringify(loaders))
  return get(`/project/${encodeURIComponent(id)}/version?${params}`)
}

/** Todas las versiones de un proyecto, sin filtrar (los modpacks dicen ellos mismos su versión de Minecraft) */
export const allVersions = (id: string): Promise<MrVersion[]> => get(`/project/${encodeURIComponent(id)}/version`)

/** Qué versión de Modrinth es cada archivo (por su sha1): así se reconocen los mods puestos a mano */
export const identify = (sha1s: string[]): Promise<Record<string, MrVersion>> =>
  sha1s.length ? post('/version_files', { hashes: sha1s, algorithm: 'sha1' }) : Promise.resolve({})

/** Última versión compatible de cada archivo (por su sha1) */
export function latestFor(sha1s: string[], mc: string, loaders: string[] | null): Promise<Record<string, MrVersion>> {
  if (!sha1s.length) return Promise.resolve({})
  return post('/version_files/update', { hashes: sha1s, algorithm: 'sha1', game_versions: [mc], ...(loaders ? { loaders } : {}) })
}

/** El archivo que hay que bajar de una versión: el principal (o el primero) */
export const primaryFile = (v: MrVersion): MrFile | undefined => v.files.find((f) => f.primary) ?? v.files[0]

/** La mejor versión para instalar: la release más nueva; si no hay, la beta o alpha más nueva */
export const bestVersion = (list: MrVersion[]): MrVersion | undefined => list.find((v) => v.version_type === 'release') ?? list[0]
