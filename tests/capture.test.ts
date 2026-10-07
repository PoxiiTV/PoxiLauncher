import { describe, expect, it } from 'vitest'
import {
  bufferSegments,
  captureFileName,
  clipBitrate,
  hotkeyMods,
  clipSegments,
  concatList,
  mainKeyVk,
  outHeight,
  recordArgs,
  safeName
} from '../src/shared/capture'

describe('capturas y clips', () => {
  it('nombres de archivo válidos en Windows', () => {
    expect(safeName('Half-Life: Alyx')).toBe('Half-Life Alyx')
    expect(safeName('  ¿Qué? <juego>*  ')).toBe('¿Qué juego')
    expect(safeName('Juego...')).toBe('Juego')
    expect(safeName('///')).toBe('PoxiLauncher')
    expect(captureFileName('iRacing Arcade', new Date(2026, 8, 30, 7, 5, 9))).toBe('iRacing Arcade 2026-09-30 07-05-09')
  })

  it('un clip de 30 s junta los últimos trozos terminados (no el que va a medias), del más viejo al más nuevo', () => {
    const segs = Array.from({ length: 20 }, (_, i) => ({ name: `seg${i}`, mtime: 1000 + i * 2000 }))
    const got = clipSegments(segs.reverse(), 30)
    expect(got).toHaveLength(15)
    expect(got[0].name).toBe('seg4')
    expect(got.at(-1)!.name).toBe('seg18')
    // Recién empezada la partida: lo que haya
    expect(clipSegments(segs.slice(0, 3), 30)).toHaveLength(2)
    expect(bufferSegments(30)).toBe(18)
  })

  it('la tecla que hay que vigilar para «mantener»', () => {
    expect(mainKeyVk('F12')).toBe(0x7b)
    expect(mainKeyVk('Shift+F1')).toBe(0x70)
    expect(mainKeyVk('CommandOrControl+Shift+P')).toBe(0x50)
    expect(mainKeyVk('Alt+Home')).toBe(0x24)
    expect(mainKeyVk('Alt+`')).toBeNull()
    expect(hotkeyMods('F12')).toBe(0)
    expect(hotkeyMods('CommandOrControl+Shift+P')).toBe(3)
    expect(hotkeyMods('Alt+Home')).toBe(4)
  })
})

describe('grabación de clips', () => {
  const plan = {
    encoder: 'h264_nvenc' as const,
    quality: 'native' as const,
    fps: 60 as const,
    audio: true,
    output: 0,
    audioIn: { format: 's16le' as const, rate: 48000 },
    srcH: 1440,
    seconds: 30,
    dir: 'C:\\buf'
  }

  it('graba la pantalla elegida y el audio de un dispositivo concreto (float a su frecuencia, sale a 48 kHz)', () => {
    const a = recordArgs({ ...plan, output: 1, audioIn: { format: 'f32le', rate: 44100 } }).join(' ')
    expect(a).toContain('ddagrab=output_idx=1:framerate=60')
    expect(a).toContain('-f f32le -ar 44100 -ac 2 -i pipe:0')
    expect(a).toContain('-c:a aac -b:a 160k -ar 48000')
  })

  it('NVENC a resolución nativa no pasa por la CPU', () => {
    const a = recordArgs(plan)
    expect(a).not.toContain('-vf')
    expect(a.join(' ')).toContain('ddagrab=output_idx=0:framerate=60')
    expect(a.join(' ')).toContain('-i pipe:0')
    expect(a).not.toContain('-color_range')
    expect(a.join(' ')).toContain('-segment_wrap 18')
    expect(a.at(-1)).toBe('C:/buf/seg%03d.ts')
    expect(a[a.indexOf('-g') + 1]).toBe('120')
  })

  it('a 1080 o con otra gráfica se escala en la CPU; sin audio no hay segunda entrada', () => {
    const a = recordArgs({ ...plan, quality: '1080', audio: false, encoder: 'h264_amf' })
    expect(a[a.indexOf('-vf') + 1]).toContain('scale=-2:1080')
    expect(a).not.toContain('pipe:0')
    expect(a).not.toContain('-c:a')
    // Una pantalla de 1080 no se «escala» a 1080: se queda igual
    expect(recordArgs({ ...plan, quality: '1080', srcH: 1080 }).join(' ')).not.toContain('scale=-2')
    expect(outHeight('720', 1440)).toBe(720)
    expect(clipBitrate(1440, 60)).toBe(16)
    expect(clipBitrate(1080, 30)).toBe(6)
  })

  it('lista para juntar los trozos', () => {
    expect(concatList(['C:\\a\\seg001.ts', "C:\\it's\\seg002.ts"])).toBe("file 'C:/a/seg001.ts'\nfile 'C:/it'\\''s/seg002.ts'\n")
  })
})
