import { createHash, randomBytes } from 'node:crypto'

// Reglas puras de Minecraft (sin red ni disco): se pueden probar sin abrir nada.

/** Nombre de jugador válido para Minecraft: 3-16 letras, números o "_" */
export const isValidPlayerName = (name: string): boolean => /^[A-Za-z0-9_]{3,16}$/.test(name)

/**
 * UUID de una cuenta sin conexión: el mismo que calcula el servidor de Minecraft en modo offline
 * (UUID v3 de "OfflinePlayer:<nombre>"). Así el mismo nombre conserva su inventario y sus mundos.
 */
export function offlineUuid(name: string): string {
  const b = createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest()
  b[6] = (b[6] & 0x0f) | 0x30
  b[8] = (b[8] & 0x3f) | 0x80
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** RAM por defecto para el juego (MB): la mitad del PC, entre 2 y 6 GB (más no ayuda en vanilla) */
export function defaultRamMB(totalGB: number): number {
  const half = Math.floor((totalGB * 1024) / 2 / 512) * 512
  return Math.min(6144, Math.max(2048, half))
}

/** Errores de Xbox (XSTS) con explicación para el usuario: clave i18n */
export function xstsErrorKey(code: number): string {
  switch (code) {
    case 2148916233:
      return 'mc.auth.noXbox'
    case 2148916235:
      return 'mc.auth.region'
    case 2148916236:
    case 2148916237:
      return 'mc.auth.ageProof'
    case 2148916238:
      return 'mc.auth.child'
    default:
      return 'mc.auth.failed'
  }
}

/** Carpeta de una instancia: 8 caracteres hexadecimales (el nombre visible puede ser cualquiera) */
export const instanceId = (): string => randomBytes(4).toString('hex')

// ——— Packs compartidos con amigos ———
type Item = { kind: 'mod' | 'resourcepack' | 'shader'; projectId?: string; versionId?: string; title: string; file: string; version?: string }
export interface PackItem {
  kind: 'mod' | 'resourcepack' | 'shader'
  projectId: string
  versionId: string
  title: string
  file: string
}
export type PackOp = { op: 'set'; item: PackItem } | { op: 'remove'; projectId: string }

/** Lo de Modrinth de una lista (lo puesto a mano no se puede compartir: cada uno lo baja de Modrinth) */
export const shareable = (items: Item[]): PackItem[] =>
  items
    .filter((c): c is Item & { projectId: string; versionId: string } => !!c.projectId && !!c.versionId)
    .map(({ kind, projectId, versionId, title, file }) => ({ kind, projectId, versionId, title, file }))

/** Qué cambiaría al ponerse al día con el pack del grupo (activado o no, lo que tienes cuenta como que está) */
export function packDiff(remote: PackItem[], local: Item[]): { add: PackItem[]; remove: { projectId: string; title: string }[]; change: (PackItem & { from: string })[] } {
  const mine = new Map(shareable(local).map((c) => [c.projectId, c]))
  const theirs = new Set(remote.map((x) => x.projectId))
  const versionOf = new Map(local.filter((c) => c.projectId).map((c) => [c.projectId!, c.version ?? '']))
  return {
    add: remote.filter((x) => !mine.has(x.projectId)),
    change: remote.filter((x) => mine.has(x.projectId) && mine.get(x.projectId)!.versionId !== x.versionId).map((x) => ({ ...x, from: versionOf.get(x.projectId) ?? '' })),
    remove: [...mine.values()].filter((c) => !theirs.has(c.projectId)).map((c) => ({ projectId: c.projectId, title: c.title }))
  }
}

export const diffEmpty = (d: ReturnType<typeof packDiff>): boolean => !d.add.length && !d.remove.length && !d.change.length

/** Operaciones para subir al grupo lo que ha cambiado entre dos listas (activar/desactivar es cosa de cada uno) */
export function changeOps(before: Item[], after: Item[]): PackOp[] {
  const was = new Map(shareable(before).map((c) => [c.projectId, c]))
  const now = shareable(after)
  const ops: PackOp[] = now.filter((c) => was.get(c.projectId)?.versionId !== c.versionId).map((item) => ({ op: 'set', item }))
  const still = new Set(now.map((c) => c.projectId))
  for (const id of was.keys()) if (!still.has(id)) ops.push({ op: 'remove', projectId: id })
  return ops
}

/** ¿Es un PNG de skin de verdad? (firma de PNG y 64×64 o 64×32 en su cabecera) */
export function isSkinPng(buf: Buffer): boolean {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (buf.length < 33 || buf.length > 64 * 1024 || !buf.subarray(0, 8).equals(sig) || buf.toString('ascii', 12, 16) !== 'IHDR') return false
  const w = buf.readUInt32BE(16)
  const h = buf.readUInt32BE(20)
  return w === 64 && (h === 64 || h === 32)
}

// ——— Versiones de mods (reglas de Fabric/Quilt) ———
/** "0.6.13+mc1.21.1" → [0, 6, 13] (sin compilación ni prerrelease) */
export const versionParts = (v: string): number[] =>
  v
    .replace(/\+.*$/, '')
    .replace(/-.*$/, '')
    .split('.')
    .map((x) => (x === 'x' || x === 'X' || x === '*' ? NaN : parseInt(x, 10)))

function cmp(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d) return d
  }
  return 0
}

/** Una condición de Fabric ("0.6.x", ">=0.6.0-", "~1.2", "^1.2", "*", "1.2.3"); varias separadas por espacio: todas */
function satisfiesOne(version: number[], pred: string): boolean {
  return pred
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .every((c) => {
      if (c === '*') return true
      const m = /^(>=|<=|>|<|=|~|\^)?(.+)$/.exec(c)!
      const op = m[1] ?? ''
      const target = versionParts(m[2])
      const wild = target.findIndex((x) => Number.isNaN(x))
      if (wild >= 0) return version.slice(0, wild).every((x, i) => x === target[i])
      const d = cmp(version, target)
      switch (op) {
        case '>=':
          return d >= 0
        case '<=':
          return d <= 0
        case '>':
          return d > 0
        case '<':
          return d < 0
        case '~':
          return d >= 0 && version[0] === target[0] && (version[1] ?? 0) === (target[1] ?? 0)
        case '^':
          return d >= 0 && version[0] === target[0]
        default:
          return d === 0
      }
    })
}

/** ¿Cumple esta versión lo que pide el mod? (una lista de condiciones = vale cualquiera) */
export function satisfies(version: string, pred: string | string[]): boolean {
  const v = versionParts(version)
  if (v.some((x) => Number.isNaN(x))) return false
  return [pred].flat().some((p) => satisfiesOne(v, p))
}

/** La versión del mod dentro del número de Modrinth ("mc1.21.1-0.6.13-fabric" → "0.6.13") */
export function modVersionFrom(versionNumber: string, mc: string): string {
  const rest = versionNumber.split(mc).join(' ')
  return /\d+(?:\.\d+)+/.exec(rest)?.[0] ?? /\d+/.exec(rest)?.[0] ?? ''
}

/**
 * Lo que propone Fabric en su mensaje, en inglés o en español ("any 0.6.x version", "cualquier versión 0.6.x",
 * "version 1.2 or later", "la versión 1.2 o posterior"…), como condición
 */
export function wantToPredicate(text: string): string | null {
  const t = text.trim().replace(/\.$/, '')
  let m: RegExpExecArray | null
  // Español (Messages_es.properties de Fabric Loader)
  if (/^cualquier versión$/i.test(t)) return '*'
  if ((m = /^cualquier versión (\d+)\.x$/i.exec(t))) return `${m[1]}.x`
  if ((m = /^cualquier versión (\d+)\.(\d+)\.x$/i.exec(t))) return `${m[1]}.${m[2]}.x`
  if ((m = /^la versión (\S+) o posterior$/i.exec(t))) return `>=${m[1]}`
  if ((m = /^la versión (\S+) o una anterior$/i.exec(t))) return `<=${m[1]}`
  if ((m = /^cualquier versión tras (\S+)$/i.exec(t))) return `>${m[1]}`
  if ((m = /^cualquier versión anterior a (\S+)$/i.exec(t))) return `<${m[1]}`
  if ((m = /^cualquier versión entre (\S+) \((incluida|excluida)\) y (\S+) \((incluida|excluida)\)$/i.exec(t)))
    return `${m[2] === 'incluida' ? '>=' : '>'}${m[1]} ${m[4] === 'incluida' ? '<=' : '<'}${m[3]}`
  if ((m = /^la versión (\S+)$/i.exec(t))) return m[1]
  if (/^any version$/i.test(t)) return '*'
  if ((m = /^any (\d+)\.x version$/i.exec(t))) return `${m[1]}.x`
  if ((m = /^any (\d+)\.(\d+)\.x version$/i.exec(t))) return `${m[1]}.${m[2]}.x`
  if ((m = /^version (\S+) or later$/i.exec(t))) return `>=${m[1]}`
  if ((m = /^version (\S+) or earlier$/i.exec(t))) return `<=${m[1]}`
  if ((m = /^any version after (\S+)$/i.exec(t))) return `>${m[1]}`
  if ((m = /^any version before (\S+)$/i.exec(t))) return `<${m[1]}`
  if ((m = /^any version between (\S+) \((inclusive|exclusive)\) and (\S+) \((inclusive|exclusive)\)$/i.exec(t)))
    return `${m[2] === 'inclusive' ? '>=' : '>'}${m[1]} ${m[4] === 'inclusive' ? '<=' : '<'}${m[3]}`
  if ((m = /^version (\S+)$/i.exec(t))) return m[1]
  return null
}

/** options.txt con el idioma puesto (el resto de opciones, igual) */
export function withGameLanguage(options: string, lang: string): string {
  const lines = options.split(/\r?\n/).filter((l) => l && !l.startsWith('lang:'))
  return [...lines, `lang:${lang}`].join('\n') + '\n'
}

/**
 * Puerto de un mundo abierto a LAN según la línea del registro del juego. Cada versión lo dice a su manera:
 * "Started serving on 51234" (1.x), "Started on 51234" (las más viejas), "Published LAN server on port 51234" (26.x)
 */
export function lanPort(line: string): number | null {
  const m = /(?:Started (?:serving )?on|Published LAN server on port)\s+(\d{2,5})\s*$/.exec(line)
  return m ? Number(m[1]) : null
}

/** Código de idioma del juego: "es_es" desde la 1.11; antes, "es_ES" */
export function gameLanguage(mc: string, lang: 'es' | 'en'): string {
  const code = lang === 'es' ? 'es_es' : 'en_us'
  const m = /^1\.(\d+)/.exec(mc)
  return m && Number(m[1]) < 11 ? code.replace(/_(\w+)$/, (_, c: string) => `_${c.toUpperCase()}`) : code
}
