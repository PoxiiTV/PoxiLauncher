// Minecraft: reglas puras (nombres, UUID sin conexión, RAM por defecto, errores de Xbox)
import { describe, it, expect } from 'vitest'
import { changeOps, defaultRamMB, diffEmpty, gameLanguage, instanceId, isSkinPng, isValidPlayerName, modVersionFrom, satisfies, wantToPredicate, offlineUuid, packDiff, shareable, withGameLanguage, xstsErrorKey, lanPort } from '../src/main/minecraft/rules'
import { explainCrash } from '../src/main/minecraft/crash'

describe('minecraft', () => {
  it('UUID sin conexión: el mismo que calcula el servidor en modo offline', () => {
    // Valor conocido de "OfflinePlayer:Notch" (UUID v3)
    expect(offlineUuid('Notch')).toBe('b50ad385-829d-3141-a216-7e7d7539ba7f')
    expect(offlineUuid('Poxi')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    // Distingue mayúsculas, como el servidor
    expect(offlineUuid('poxi')).not.toBe(offlineUuid('Poxi'))
  })

  it('nombres de jugador válidos', () => {
    expect(isValidPlayerName('Poxi_10')).toBe(true)
    expect(isValidPlayerName('ab')).toBe(false)
    expect(isValidPlayerName('a'.repeat(17))).toBe(false)
    expect(isValidPlayerName('con espacio')).toBe(false)
    expect(isValidPlayerName('ñandú')).toBe(false)
  })

  it('RAM por defecto: la mitad del PC, entre 2 y 6 GB', () => {
    expect(defaultRamMB(4)).toBe(2048)
    expect(defaultRamMB(8)).toBe(4096)
    expect(defaultRamMB(11.9)).toBe(5632)
    expect(defaultRamMB(32)).toBe(6144)
  })

  it('errores de Xbox con su explicación', () => {
    expect(xstsErrorKey(2148916233)).toBe('mc.auth.noXbox')
    expect(xstsErrorKey(2148916238)).toBe('mc.auth.child')
    expect(xstsErrorKey(1)).toBe('mc.auth.failed')
  })

  it('ids de instancia: 8 caracteres hexadecimales (lo que acepta el IPC)', () => {
    expect(instanceId()).toMatch(/^[a-f0-9]{8}$/)
  })
})

describe('explicador de crasheos', () => {
  it('Fabric: dependencia que falta', () => {
    const log = `[main/ERROR]: Incompatible mods found!
net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!
A potential solution has been determined, this may resolve your problem:
	 - Install sodium, version 0.6.0 or later.
More details:
	 - Mod 'Iris' (iris) 1.8.8+1.21.1-fabric requires version 0.6.0 or later of mod 'sodium', which is missing!`
    const r = explainCrash(log)
    expect(r[0]).toMatchObject({ key: 'mc.crash.missingDep', fix: { type: 'install', modId: 'sodium' } })
    expect(r.filter((c) => c.key === 'mc.crash.missingDep')).toHaveLength(1)
  })

  it('Fabric: versión incompatible', () => {
    const r = explainCrash(`A potential solution has been determined:
	 - Replace 'Sodium' (sodium) 0.5.3 with version 0.6.0 or later.`)
    expect(r[0]).toMatchObject({ key: 'mc.crash.wrongVersion', params: { mod: 'Sodium', have: '0.5.3' } })
  })

  it('Forge y NeoForge: dependencia que falta', () => {
    const r = explainCrash(`Missing or unsupported mandatory dependencies:
	Mod ID: 'geckolib', Requested by: 'mowziesmobs', Expected range: '[4.4.9,)', Actual version: '[MISSING]'`)
    expect(r[0]).toMatchObject({ key: 'mc.crash.missingDep', params: { mod: 'mowziesmobs', dep: 'geckolib' }, fix: { type: 'install', modId: 'geckolib' } })
  })

  it('sin memoria, drivers y mixin', () => {
    expect(explainCrash('java.lang.OutOfMemoryError: Java heap space')[0].fix).toEqual({ type: 'ram' })
    expect(explainCrash('GLFW error 65542: WGL: The driver does not appear to support OpenGL')[0].key).toBe('mc.crash.drivers')
    expect(explainCrash('Mixin apply for mod sodium failed sodium.mixins.json:features.render')[0]).toMatchObject({ key: 'mc.crash.mixin', params: { mod: 'sodium' } })
  })

  it('informe con mods sospechosos y, si no se sabe, la descripción', () => {
    const report = `Description: Rendering overlay

java.lang.NullPointerException
Suspected Mods:
	Iris (iris)
		Issue tracker URL: https://github.com/IrisShaders/Iris/issues`
    expect(explainCrash('', report)[0]).toMatchObject({ key: 'mc.crash.suspect', params: { mod: 'iris' } })
    expect(explainCrash('', 'Description: Ticking entity\n\njava.lang.NullPointerException')[0]).toMatchObject({ key: 'mc.crash.described', params: { what: 'Ticking entity' } })
    expect(explainCrash('algo raro')[0].key).toBe('mc.crash.unknown')
  })
})

describe('packs compartidos', () => {
  const it1 = (projectId: string, versionId: string, version = versionId) => ({ kind: 'mod' as const, projectId, versionId, title: projectId, file: `${projectId}.jar`, version })
  const manual = { kind: 'mod' as const, title: 'a mano', file: 'x.jar' }

  it('qué cambia al ponerse al día (lo puesto a mano no cuenta)', () => {
    const remote = [it1('sodium00', 'v2'), it1('iris0000', 'i1'), it1('lithium0', 'l1')]
    const local = [it1('sodium00', 'v1', '0.5'), it1('iris0000', 'i1'), it1('modmenu0', 'm1'), manual]
    const d = packDiff(shareable(remote), local)
    expect(d.add.map((x) => x.projectId)).toEqual(['lithium0'])
    expect(d.change).toEqual([{ ...shareable([it1('sodium00', 'v2')])[0], from: '0.5' }])
    expect(d.remove.map((x) => x.projectId)).toEqual(['modmenu0'])
    expect(diffEmpty(packDiff(shareable(local), local))).toBe(true)
  })

  it('operaciones que se suben tras un cambio', () => {
    const before = [it1('sodium00', 'v1'), it1('iris0000', 'i1'), manual]
    const after = [it1('sodium00', 'v2'), it1('lithium0', 'l1'), manual]
    const ops = changeOps(before, after)
    expect(ops).toEqual([
      { op: 'set', item: shareable([it1('sodium00', 'v2')])[0] },
      { op: 'set', item: shareable([it1('lithium0', 'l1')])[0] },
      { op: 'remove', projectId: 'iris0000' }
    ])
    // Activar o desactivar no cambia el pack
    expect(changeOps(before, before)).toEqual([])
  })
})

describe('skins', () => {
  // Cabecera de PNG con IHDR de ancho × alto (lo que mira la validación)
  const png = (w: number, h: number): Buffer => {
    const b = Buffer.alloc(40)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b)
    b.writeUInt32BE(13, 8)
    b.write('IHDR', 12, 'ascii')
    b.writeUInt32BE(w, 16)
    b.writeUInt32BE(h, 20)
    return b
  }
  it('solo PNG de 64×64 o 64×32', () => {
    expect(isSkinPng(png(64, 64))).toBe(true)
    expect(isSkinPng(png(64, 32))).toBe(true)
    expect(isSkinPng(png(128, 128))).toBe(false)
    expect(isSkinPng(Buffer.from('<svg onload=alert(1)>'))).toBe(false)
    expect(isSkinPng(Buffer.concat([png(64, 64), Buffer.alloc(70 * 1024)]))).toBe(false)
  })
})

describe('versiones de mods (reglas de Fabric)', () => {
  it('condiciones de Fabric', () => {
    expect(satisfies('0.6.13+mc1.21.1', '0.6.x')).toBe(true)
    expect(satisfies('0.8.13+mc1.21.1', '0.6.x')).toBe(false)
    expect(satisfies('0.6.0', '>=0.6.0-')).toBe(true)
    expect(satisfies('1.8.8', '<1.8.13')).toBe(true)
    expect(satisfies('1.2.9', '~1.2')).toBe(true)
    expect(satisfies('1.3.0', '~1.2')).toBe(false)
    expect(satisfies('1.9.0', '^1.2')).toBe(true)
    expect(satisfies('2.0.0', ['0.6.x', '>=2'])).toBe(true)
    expect(satisfies('5.1', '*')).toBe(true)
    expect(satisfies('0.5.0', '>=0.5 <0.6')).toBe(true)
  })

  it('versión del mod dentro del número de Modrinth', () => {
    expect(modVersionFrom('mc1.21.1-0.6.13-fabric', '1.21.1')).toBe('0.6.13')
    expect(modVersionFrom('1.8.8+1.21.1-fabric', '1.21.1')).toBe('1.8.8')
    expect(modVersionFrom('0.116.17+1.21.1', '1.21.1')).toBe('0.116.17')
  })

  it('lo que propone Fabric, como condición', () => {
    expect(wantToPredicate('any 0.6.x version')).toBe('0.6.x')
    expect(wantToPredicate('version 0.6.0 or later.')).toBe('>=0.6.0')
    expect(wantToPredicate('any version before 1.8.13')).toBe('<1.8.13')
    expect(wantToPredicate('any version between 1.0 (inclusive) and 2.0 (exclusive)')).toBe('>=1.0 <2.0')
    expect(wantToPredicate('algo raro')).toBeNull()
  })
})

describe('explicador con los mensajes de Fabric 0.19', () => {
  it('Iris con la Sodium equivocada: propone la versión que pide', () => {
    const log = `[main/ERROR]: Incompatible mods found!
net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!
A potential solution has been determined, this may resolve your problem:
	 - Replace mod 'Sodium' (sodium) 0.8.13+mc1.21.1 with any 0.6.x version.
More details:
	 - Mod 'Iris' (iris) 1.8.8+mc1.21.1 requires any 0.6.x version of mod 'Sodium' (sodium), but only the wrong version is present: 0.8.13+mc1.21.1!
	 - Mod 'Sodium' (sodium) 0.8.13+mc1.21.1 is incompatible with any version before 1.8.13 of mod 'Iris' (iris), yet a conflicting version is present: 1.8.8+mc1.21.1!`
    const r = explainCrash(log)
    expect(r[0]).toMatchObject({ key: 'mc.crash.wrongVersion', params: { mod: 'Sodium', want: 'any 0.6.x version' }, fix: { type: 'version', modId: 'sodium', want: '0.6.x' } })
    // La misma propuesta no se repite con el detalle de "requires"
    expect(r.filter((c) => c.fix?.type === 'version')).toHaveLength(1)
    expect(r.some((c) => c.key === 'mc.crash.breaks')).toBe(true)
  })

  it('dependencia que falta en el formato nuevo', () => {
    const r = explainCrash(`A potential solution has been determined, this may resolve your problem:
	 - Install mod 'Fabric API' (fabric-api), any version.
More details:
	 - Mod 'Mod Menu' (modmenu) 11.0.5 requires any version of mod 'Fabric API' (fabric-api), which is missing!`)
    expect(r[0]).toMatchObject({ key: 'mc.crash.missingDep', fix: { type: 'install', modId: 'fabric-api' } })
    expect(r.filter((c) => c.key === 'mc.crash.missingDep')).toHaveLength(1)
  })
})

describe('explicador con Fabric en español', () => {
  it('Iris con la Sodium equivocada (tal cual sale en Windows en español)', () => {
    const log = `Hemos encontrado una solución prometedora:
	 - Cambia el mod 'Sodium' (sodium) 0.8.13+mc1.21.1 por cualquier versión 0.6.x.
Dependencias no satisfechas:
	 - ¡El mod 'Iris' (iris) 1.8.8+mc1.21.1 necesita cualquier versión 0.6.x de el mod 'Sodium' (sodium), pero sólo tienes una versión incorrecta: 0.8.13+mc1.21.1!
	 - ¡El mod 'Sodium' (sodium) 0.8.13+mc1.21.1 no es compatible con cualquier versión anterior a 1.8.13 de el mod 'Iris' (iris), pero tienes una versión coincidente presente : 1.8.8+mc1.21.1!`
    const r = explainCrash(log)
    expect(r[0]).toMatchObject({ key: 'mc.crash.wrongVersion', params: { mod: 'Sodium' }, fix: { type: 'version', modId: 'sodium', want: '0.6.x' } })
    expect(r.some((c) => c.key === 'mc.crash.breaks' && c.params?.other === 'Iris')).toBe(true)
  })

  it('dependencia que falta, en español', () => {
    const r = explainCrash(`Hemos encontrado una solución prometedora:
	 - Instala el mod 'Fabric API' (fabric-api), cualquier versión.
	 - ¡El mod 'Mod Menu' (modmenu) 11.0.5 necesita cualquier versión de el mod 'Fabric API' (fabric-api), que no tienes!`)
    expect(r[0]).toMatchObject({ key: 'mc.crash.missingDep', fix: { type: 'install', modId: 'fabric-api' } })
    expect(wantToPredicate('la versión 0.6.0 o posterior')).toBe('>=0.6.0')
    expect(wantToPredicate('cualquier versión anterior a 1.8.13')).toBe('<1.8.13')
  })
})

describe('idioma del juego', () => {
  it('es_es desde la 1.11; antes, es_ES', () => {
    expect(gameLanguage('1.21.1', 'es')).toBe('es_es')
    expect(gameLanguage('26.3', 'es')).toBe('es_es')
    expect(gameLanguage('1.8.9', 'es')).toBe('es_ES')
    expect(gameLanguage('1.12.2', 'en')).toBe('en_us')
    expect(gameLanguage('1.7.10', 'en')).toBe('en_US')
    expect(withGameLanguage('', 'es_es')).toBe('lang:es_es\n')
    // Mundo abierto a LAN, en el formato de cada versión
    expect(lanPort('[12:00:01] [Server thread/INFO]: Started serving on 51234')).toBe(51234)
    expect(lanPort('[12:00:01] [Server thread/INFO]: Started on 25565')).toBe(25565)
    expect(lanPort('[13:19:48] [Render thread/INFO]: Published LAN server on port 59483')).toBe(59483)
    expect(lanPort('[13:25:17] [Render thread/INFO]: Connecting to 127.0.0.1, 64314')).toBeNull()
    expect(withGameLanguage('version:3955\r\nlang:en_us\r\nfov:0.5\r\n', 'es_es')).toBe('version:3955\nfov:0.5\nlang:es_es\n')
  })
})
