import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomInt } from 'node:crypto'

// Enlaces de invitación (<servidor>/i/<código>): quien lo abre se hace amigo de quien lo creó y, si es
// de un pack, entra en él. Como los de Discord: caducan, tienen usos y se pueden anular.

export const INVITE_DAYS = 7
export const INVITE_USES = 10
const DAY = 24 * 3600_000
// Sin letras que se confunden (0/O, 1/I/L)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const CODE = /^[A-HJKMNP-Z2-9]{8}$/

export function createInvites(dataDir, accounts, mcPacks) {
  const file = join(dataDir, 'invites.json')
  /** código → { code, by, pack, at, expires, used: [ids], revoked? } */
  let invites = {}
  let saving = Promise.resolve()
  const save = () => {
    saving = saving.then(async () => {
      await mkdir(dataDir, { recursive: true })
      await writeFile(`${file}.tmp`, JSON.stringify(invites))
      await rename(`${file}.tmp`, file)
    })
    return saving
  }
  const live = (i) => !!i && !i.revoked && Date.now() < i.expires && i.used.length < INVITE_USES && !!accounts.user(i.by)
  const mine = (i) => ({ code: i.code, pack: i.pack, at: i.at, expires: i.expires, uses: i.used.length, max: INVITE_USES })
  const newCode = () => {
    for (;;) {
      const c = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
      if (!invites[c]) return c
    }
  }

  return {
    async init() {
      try {
        invites = JSON.parse(await readFile(file, 'utf8'))
      } catch {
        invites = {}
      }
    },

    /** El enlace de esa cuenta (de amistad o de un pack suyo): el mismo mientras valga, si no uno nuevo */
    async create(u, pack = null) {
      if (pack && !mcPacks.isMember(pack, u)) return { error: 'No estás en ese pack', status: 404 }
      const now = Object.values(invites).find((i) => i.by === u.id && i.pack === pack && live(i))
      if (now) return { invite: mine(now) }
      // Los caducados o anulados de más de un mes se olvidan
      for (const i of Object.values(invites)) if (i.expires < Date.now() - 30 * DAY) delete invites[i.code]
      const i = { code: newCode(), by: u.id, pack, at: Date.now(), expires: Date.now() + INVITE_DAYS * DAY, used: [] }
      invites[i.code] = i
      await save()
      return { invite: mine(i) }
    },

    async revoke(u, code) {
      const i = invites[code]
      if (!i || i.by !== u.id) return { error: 'No existe', status: 404 }
      i.revoked = true
      await save()
      return { ok: true }
    },

    /** Lo que ve quien abre el enlace (sin cuenta): quién invita y a qué. null si ya no vale */
    preview(code) {
      const i = invites[code]
      if (!live(i)) return null
      const by = accounts.user(i.by)
      return {
        by: { id: by.id, username: by.username, displayName: by.profile?.displayName ?? null, avatar: by.avatar ?? null },
        pack: i.pack ? mcPacks.summary(i.pack, i.by) : null,
        expires: i.expires
      }
    },

    /** Aceptar: amigos (si no lo erais) y dentro del pack. Cuenta un uso por persona */
    async accept(u, code) {
      const i = invites[code]
      if (!live(i) && !i?.used.includes(u.id)) return { error: 'Esta invitación ya no vale', status: 404 }
      if (i.by === u.id) return { error: 'Es tu propia invitación', status: 400 }
      const friend = await accounts.befriend(u, i.by)
      if (friend.error) return { error: 'Esta invitación ya no vale', status: 404 }
      let pack = null
      let full = false
      if (i.pack && mcPacks.summary(i.pack, i.by)) {
        const out = await mcPacks.join(u, i.pack)
        if (out.pack) pack = i.pack
        else full = true
      }
      if (!i.used.includes(u.id)) {
        i.used.push(u.id)
        await save()
      }
      return { friend: i.by, pack, full }
    }
  }
}
