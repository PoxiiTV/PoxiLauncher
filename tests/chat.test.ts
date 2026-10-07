import { describe, expect, it } from 'vitest'
import { resolveMentions, showMentions, emoteUrl, isGroupHead, onlyEmoji, parseInline, parseMessage, plainText, STICKER_PACKS, withEmotes, type ChatMessage } from '../src/shared/chat'

describe('formato de los mensajes (estilo Discord)', () => {
  it('negrita, cursiva, subrayado, tachado, código, spoiler y menciones', () => {
    expect(parseInline('hola **fuerte** y *suave*')).toEqual([
      { t: 'text', v: 'hola ' },
      { t: 'bold', c: [{ t: 'text', v: 'fuerte' }] },
      { t: 'text', v: ' y ' },
      { t: 'italic', c: [{ t: 'text', v: 'suave' }] }
    ])
    expect(parseInline('__sub__ ~~no~~ `x*y*` ||sorpresa||')).toEqual([
      { t: 'under', c: [{ t: 'text', v: 'sub' }] },
      { t: 'text', v: ' ' },
      { t: 'strike', c: [{ t: 'text', v: 'no' }] },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'x*y*' },
      { t: 'text', v: ' ' },
      { t: 'spoiler', c: [{ t: 'text', v: 'sorpresa' }] }
    ])
    // Anidado
    expect(parseInline('**a *b* c**')[0]).toEqual({ t: 'bold', c: [{ t: 'text', v: 'a ' }, { t: 'italic', c: [{ t: 'text', v: 'b' }] }, { t: 'text', v: ' c' }] })
    // Mención solo al empezar o tras un espacio (un correo no)
    expect(parseInline('hola @ana, ¿vienes?')[1]).toEqual({ t: 'mention', v: 'ana' })
    expect(parseInline('yo@correo.com').some((x) => x.t === 'mention')).toBe(false)
    // Sueltos: se quedan como texto
    expect(parseInline('2 * 3 = 6')).toEqual([{ t: 'text', v: '2 * 3 = 6' }])
    expect(parseInline('<b>no</b>')).toEqual([{ t: 'text', v: '<b>no</b>' }])
  })

  it('bloques de código y citas', () => {
    expect(parseMessage('mira:\n```js\nconst a = 1\n```\n> cita')).toEqual([
      { t: 'p', c: [{ t: 'text', v: 'mira:\n' }] },
      { t: 'code', v: 'const a = 1' },
      { t: 'quote', c: [{ t: 'text', v: 'cita' }] }
    ])
  })

  it('solo emojis: grandes', () => {
    expect(onlyEmoji('😂')).toBe(true)
    expect(onlyEmoji('🔥 🔥 🔥')).toBe(true)
    expect(onlyEmoji('👍🏽')).toBe(true)
    expect(onlyEmoji('hola 😂')).toBe(false)
    expect(onlyEmoji('')).toBe(false)
  })
})

describe('agrupar mensajes seguidos', () => {
  const m = (from: string, at: number): ChatMessage => ({ id: at, from, at })
  it('nuevo bloque al cambiar de persona, tras 7 minutos o al cambiar de día', () => {
    const t = new Date(2026, 8, 28, 12, 0).getTime()
    expect(isGroupHead(undefined, m('a', t))).toBe(true)
    expect(isGroupHead(m('a', t), m('a', t + 60_000))).toBe(false)
    expect(isGroupHead(m('a', t), m('b', t + 60_000))).toBe(true)
    expect(isGroupHead(m('a', t), m('a', t + 8 * 60_000))).toBe(true)
    const late = new Date(2026, 8, 28, 23, 58).getTime()
    expect(isGroupHead(m('a', late), m('a', late + 3 * 60_000))).toBe(true)
  })
})

describe('stickers incluidos', () => {
  it('códigos válidos y sin repetir dentro de cada pack', () => {
    for (const p of STICKER_PACKS) {
      expect(new Set(p.codes).size).toBe(p.codes.length)
      expect(p.codes.every((c) => /^[0-9a-f]{2,6}(_[0-9a-f]{2,6}){0,3}$/.test(c))).toBe(true)
      expect(p.codes).toContain(p.icon)
    }
  })
})

describe('menciones con apodos', () => {
  const people = [
    { login: 'saul_99', names: ['Saulito', 'Saúl el Grande 👑'] },
    { login: 'ana', names: ['Ana la Reina'] }
  ]
  it('@apodo, @nombre visible o @usuario pasan al usuario real; lo demás se queda', () => {
    expect(resolveMentions('hola @saulito y @SaúlelGrande, @ana_no y @ANA', people)).toBe('hola @saul_99 y @saul_99, @ana_no y @ana')
    expect(resolveMentions('correo@saulito.com', people)).toBe('correo@saulito.com')
  })
  it('en la lista, cada @usuario sale con el nombre con el que tú lo ves', () => {
    const names = new Map([['saul_99', 'Saulito']])
    expect(showMentions('hola @saul_99 y @nadie', names)).toBe('hola @Saulito y @nadie')
  })
})

describe('emotes de 7TV y BetterTTV', () => {
  const kekw = { id: '01FCP0YPQ800037YGEKHNTNXY1', name: 'KEKW', animated: true }
  const bttv = { id: '5e9c6c187e090362f8b0b9e8', name: 'catJAM', animated: true }
  it('al enviar, :NOMBRE: conocido pasa a su emote (y lo demás se queda igual)', () => {
    expect(withEmotes('jaja :KEKW: y :catJAM::kekw:', [kekw, bttv])).toBe(
      'jaja <e:KEKW:01FCP0YPQ800037YGEKHNTNXY1> y <e:catJAM:5e9c6c187e090362f8b0b9e8><e:KEKW:01FCP0YPQ800037YGEKHNTNXY1>'
    )
    expect(withEmotes('a las 12:30:45 y :nada:', [kekw])).toBe('a las 12:30:45 y :nada:')
  })
  it('se pintan como emote, grandes si van solos, y en corto como :NOMBRE:', () => {
    expect(parseInline('ja <e:KEKW:01FCP0YPQ800037YGEKHNTNXY1>!')).toEqual([
      { t: 'text', v: 'ja ' },
      { t: 'emote', name: 'KEKW', id: '01FCP0YPQ800037YGEKHNTNXY1' },
      { t: 'text', v: '!' }
    ])
    expect(onlyEmoji('<e:KEKW:01FCP0YPQ800037YGEKHNTNXY1> 😂')).toBe(true)
    expect(onlyEmoji('<e:KEKW:01FCP0YPQ800037YGEKHNTNXY1> hola')).toBe(false)
    expect(plainText('mira <e:KEKW:01FCP0YPQ800037YGEKHNTNXY1>')).toBe('mira :KEKW:')
    // Un id raro no es un emote: se queda como texto
    expect(parseInline('<e:x:../../evil>')).toEqual([{ t: 'text', v: '<e:x:../../evil>' }])
  })
  it('cada CDN con su tamaño', () => {
    expect(emoteUrl(kekw.id, 4)).toBe('https://cdn.7tv.app/emote/01FCP0YPQ800037YGEKHNTNXY1/4x.webp')
    expect(emoteUrl(bttv.id, 4)).toBe('https://cdn.betterttv.net/emote/5e9c6c187e090362f8b0b9e8/3x.webp')
  })
})
