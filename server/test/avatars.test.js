// Fotos de perfil: solo WebP pequeños y quietos, comprobados por su cabecera real
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webpSize } from '../src/avatars.js'

const fixture = (n) => readFileSync(new URL(`./fixtures/${n}.webp`, import.meta.url))

test('acepta las fotos que genera la app (con y sin transparencia)', () => {
  assert.deepEqual(webpSize(fixture('avatar')), { w: 256, h: 256 })
  assert.deepEqual(webpSize(fixture('avatar-alpha')), { w: 256, h: 256 })
})

test('rechaza lo que no es una foto de perfil válida', () => {
  // Demasiado grande (900×900)
  assert.equal(webpSize(fixture('avatar-big')), null)
  // Animada (se marca el bit de animación)
  const anim = Buffer.from(fixture('avatar'))
  anim[20] |= 0x02
  assert.equal(webpSize(anim), null)
  // Algo escondido detrás del archivo (el tamaño declarado ya no cuadra)
  assert.equal(webpSize(Buffer.concat([fixture('avatar'), Buffer.from('<script>alert(1)</script>')])), null)
  // Un HTML con la cabecera de un WebP pegada delante
  const fake = Buffer.alloc(64, 0x20)
  fake.write('RIFF', 0)
  fake.writeUInt32LE(56, 4)
  fake.write('WEBP', 8)
  fake.write('<html>', 12)
  assert.equal(webpSize(fake), null)
  // Otros formatos y basura
  assert.equal(webpSize(Buffer.from('\x89PNG\r\n\x1a\n' + 'x'.repeat(60), 'binary')), null)
  assert.equal(webpSize(Buffer.from('hola')), null)
  assert.equal(webpSize('no es un buffer'), null)
  // Más de 150 KB
  assert.equal(webpSize(Buffer.alloc(151 * 1024)), null)
})
