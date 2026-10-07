import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { readFile, rename, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { McWorld, McWorldBackup } from '@shared/types'
import { run7z } from '../system/sevenzip'

// Mundos de una instancia (saves/) y sus copias: automáticas al jugar (solo de los mundos que han cambiado desde la
// última) y manuales. Cada copia es un .zip; restaurar hace antes otra copia del mundo tal y como está.

const MAX_AUTO = 5
const MAX_MANUAL = 20

const savesDir = (dir: string): string => join(dir, 'saves')
const backupsDir = (dir: string, world?: string): string => join(dir, '.poxigames', 'worlds', ...(world ? [world] : []))

/** Un mundo es una carpeta de saves/ con level.dat; su nombre viene del disco, pero se comprueba igual */
export function worldPath(dir: string, world: string): string | null {
  if (world !== basename(world) || world === '.' || world === '..') return null
  const p = join(savesDir(dir), world)
  return existsSync(join(p, 'level.dat')) ? p : null
}

/** Última vez que se tocó algo del mundo (level.dat se reescribe al guardar) */
const lastChange = (p: string): number => {
  try {
    return statSync(join(p, 'level.dat')).mtimeMs
  } catch {
    return 0
  }
}

function folderSize(p: string): number {
  let total = 0
  for (const e of readdirSync(p, { withFileTypes: true })) {
    const f = join(p, e.name)
    try {
      total += e.isDirectory() ? folderSize(f) : statSync(f).size
    } catch {
      // Archivo que desaparece mientras se cuenta (el juego guardando)
    }
  }
  return total
}

export function listBackups(dir: string, world: string): McWorldBackup[] {
  const d = backupsDir(dir, world)
  if (!existsSync(d)) return []
  return readdirSync(d)
    .map((f) => /^(\d+)-(auto|manual)\.zip$/.exec(f))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ at: Number(m[1]), auto: m[2] === 'auto', size: statSync(join(d, m[0])).size }))
    .sort((a, b) => b.at - a.at)
}

export async function listWorlds(dir: string): Promise<McWorld[]> {
  if (!existsSync(savesDir(dir))) return []
  const out: McWorld[] = []
  for (const e of readdirSync(savesDir(dir), { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const p = worldPath(dir, e.name)
    if (!p) continue
    let icon: string | null = null
    try {
      icon = `data:image/png;base64,${(await readFile(join(p, 'icon.png'))).toString('base64')}`
    } catch {
      // Sin icono (mundo sin abrir desde 1.8)
    }
    out.push({ id: e.name, lastPlayed: lastChange(p), size: folderSize(p), icon, backups: listBackups(dir, e.name) })
  }
  return out.sort((a, b) => b.lastPlayed - a.lastPlayed)
}

/** Copia de un mundo (con 7-Zip, compresión rápida). Devuelve la copia o null si ha fallado. */
export async function backupWorld(dir: string, world: string, auto: boolean): Promise<McWorldBackup | null> {
  const p = worldPath(dir, world)
  if (!p) return null
  const d = backupsDir(dir, world)
  mkdirSync(d, { recursive: true })
  const at = Date.now()
  const file = join(d, `${at}-${auto ? 'auto' : 'manual'}.zip`)
  const tmp = `${file}.tmp`
  // session.lock lo tiene abierto el juego: se salta (no hace falta para restaurar)
  const ok = await run7z(['a', '-tzip', '-mx=1', '-ssw', '-xr!session.lock', tmp, world], savesDir(dir))
  if (!ok || !existsSync(tmp)) {
    await rm(tmp, { force: true })
    return null
  }
  await rename(tmp, file)
  // Solo las últimas: 5 automáticas y 20 manuales por mundo
  const all = listBackups(dir, world)
  for (const b of [...all.filter((x) => x.auto).slice(MAX_AUTO), ...all.filter((x) => !x.auto).slice(MAX_MANUAL)])
    await rm(join(d, `${b.at}-${b.auto ? 'auto' : 'manual'}.zip`), { force: true })
  return { at, auto, size: statSync(file).size }
}

/** Copias automáticas antes de jugar: de los mundos que han cambiado desde su última copia */
export async function autoBackup(dir: string, onWorld: (world: string) => void): Promise<void> {
  for (const w of await listWorlds(dir)) {
    const last = w.backups[0]?.at ?? 0
    if (w.lastPlayed <= last) continue
    onWorld(w.id)
    await backupWorld(dir, w.id, true)
  }
}

/** Deja el mundo como en una copia; antes guarda otra del estado actual (así se puede deshacer) */
export async function restoreWorld(dir: string, world: string, at: number): Promise<boolean> {
  const d = backupsDir(dir, world)
  const b = listBackups(dir, world).find((x) => x.at === at)
  if (!b) return false
  const file = join(d, `${b.at}-${b.auto ? 'auto' : 'manual'}.zip`)
  const current = worldPath(dir, world)
  if (current) {
    if (!(await backupWorld(dir, world, false))) return false
    // Se aparta el mundo actual hasta que la copia esté extraída: si algo falla, se vuelve a poner
    const aside = `${current}.poxi-old`
    await rm(aside, { recursive: true, force: true })
    await rename(current, aside)
    const ok = await run7z(['x', '-y', `-o${savesDir(dir)}`, file], savesDir(dir))
    if (!ok || !worldPath(dir, world)) {
      await rm(join(savesDir(dir), world), { recursive: true, force: true })
      await rename(aside, current)
      return false
    }
    await rm(aside, { recursive: true, force: true })
    return true
  }
  mkdirSync(savesDir(dir), { recursive: true })
  return (await run7z(['x', '-y', `-o${savesDir(dir)}`, file], savesDir(dir))) && !!worldPath(dir, world)
}

export async function deleteBackup(dir: string, world: string, at: number): Promise<void> {
  const b = listBackups(dir, world).find((x) => x.at === at)
  if (b) await rm(join(backupsDir(dir, world), `${b.at}-${b.auto ? 'auto' : 'manual'}.zip`), { force: true })
}

export const worldBackupsFolder = (dir: string, world: string): string => backupsDir(dir, world)
