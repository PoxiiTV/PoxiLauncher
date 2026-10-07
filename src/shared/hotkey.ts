// Atajos de teclado globales (el menú dentro del juego, las capturas): de la tecla que pulsas al formato de
// Electron ("Shift+F1") y de vuelta a algo legible ("Mayús + F1"). Pura y con tests.

export const OVERLAY_HOTKEY = 'Shift+F1'

/** Lo que se sabe de una pulsación (como un KeyboardEvent) */
export interface KeyPress {
  key: string
  code: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey?: boolean
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS'])

/** La tecla principal en el nombre de Electron (por su posición física, así da igual la distribución del teclado) */
function keyName(p: KeyPress): string | null {
  const c = p.code
  if (/^Key[A-Z]$/.test(c)) return c.slice(3)
  if (/^Digit[0-9]$/.test(c)) return c.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(c)) return c
  if (/^Numpad[0-9]$/.test(c)) return `num${c.slice(6)}`
  const named: Record<string, string> = {
    Space: 'Space',
    Tab: 'Tab',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Insert: 'Insert',
    Delete: 'Delete',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Escape: 'Escape',
    Pause: 'Pause',
    ScrollLock: 'Scrolllock',
    NumpadAdd: 'numadd',
    NumpadSubtract: 'numsub',
    NumpadMultiply: 'nummult',
    NumpadDivide: 'numdiv',
    NumpadDecimal: 'numdec'
  }
  return named[c] ?? null
}

/**
 * Una pulsación como atajo de Electron, o null si todavía no vale: solo modificadores (se sigue esperando), o una tecla
 * suelta sin Ctrl/Alt/Mayús (en pleno juego se pulsaría sin querer). Las F1-F24 solas sí valen.
 */
export function toAccelerator(p: KeyPress): string | null {
  if (MODIFIER_KEYS.has(p.key)) return null
  const key = keyName(p)
  if (!key) return null
  const mods = [p.ctrlKey && 'CommandOrControl', p.altKey && 'Alt', p.shiftKey && 'Shift'].filter(Boolean) as string[]
  if (!mods.length && !/^F\d+$/.test(key)) return null
  return [...mods, key].join('+')
}

/** ¿Un atajo con buena pinta? (para validar lo que llega de fuera) */
export const isAccelerator = (s: string): boolean =>
  /^((CommandOrControl|Alt|Shift)\+){0,3}([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|num[0-9]|numadd|numsub|nummult|numdiv|numdec|Space|Tab|Home|End|PageUp|PageDown|Insert|Delete|Up|Down|Left|Right|Escape|Pause|Scrolllock|[`\-=[\]\\;',./])$/.test(s)

/** Para enseñarlo: «Ctrl + Mayús + F» (o en inglés «Ctrl + Shift + F») */
export function hotkeyLabel(acc: string, lang: 'es' | 'en' = 'es'): string {
  const names: Record<string, string> = {
    CommandOrControl: 'Ctrl',
    Shift: lang === 'es' ? 'Mayús' : 'Shift',
    Alt: 'Alt',
    Space: lang === 'es' ? 'Espacio' : 'Space',
    Home: lang === 'es' ? 'Inicio' : 'Home',
    End: lang === 'es' ? 'Fin' : 'End',
    PageUp: lang === 'es' ? 'RePág' : 'PgUp',
    PageDown: lang === 'es' ? 'AvPág' : 'PgDn',
    Insert: lang === 'es' ? 'Insert' : 'Insert',
    Delete: lang === 'es' ? 'Supr' : 'Del',
    Escape: 'Esc',
    Up: '↑',
    Down: '↓',
    Left: '←',
    Right: '→'
  }
  return acc
    .split('+')
    .filter(Boolean)
    .map((k) => names[k] ?? (k.startsWith('num') ? `Num ${k.slice(3)}` : k))
    .join(' + ')
}
