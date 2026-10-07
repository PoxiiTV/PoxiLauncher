// Chat entre amigos: tipos, formato de los mensajes (estilo Discord), agrupado y stickers incluidos. Pura y con tests.

export type Sticker = { kind: 'pack'; code: string } | { kind: 'klipy'; url: string } | { kind: 'user'; owner: string; id: string }

export interface ChatGif {
  url: string
  w: number
  h: number
}

/** Invitación a tu partida: un juego del catálogo o tu Minecraft (mundo abierto o servidor). Unirse usa el estado en
 * directo de quien invita, igual que el botón de su perfil */
export type ChatInvite = { kind: 'mc'; name: string; version: string; loader: 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge'; where?: string }

/** Una captura o un clip compartido (el archivo está en el servidor, con el chat: poxi-img://media/<chat>/<id>) */
export interface ChatMedia {
  kind: 'image' | 'video'
  id: string
  w: number
  h: number
  seconds?: number
  /** De qué instancia es */
  game?: string
}

export interface ChatMessage {
  id: number
  from: string
  at: number
  text?: string
  /** A qué mensaje responde */
  reply?: number
  gif?: ChatGif
  sticker?: Sticker
  invite?: ChatInvite
  media?: ChatMedia
  edited?: number
  deleted?: boolean
  /** emoji → quién */
  reactions?: Record<string, string[]>
}

export interface ChatPreview {
  id: number
  from: string
  at: number
  deleted?: boolean
  text?: string
  kind?: 'text' | 'gif' | 'sticker' | 'invite' | 'image' | 'video'
}

export interface ChatInfo {
  id: string
  kind: 'dm' | 'group'
  name: string | null
  icon: string | null
  owner: string | null
  members: string[]
  lastAt: number
  last: ChatPreview | null
  unread: number
  pins: number[]
}

export type ChatSend = Pick<ChatMessage, 'text' | 'reply' | 'gif' | 'sticker' | 'invite' | 'media'>
export const mediaUrl = (chat: string, id: string): string => `poxi-img://media/${chat}/${id}`

// ——— Formato (como Discord: **negrita**, *cursiva*, __subrayado__, ~~tachado~~, `código`, ```bloque```, ||spoiler||,
// > cita). Sin HTML: la interfaz pinta cada trozo con su etiqueta ———
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'bold' | 'italic' | 'under' | 'strike' | 'spoiler'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'mention'; v: string }
  | { t: 'emote'; name: string; id: string }
export type Block = { t: 'p'; c: Inline[] } | { t: 'quote'; c: Inline[] } | { t: 'code'; v: string }

// ——— Emotes de 7TV y BetterTTV dentro del texto: <e:NOMBRE:ID>. Solo viaja el id; la imagen sale de su CDN ———
const EMOTE_SRC = String.raw`<e:([\w\-!?.']{1,40}):([0-9A-Z]{26}|[0-9a-f]{24})>`
const EMOTE_ALL = new RegExp(EMOTE_SRC, 'g')
/** 7TV usa ids ULID (26, mayúsculas); BetterTTV, hexadecimales de 24 */
export const emoteUrl = (id: string, size: 1 | 2 | 3 | 4 = 2): string =>
  id.length === 26 ? `https://cdn.7tv.app/emote/${id}/${size}x.webp` : `https://cdn.betterttv.net/emote/${id}/${Math.min(size, 3)}x.webp`
export const emoteToken = (name: string, id: string): string => `<e:${name}:${id}>`
/** Un emote solo (p. ej. el icono de un grupo): su id y nombre, o null si es un emoji normal */
export function asEmote(text: string | null | undefined): { name: string; id: string } | null {
  const m = new RegExp(`^${EMOTE_SRC}$`).exec(text ?? '')
  return m ? { name: m[1], id: m[2] } : null
}
export interface Emote {
  id: string
  name: string
  animated: boolean
}
// ——— Menciones: en el mensaje va siempre el usuario real (@usuario); cada uno lo ve con el nombre que tiene para esa
// persona (su apodo, su nombre visible…). Así @apodo que solo conoces tú le llega igual ———
/** Para comparar nombres: minúsculas y solo letras, números, _ y . (como se escribe tras la @) */
export const mentionKey = (name: string): string => name.toLowerCase().replace(/[^\p{L}\p{N}_.]/gu, '')
export interface MentionPerson {
  /** Su usuario real */
  login: string
  /** Cómo lo puedes llamar tú: apodo, nombre visible, usuario… */
  names: string[]
}
/** Para enseñarlo en corto (la lista de chats): cada @usuario con el nombre con el que tú lo ves */
export const showMentions = (text: string, names: Map<string, string>): string =>
  text.replace(/(^|\s)@([\p{L}\p{N}_.]{2,32})/gu, (all, pre: string, login: string) => {
    const name = names.get(login.toLowerCase())
    return name ? `${pre}@${name}` : all
  })

/** Al enviar: cada @nombre que es de alguien del chat pasa a su @usuario */
export function resolveMentions(text: string, people: MentionPerson[]): string {
  const byKey = new Map<string, string>()
  for (const p of people) for (const n of [p.login, ...p.names]) if (mentionKey(n).length >= 2 && !byKey.has(mentionKey(n))) byKey.set(mentionKey(n), p.login)
  return text.replace(/(^|\s)@([\p{L}\p{N}_.]{2,32})/gu, (all, pre: string, name: string) => {
    const login = byKey.get(mentionKey(name))
    return login ? `${pre}@${login}` : all
  })
}

/** Para editar: los emotes vuelven a :NOMBRE: y se devuelven para que al guardar se conviertan otra vez */
export function unEmote(text: string): { text: string; emotes: Emote[] } {
  const emotes: Emote[] = []
  const out = text.replace(EMOTE_ALL, (_, name: string, id: string) => {
    emotes.push({ name, id, animated: true })
    return `:${name}:`
  })
  return { text: out, emotes }
}
/** Al enviar: cada :NOMBRE: que conoces (recientes, favoritos) pasa a su emote */
export const withEmotes = (text: string, known: Emote[]): string =>
  text.replace(/(?<![\w<]):([\w\-!?.']{1,40}):/g, (all, name: string) => {
    const e = known.find((k) => k.name === name) ?? known.find((k) => k.name.toLowerCase() === name.toLowerCase())
    return e ? emoteToken(e.name, e.id) : all
  })

const INLINE: [RegExp, Inline['t']][] = [
  [new RegExp(`^${EMOTE_SRC}`), 'emote'],
  [/^`([^`\n]+)`/, 'code'],
  [/^\*\*(.+?)\*\*/s, 'bold'],
  [/^__(.+?)__/s, 'under'],
  [/^~~(.+?)~~/s, 'strike'],
  [/^\|\|(.+?)\|\|/s, 'spoiler'],
  [/^\*(?!\s)(.+?)\*/s, 'italic'],
  [/^_(?!\s)(.+?)_/s, 'italic'],
  [/^@([\p{L}\p{N}_.]{2,32})/u, 'mention']
]

export function parseInline(s: string, depth = 0): Inline[] {
  const out: Inline[] = []
  let buf = ''
  let i = 0
  const flush = (): void => {
    if (buf) out.push({ t: 'text', v: buf })
    buf = ''
  }
  while (i < s.length) {
    const rest = s.slice(i)
    // Una @ solo cuenta como mención al principio o tras un espacio (no en un correo)
    const canMention = i === 0 || /\s/.test(s[i - 1])
    let hit = false
    if (depth < 4 && /[`*_~|@<]/.test(s[i])) {
      for (const [re, t] of INLINE) {
        if (t === 'mention' && !canMention) continue
        const m = re.exec(rest)
        if (!m) continue
        flush()
        if (t === 'emote') out.push({ t, name: m[1], id: m[2] })
        else if (t === 'code' || t === 'mention') out.push({ t, v: m[1] })
        else out.push({ t, c: parseInline(m[1], depth + 1) } as Inline)
        i += m[0].length
        hit = true
        break
      }
    }
    if (!hit) buf += s[i++]
  }
  flush()
  return out
}

export function parseMessage(text: string): Block[] {
  const blocks: Block[] = []
  const parts = text.split(/```(?:[a-z0-9]*\n)?([\s\S]*?)```/)
  parts.forEach((part, k) => {
    if (k % 2) {
      blocks.push({ t: 'code', v: part.replace(/\n$/, '') })
      return
    }
    const lines = part.split('\n')
    let para: string[] = []
    const flush = (): void => {
      const s = para.join('\n')
      if (s.trim()) blocks.push({ t: 'p', c: parseInline(s) })
      para = []
    }
    for (const l of lines) {
      if (/^> /.test(l)) {
        flush()
        blocks.push({ t: 'quote', c: parseInline(l.slice(2)) })
      } else para.push(l)
    }
    flush()
  })
  return blocks
}

/** Texto sin formato para vistas previas (lista, citas, fijados, avisos): los spoilers siguen tapados */
export const plainText = (text: string, max = 120): string =>
  text
    .replace(EMOTE_ALL, ':$1:')
    .replace(/\|\|[\s\S]+?\|\|/g, '▒▒▒')
    .replace(/[*_~`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

/** Solo emojis o emotes (hasta 6 entre todos): se pintan grandes, como en Discord */
export const onlyEmoji = (text: string): boolean => {
  const t = text.trim()
  const emotes = t.match(EMOTE_ALL)?.length ?? 0
  const rest = t.replace(EMOTE_ALL, '').trim()
  if (!rest) return emotes > 0 && emotes <= 6
  if (emotes >= 6) return false
  return rest.length <= 48 && new RegExp(`^(\\p{Extended_Pictographic}(️|‍\\p{Extended_Pictographic}|\\p{Emoji_Modifier})*\\s*){1,${6 - emotes}}$`, 'u').test(rest)
}

/** Primer mensaje de un bloque: cambia quien escribe, pasan más de 7 minutos o cambia el día */
export function isGroupHead(prev: ChatMessage | undefined, m: ChatMessage): boolean {
  if (!prev) return true
  if (prev.from !== m.from || m.at - prev.at > 7 * 60_000) return true
  return new Date(prev.at).toDateString() !== new Date(m.at).toDateString()
}

// ——— Stickers incluidos: los emojis animados de Google (Noto, licencia Apache 2.0) ———
const NOTO = 'https://fonts.gstatic.com/s/e/notoemoji/latest'
/** Un sticker subido por alguien (lo sirve la app desde su caché o nuestro servidor) */
export const userStickerUrl = (owner: string, id: string): string => `poxi-img://sticker/${owner}/${id}`

/** Animado (512 px) o el fijo (svg, ligero) */
export const packStickerUrl = (code: string, animated = true): string => `${NOTO}/${code}/${animated ? '512.webp' : 'emoji.svg'}`

const codes = (s: string): string[] => s.split(' ')
export const STICKER_PACKS: { id: string; icon: string; codes: string[] }[] = [
  {
    id: 'faces',
    icon: '1f602',
    codes: codes(
      '1f600 1f603 1f604 1f601 1f606 1f605 1f923 1f602 1f642 1f643 1f609 1f60a 1f607 1f970 1f60d 1f929 1f618 1f61b 1f61c 1f92a 1f61d 1f911 1f917 1f92d 1f92b 1f914 1f910 1f928 1f610 1f611 1f636 1f60f 1f612 1f644 1f62c 1f925 1f60c 1f614 1f62a 1f924 1f634 1f637 1f912 1f915 1f922 1f92e 1f927 1f975 1f976 1f974 1f635 1f92f 1f920 1f973 1f978 1f60e 1f913 1f9d0 1f615 1f61f 1f641 1f62e 1f62f 1f632 1f633 1f97a 1f979 1f626 1f627 1f628 1f630 1f625 1f622 1f62d 1f631 1f616 1f623 1f61e 1f613 1f629 1f62b 1f971 1f624 1f621 1f620 1f92c 1f608 1f47f 1f480 1f4a9 1f921 1f47b 1f47d 1f916 1f63a 1f639 1f63b 1f640 1f648 1f649 1f64a'
    )
  },
  {
    id: 'hands',
    icon: '1f44d',
    codes: codes('1f44b 1f44c 1f90c 1f90f 270c_fe0f 1f91e 1f91f 1f918 1f919 1f448 1f449 1f446 1f447 1f44d 1f44e 270a 1f44a 1f91b 1f91c 1f44f 1f64c 1f450 1f932 1f91d 1f64f 1f4aa 1f9e0 1f440 1f48b')
  },
  {
    id: 'love',
    icon: '2764_fe0f',
    codes: codes('2764_fe0f 1f9e1 1f49b 1f49a 1f499 1f49c 1f5a4 1f494 1f495 1f496 1f497 1f498 1f49d 1f4af 1f4a5 1f4ab 1f4ac 1f525 2728 1f31f 2b50 1f308 26a1 2744_fe0f 2604_fe0f')
  },
  {
    id: 'party',
    icon: '1f389',
    codes: codes('1f389 1f38a 1f381 1f382 1f3c6 1f947 1f3af 1f3b2 1f47e 1f680 1f6f8 1f4a3 1f451 1f48e 1f4b8 1f37f 1f355 1f354 1f37b 1f942 2615 1f3b6 1f3b8 1f941 1f4f8')
  },
  {
    id: 'nature',
    icon: '1f98a',
    codes: codes('1f431 1f98a 1f43b 1f43c 1f438 1f412 1f427 1f40d 1f409 1f984 1f98b 1f40c 1f577_fe0f 1f419 1f988 1f422 1f996 1f995 1f335 1f340 1f344 1f30d 1f31a 1f31d 1f31e 1f30b')
  },
  {
    id: 'signs',
    icon: '2705',
    codes: codes('23f0 23f3 1f6a8 1f6a6 1f4a1 1f514 2705 274c 2757 2753 1f198 1f197 1f195 1f199 1f192 1f193')
  }
]

/** Reacciones rápidas (las de siempre) */
export const QUICK_REACTIONS = ['👍', '😂', '❤️', '🔥', '😮', '😢', '🎉', '👀']
