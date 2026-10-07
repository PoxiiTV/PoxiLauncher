import { wantToPredicate } from './rules'

// Explicador de crasheos: lee el registro del juego (y el informe de crasheo, si lo hay) y dice en cristiano qué ha
// pasado y cómo arreglarlo. Pura: sin disco ni red, para poder probarla con registros reales.

export type CrashFix =
  | { type: 'install'; modId: string }
  | { type: 'version'; modId: string; want: string }
  | { type: 'disable'; modId: string }
  | { type: 'ram' }
  | { type: 'drivers' }
  | { type: 'log' }

export interface CrashCause {
  /** Clave i18n de la explicación (mc.crash.*) */
  key: string
  params?: Record<string, string>
  fix?: CrashFix
}

const uniq = <T>(list: T[], key: (x: T) => string): T[] => {
  const seen = new Set<string>()
  return list.filter((x) => {
    const k = key(x)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export function explainCrash(log: string, report = ''): CrashCause[] {
  const text = `${log}\n${report}`
  const out: CrashCause[] = []

  // Fabric / Quilt, en inglés o en español (textos de sus Messages.properties: salen en el idioma de Windows).
  // Un mod en sus mensajes: "mod 'Sodium' (sodium)" / "el mod 'Sodium' (sodium)"
  const MOD = String.raw`(?:[Mm]od |[Ee]l mod )?'([^']+)' \(([\w-]+)\)`
  const re = (src: string, flags: string): RegExp => new RegExp(src, flags)
  // Su propuesta de arreglo va primero: es la que mejor sabe qué hacer
  for (const m of text.matchAll(re(String.raw`(?:Replace|Cambia) ${MOD} (\S+)(?: \([^)\n]*\))? (?:with|por) ([^\n]+?)\.?[ \t]*$`, 'gm'))) {
    const want = m[4].replace(/, .*$/, '')
    const pred = wantToPredicate(want)
    out.push({
      key: 'mc.crash.wrongVersion',
      params: { mod: m[1], have: m[3], want },
      fix: pred ? { type: 'version', modId: m[2], want: pred } : { type: 'disable', modId: m[2] }
    })
  }
  for (const m of text.matchAll(re(String.raw`(?:Install|Instala) ${MOD}, ([^\n]+?)\.?[ \t]*$`, 'gm')))
    out.push({ key: 'mc.crash.missingDep', params: { mod: '', dep: m[1] }, fix: { type: 'install', modId: m[2] } })
  for (const m of text.matchAll(re(String.raw`(?:Remove|Quita) ${MOD} \S+`, 'g')))
    out.push({ key: 'mc.crash.incompatible', params: { mod: m[1] }, fix: { type: 'disable', modId: m[2] } })
  // Lo que falta y lo que está en otra versión
  for (const m of text.matchAll(re(String.raw`${MOD} \S+ (?:requires|necesita) ([^\n]+?) (?:of|de) ${MOD}, (?:which is missing|que no tienes)`, 'g')))
    out.push({ key: 'mc.crash.missingDep', params: { mod: m[1], dep: m[4] }, fix: { type: 'install', modId: m[5] } })
  for (const m of text.matchAll(re(String.raw`${MOD} \S+ (?:requires|necesita) ([^\n]+?) (?:of|de) ${MOD}, (?:but only the wrong version|pero sólo tienes)`, 'g'))) {
    const pred = wantToPredicate(m[3])
    out.push({ key: 'mc.crash.needsVersion', params: { mod: m[1], dep: m[4], want: m[3] }, fix: pred ? { type: 'version', modId: m[5], want: pred } : undefined })
  }
  for (const m of text.matchAll(re(String.raw`${MOD} \S+ (?:is incompatible with|no es compatible con) [^\n]+? (?:of|de) ${MOD}`, 'g')))
    out.push({ key: 'mc.crash.breaks', params: { mod: m[1], other: m[3] } })
  // Formato de loaders viejos: "- Install sodium, version 0.6.0 or later."
  for (const m of text.matchAll(/^\s*- Install ([\w-]+), (?:any version|version [^\n]+)\.?$/gm))
    out.push({ key: 'mc.crash.missingDep', params: { mod: '', dep: m[1] }, fix: { type: 'install', modId: m[1] } })

  // Forge / NeoForge: falta una dependencia ("Mod ID: 'geckolib', Requested by: 'mowziesmobs', Expected range: '[4.0,)', Actual version: '[MISSING]'")
  for (const m of text.matchAll(/Mod ID: '([\w-]+)', Requested by: '([\w-]+)', Expected range: '([^']*)', Actual version: '([^']*)'/g)) {
    if (m[4] === '[MISSING]') out.push({ key: 'mc.crash.missingDep', params: { mod: m[2], dep: m[1] }, fix: { type: 'install', modId: m[1] } })
    else out.push({ key: 'mc.crash.wrongVersion', params: { mod: m[1], have: m[4], want: m[3] }, fix: { type: 'disable', modId: m[1] } })
  }
  // NeoForge (nuevo): "Missing or unsupported mandatory dependencies: Mod ID: ..." ya cubierto; "requires X which is missing"
  for (const m of text.matchAll(/Mod (\w[\w-]*) requires (\w[\w-]*) [^\n]*?(?:but no version is installed|which is missing)/g))
    out.push({ key: 'mc.crash.missingDep', params: { mod: m[1], dep: m[2] }, fix: { type: 'install', modId: m[2] } })

  // Mods duplicados
  if (/DuplicateModsFoundException|Found duplicate mods|Duplicate mods found|Mod ID '[\w-]+' from mod files/i.test(text)) {
    const m = /(?:Duplicate mods found|Found duplicate mods|Mod ID) '?([\w-]+)'?/i.exec(text)
    out.push({ key: 'mc.crash.duplicate', params: { mod: m?.[1] ?? '' } })
  }

  // Un mixin de un mod ha fallado: ese mod es el culpable
  for (const m of text.matchAll(/Mixin apply(?: for mod ([\w-]+))? failed ([\w.-]+\.json)?/g)) {
    const mod = m[1] ?? m[2]?.split('.')[0]
    if (mod) out.push({ key: 'mc.crash.mixin', params: { mod }, fix: { type: 'disable', modId: mod } })
  }

  // Mod hecho para otra versión de Java/Minecraft ("class file version 65.0")
  if (/UnsupportedClassVersionError/.test(text)) out.push({ key: 'mc.crash.javaClass' })

  // Sin memoria
  if (/java\.lang\.OutOfMemoryError|Could not reserve enough space for .*object heap/.test(text)) out.push({ key: 'mc.crash.memory', fix: { type: 'ram' } })

  // Gráficos: drivers viejos o sin OpenGL
  if (
    /Pixel format not accelerated|WGL: The driver does not appear to support OpenGL|GLFW error 65542|OpenGL 3\.2 or higher|EXCEPTION_ACCESS_VIOLATION[\s\S]{0,4000}(atio6axx|nvoglv64|ig\d+icd64|igxelpicd64)\.dll/i.test(
      text
    )
  )
    out.push({ key: 'mc.crash.drivers', fix: { type: 'drivers' } })

  // Informe de crasheo con "mods sospechosos" (Fabric y Forge lo apuntan)
  const suspects = /Suspected Mods?:\s*\n?([^\n]+(?:\n\s+[^\n]+)*)/i.exec(report)
  if (suspects && !/Suspected Mods?:\s*(None|Unknown)/i.test(report)) {
    const ids = [...suspects[1].matchAll(/\((\w[\w-]*)\)/g)].map((x) => x[1]).filter((x) => !['minecraft', 'java', 'fabricloader', 'forge', 'neoforge'].includes(x))
    for (const id of ids.slice(0, 3)) out.push({ key: 'mc.crash.suspect', params: { mod: id }, fix: { type: 'disable', modId: id } })
  }

  if (!out.length) {
    const desc = /^Description: (.+)$/m.exec(report)
    out.push(desc ? { key: 'mc.crash.described', params: { what: desc[1].trim() }, fix: { type: 'log' } } : { key: 'mc.crash.unknown', fix: { type: 'log' } })
  }
  // Una dependencia que falta sale una vez aunque el registro la nombre de dos formas (se queda la que dice quién la pide)
  return uniq(out, (c) =>
    c.key === 'mc.crash.missingDep'
      ? `dep|${c.params?.dep}`
      : c.fix?.type === 'version'
        ? `version|${c.fix.modId}`
        : `${c.key}|${c.params?.mod ?? ''}|${c.params?.other ?? ''}`
  )
}
