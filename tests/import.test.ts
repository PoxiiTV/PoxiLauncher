// Traer instancias de otros launchers: cómo se lee cada formato y que copiar nunca toca el original
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'
import type { McContent } from '../src/shared/types'
import { cfgValue, copyInstance, detect, incompatibleMods, neoforgeMc, parseCurseLoader, parseLauncherDate, parseMmcPack, parseModrinth, parseVersionId } from '../src/main/minecraft/importers'

const FIX = resolve('tests/fixtures/import')
const tmp = mkdtempSync(join(tmpdir(), 'poxi-import-test-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('versiones de cada launcher', () => {
  it('launcher oficial: lastVersionId', () => {
    expect(parseVersionId('1.21.1')).toEqual({ mc: '1.21.1', loader: 'vanilla' })
    expect(parseVersionId('fabric-loader-0.16.5-1.21.1')).toEqual({ mc: '1.21.1', loader: 'fabric', loaderVersion: '0.16.5' })
    expect(parseVersionId('fabric-loader-0.17.2-1.21.11-pre1')).toEqual({ mc: '1.21.11-pre1', loader: 'fabric', loaderVersion: '0.17.2' })
    expect(parseVersionId('quilt-loader-0.26.0-1.21.1')).toEqual({ mc: '1.21.1', loader: 'quilt', loaderVersion: '0.26.0' })
    // Con el JSON de la versión, aunque el loader lleve guiones
    expect(parseVersionId('quilt-loader-0.20.0-beta.9-1.20.1', '1.20.1')).toEqual({ mc: '1.20.1', loader: 'quilt', loaderVersion: '0.20.0-beta.9' })
    expect(parseVersionId('1.20.1-forge-47.2.0')).toEqual({ mc: '1.20.1', loader: 'forge', loaderVersion: '47.2.0' })
    expect(parseVersionId('1.12.2-forge1.12.2-14.23.5.2859')).toEqual({ mc: '1.12.2', loader: 'forge', loaderVersion: '14.23.5.2859' })
    expect(parseVersionId('neoforge-21.1.72')).toEqual({ mc: '1.21.1', loader: 'neoforge', loaderVersion: '21.1.72' })
    expect(parseVersionId('neoforge-21.1.72', '1.21.1')).toEqual({ mc: '1.21.1', loader: 'neoforge', loaderVersion: '21.1.72' })
    // Lo que no sabemos instalar
    expect(parseVersionId('1.20.1-OptiFine_HD_U_I6', '1.20.1')).toBeNull()
    expect(parseVersionId('1.20.1-OptiFine_HD_U_I6')).toBeNull()
    expect(parseVersionId('LabyMod-4', '1.21')).toBeNull()
    expect(parseVersionId('../../x')).toBeNull()
  })

  it('NeoForge: su versión de Minecraft', () => {
    expect(neoforgeMc('21.1.72')).toBe('1.21.1')
    expect(neoforgeMc('21.0.5-beta')).toBe('1.21')
    expect(neoforgeMc('20.4.237')).toBe('1.20.4')
    expect(neoforgeMc('26.1.0.3-beta')).toBe('26.1')
    expect(neoforgeMc('26.1.1.2')).toBe('26.1.1')
    expect(neoforgeMc('raro')).toBeNull()
  })

  it('CurseForge: baseModLoader', () => {
    expect(parseCurseLoader('forge-47.2.0', '1.20.1')).toEqual({ mc: '1.20.1', loader: 'forge', loaderVersion: '47.2.0' })
    expect(parseCurseLoader('fabric-0.15.11-1.20.1', '1.20.1')).toEqual({ mc: '1.20.1', loader: 'fabric', loaderVersion: '0.15.11' })
    expect(parseCurseLoader('neoforge-21.1.244', '1.21.1')).toEqual({ mc: '1.21.1', loader: 'neoforge', loaderVersion: '21.1.244' })
    expect(parseCurseLoader('quilt-0.26.0-1.20.4', '1.20.4')).toEqual({ mc: '1.20.4', loader: 'quilt', loaderVersion: '0.26.0' })
    expect(parseCurseLoader(null, '1.21.4')).toEqual({ mc: '1.21.4', loader: 'vanilla' })
    expect(parseCurseLoader('liteloader-1.12.2', '1.12.2')).toBeNull()
    expect(parseCurseLoader('forge-47.2.0', '1.20.1; rm -rf')).toBeNull()
  })

  it('Prism / MultiMC: mmc-pack.json e instance.cfg', () => {
    const pack = (c: unknown[]): unknown => ({ components: c, formatVersion: 1 })
    expect(parseMmcPack(pack([{ uid: 'net.minecraft', version: '1.21.1' }]))).toEqual({ mc: '1.21.1', loader: 'vanilla' })
    expect(parseMmcPack(pack([{ uid: 'net.minecraft', version: '1.20.1' }, { uid: 'net.minecraftforge', version: '47.2.0' }]))).toEqual({ mc: '1.20.1', loader: 'forge', loaderVersion: '47.2.0' })
    expect(parseMmcPack(pack([{ uid: 'net.minecraft', version: '1.21.1' }, { uid: 'net.neoforged', version: '21.1.72' }]))).toEqual({ mc: '1.21.1', loader: 'neoforge', loaderVersion: '21.1.72' })
    expect(parseMmcPack(pack([{ uid: 'net.minecraft', cachedVersion: '1.20.4' }, { uid: 'org.quiltmc.quilt-loader', version: '0.26.0' }]))).toEqual({ mc: '1.20.4', loader: 'quilt', loaderVersion: '0.26.0' })
    expect(parseMmcPack(pack([{ uid: 'net.fabricmc.fabric-loader', version: '0.15.11' }]))).toBeNull()
    expect(parseMmcPack({ nada: true })).toBeNull()
    expect(cfgValue('[General]\nname=Mi instancia\n', 'name')).toBe('Mi instancia')
    expect(cfgValue('name="Con, coma \\"y\\" \\x00e9"\r\n', 'name')).toBe('Con, coma "y" é')
    expect(cfgValue('InstanceType=OneSix', 'name')).toBeUndefined()
  })

  it('Modrinth App: lo de cada perfil', () => {
    expect(parseModrinth('1.21.1', 'fabric', '0.16.5')).toEqual({ mc: '1.21.1', loader: 'fabric', loaderVersion: '0.16.5' })
    expect(parseModrinth('1.20.1', 'forge', '1.20.1-47.2.0')).toEqual({ mc: '1.20.1', loader: 'forge', loaderVersion: '47.2.0' })
    expect(parseModrinth('1.21.4', 'vanilla', null)).toEqual({ mc: '1.21.4', loader: 'vanilla' })
    expect(parseModrinth('1.21.1', 'fabric', null)).toBeNull()
    expect(parseModrinth(5, 'fabric', '1')).toBeNull()
  })
})

describe('fechas y mods de otra versión', () => {
  it('fechas de launcher_profiles.json, con y sin los dos puntos en la zona', () => {
    expect(parseLauncherDate('2025-10-30T13:29:00+0100')).toBe(Date.parse('2025-10-30T12:29:00Z'))
    expect(parseLauncherDate('2025-10-30T13:29:00+01:00')).toBe(Date.parse('2025-10-30T12:29:00Z'))
    expect(parseLauncherDate('2025-10-24T07:31:25.655Z')).toBe(Date.parse('2025-10-24T07:31:25.655Z'))
    expect(parseLauncherDate('1970-01-01T00:00:00.000Z')).toBe(0)
    expect(parseLauncherDate(undefined)).toBe(0)
    expect(parseLauncherDate('basura')).toBe(0)
  })

  it('mods que no son para la versión o el loader de la instancia', () => {
    const mod = (file: string, versionId?: string, kind: McContent['kind'] = 'mod', enabled = true): McContent => ({ kind, file, enabled, sha1: file, size: 1, title: file, versionId })
    const versions = new Map([
      ['v121', { game_versions: ['1.21', '1.21.1'], loaders: ['fabric'] }],
      ['v1210', { game_versions: ['1.21.10'], loaders: ['fabric', 'quilt'] }],
      ['vforge', { game_versions: ['1.21.10'], loaders: ['neoforge'] }],
      ['vpack', { game_versions: ['1.20.1'], loaders: ['minecraft'] }]
    ])
    const items = [mod('a.jar', 'v121'), mod('b.jar', 'v1210'), mod('c.jar', 'vforge'), mod('d.jar'), mod('e.jar', 'v121', 'mod', false), mod('p.zip', 'vpack', 'resourcepack')]
    // Fabric 1.21.10: fuera el de 1.21.1 y el de NeoForge; los no reconocidos, los ya desactivados y los packs, igual
    expect(incompatibleMods(items, versions, '1.21.10', ['fabric']).map((c) => c.file)).toEqual(['a.jar', 'c.jar'])
    // Quilt también carga mods de Fabric
    expect(incompatibleMods(items, versions, '1.21.10', ['quilt', 'fabric']).map((c) => c.file)).toEqual(['a.jar', 'c.jar'])
    expect(incompatibleMods(items, versions, '1.21.1', ['fabric']).map((c) => c.file)).toEqual(['b.jar', 'c.jar'])
  })
})

describe('encontrar instancias', async () => {
  // Modrinth App de ahora: copia del fixture con su app.db (SQLite)
  const mr = join(tmp, 'modrinth')
  cpSync(join(FIX, 'modrinth'), mr, { recursive: true })
  cpSync(join(FIX, 'modrinth', 'profiles', 'Quilt viejo'), join(mr, 'profiles', 'Nuevo'), { recursive: true })
  rmSync(join(mr, 'profiles', 'Nuevo', 'profile.json'))
  const db = new DatabaseSync(join(mr, 'app.db'))
  db.exec('CREATE TABLE profiles (path TEXT PRIMARY KEY, name TEXT, game_version TEXT, mod_loader TEXT, mod_loader_version TEXT)')
  db.prepare('INSERT INTO profiles VALUES (?, ?, ?, ?, ?)').run('Nuevo', 'Del app.db', '1.21.1', 'fabric', '0.16.9')
  db.close()

  const found = await detect({ official: join(FIX, 'official'), curseforge: join(FIX, 'curseforge'), prism: join(FIX, 'prism'), modrinth: mr })
  const by = (name: string): (typeof found)[number] | undefined => found.find((f) => f.name === name)

  it('launcher oficial: perfiles usados (o con mundos), con su versión', () => {
    const off = found.filter((f) => f.launcher === 'official')
    // La snapshot sin usar no sale; las demás sí (la rara, sin poder importarse)
    expect(off).toHaveLength(7)
    expect(by('Mis mods')).toMatchObject({ version: '1.21.1', loader: 'fabric', loaderVersion: '0.16.5', mods: 2, worlds: 1 })
    expect(off.find((f) => !f.name)).toMatchObject({ version: '1.21.8', loader: 'vanilla', mods: 0 })
    expect(by('Forge viejo')).toMatchObject({ version: '1.20.1', loader: 'forge', loaderVersion: '47.2.0' })
    expect(by('OptiFine')?.unsupported).toBe('mc.import.why.version')
    // Ruta de fuera (gameDir relativo, versión con ..): ni se sigue ni se puede importar
    expect(by('Rara')).toMatchObject({ dir: join(FIX, 'official'), unsupported: 'mc.import.why.version' })
  })

  it('launcher oficial: perfiles que comparten .minecraft', () => {
    // Con loader, el último jugado (la fecha sin los dos puntos en la zona también vale) sale marcado; los demás no
    const fab10 = found.find((f) => f.loaderVersion === '0.17.3')!
    expect(fab10).toMatchObject({ version: '1.21.10', loader: 'fabric' })
    expect(fab10.shares).toBeUndefined()
    expect(by('Mis mods')?.shares).toEqual({ key: fab10.key, mods: true })
    expect(by('Forge viejo')?.shares).toEqual({ key: fab10.key, mods: true })
    // Vanilla: solo comparte mundos, con el último vanilla jugado
    const latest = found.find((f) => f.launcher === 'official' && f.version === '1.21.8')!
    expect(latest.shares).toBeUndefined()
    expect(by('Vanilla vieja')?.shares).toEqual({ key: latest.key, mods: false })
    // Las que no se pueden traer no cuentan
    expect(by('OptiFine')?.shares).toBeUndefined()
  })

  it('CurseForge, Prism y Modrinth App', () => {
    expect(by('Pack NeoForge')).toMatchObject({ launcher: 'curseforge', version: '1.21.1', loader: 'neoforge', loaderVersion: '21.1.244', mods: 1 })
    expect(by('Solo vanilla')).toMatchObject({ launcher: 'curseforge', loader: 'vanilla', mods: 0 })
    expect(found.some((f) => f.dir.endsWith('Roto'))).toBe(false)
    expect(by('Fabric, de Prism é')).toMatchObject({ launcher: 'prism', version: '1.20.1', loader: 'fabric', loaderVersion: '0.15.11', mods: 1, worlds: 1 })
    expect(found.some((f) => f.name === 'temporal')).toBe(false)
    expect(by('Del app.db')).toMatchObject({ launcher: 'modrinth', version: '1.21.1', loader: 'fabric', loaderVersion: '0.16.9' })
    expect(by('Quilt viejo')).toMatchObject({ launcher: 'modrinth', version: '1.20.4', loader: 'quilt', loaderVersion: '0.26.0' })
    expect(by('Sin datos')?.unsupported).toBe('mc.import.why.meta')
    // Cada una con su clave (el oficial: carpeta + perfil)
    expect(new Set(found.map((f) => f.key)).size).toBe(found.length)
  })

  it('un launcher que no está no cuenta', async () => {
    expect(await detect({ prism: join(tmp, 'no-existe') })).toEqual([])
  })

  it('copiar: lo de la instancia y los mundos, sin tocar el original', async () => {
    const snapshot = (dir: string): string[] =>
      readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => {
          const p = join(e.parentPath, e.name)
          return `${p}|${statSync(p).size}|${statSync(p).mtimeMs}`
        })
        .sort()
    const before = snapshot(FIX)
    const pack = by('Pack NeoForge')!
    const dest = join(tmp, 'inst1')
    let bytes = 0
    await copyInstance(pack, dest, true, (n) => (bytes += n))
    expect(readFileSync(join(dest, 'mods', 'a.jar'), 'utf8')).toBe('a')
    expect(existsSync(join(dest, 'config', 'a.toml'))).toBe(true)
    expect(existsSync(join(dest, 'kubejs', 'startup.js'))).toBe(true)
    // El JSON de CurseForge no es de la instancia
    expect(existsSync(join(dest, 'minecraftinstance.json'))).toBe(false)
    expect(bytes).toBe(pack.size)

    // Vanilla: sin mods; mundos solo si se piden
    const dest2 = join(tmp, 'inst2')
    await copyInstance(by('Solo vanilla')!, dest2, false, () => undefined)
    expect(existsSync(join(dest2, 'mods'))).toBe(false)
    expect(existsSync(join(dest2, 'resourcepacks', 'Mi pack', 'pack.mcmeta'))).toBe(true)
    const dest3 = join(tmp, 'inst3')
    await copyInstance(by('Mis mods')!, dest3, false, () => undefined)
    expect(existsSync(join(dest3, 'saves'))).toBe(false)
    expect(existsSync(join(dest3, 'mods', 'viejo.jar.disabled'))).toBe(true)
    await copyInstance(by('Fabric, de Prism é')!, join(tmp, 'inst4'), true, () => undefined)
    expect(existsSync(join(tmp, 'inst4', 'saves', 'Isla', 'level.dat'))).toBe(true)

    expect(snapshot(FIX)).toEqual(before)
  })
})
