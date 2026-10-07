import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

// Denuncias de mensajes y de cuentas. Se guarda una copia del mensaje tal como estaba (aunque luego lo borren) y el
// admin las revisa en el panel: borrar el mensaje, bloquear la cuenta o descartar.

export const REASONS = ['spam', 'harassment', 'inappropriate', 'impersonation', 'other']
const MAX_OPEN_PER_REPORTER = 20
const KEEP_RESOLVED = 500

export const reportBody = z
  .object({
    kind: z.enum(['message', 'user']),
    user: z.string().uuid(),
    chat: z.string().uuid().optional(),
    message: z.number().int().positive().optional(),
    reason: z.enum(REASONS),
    text: z.string().trim().max(500).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/).optional()
  })
  .strict()
  .refine((b) => b.kind === 'user' || (b.chat && b.message), 'Falta el mensaje')

export function createReports(dataDir, accounts, chat) {
  const file = join(dataDir, 'reports.json')
  /** id → denuncia */
  let reports = {}
  let saving = Promise.resolve()
  const save = () => {
    saving = saving.then(async () => {
      await mkdir(dataDir, { recursive: true })
      await writeFile(`${file}.tmp`, JSON.stringify(reports))
      await rename(`${file}.tmp`, file)
    })
    return saving
  }
  const who = (id) => ({ id, username: accounts.user(id)?.username ?? '(cuenta borrada)' })
  /** Solo lo que se ve de un mensaje (sin reacciones ni respuestas) */
  const copy = (m) => ({
    id: m.id,
    from: m.from,
    at: m.at,
    ...(m.text ? { text: m.text } : {}),
    ...(m.gif ? { gif: m.gif.url } : {}),
    ...(m.sticker ? { sticker: true } : {}),
    ...(m.media ? { media: m.media.kind } : {}),
    ...(m.invite ? { invite: m.invite.name } : {})
  })

  return {
    async init() {
      try {
        reports = JSON.parse(await readFile(file, 'utf8'))
      } catch {
        reports = {}
      }
    },

    async create(reporter, b) {
      if (b.user === reporter.id || !accounts.user(b.user)) return { error: 'No existe esa cuenta', status: 404 }
      const open = Object.values(reports).filter((r) => r.by === reporter.id && !r.resolved).length
      if (open >= MAX_OPEN_PER_REPORTER) return { error: 'Tienes muchas denuncias sin revisar: espera a que las vea', status: 429 }
      let snapshot
      if (b.kind === 'message') {
        const found = await chat.messageFor(reporter, b.chat, b.message)
        if (!found || found.message.from !== b.user) return { error: 'No existe ese mensaje', status: 404 }
        snapshot = { chat: found.chat, message: copy(found.message), context: found.context.map(copy) }
      }
      // La misma denuncia dos veces no se repite
      const same = Object.values(reports).find((r) => !r.resolved && r.by === reporter.id && r.user === b.user && r.kind === b.kind && r.snapshot?.message?.id === snapshot?.message?.id && r.snapshot?.chat?.id === snapshot?.chat?.id)
      if (same) return { ok: true }
      const r = { id: randomUUID(), at: Date.now(), by: reporter.id, kind: b.kind, user: b.user, reason: b.reason, ...(b.text ? { text: b.text } : {}), ...(snapshot ? { snapshot } : {}) }
      reports[r.id] = r
      await save()
      return { ok: true }
    },

    /** Panel: las abiertas primero, luego las últimas resueltas */
    adminList() {
      const view = (r) => ({
        ...r,
        by: who(r.by),
        user: { ...who(r.user), blocked: !!accounts.user(r.user)?.blocked },
        ...(r.snapshot ? { snapshot: { ...r.snapshot, message: { ...r.snapshot.message, from: who(r.snapshot.message.from) }, context: r.snapshot.context.map((m) => ({ ...m, from: who(m.from) })) } } : {})
      })
      const all = Object.values(reports).sort((a, b) => b.at - a.at)
      return { open: all.filter((r) => !r.resolved).map(view), resolved: all.filter((r) => r.resolved).slice(0, 50).map(view) }
    },

    openCount: () => Object.values(reports).filter((r) => !r.resolved).length,

    /** Cerrar una denuncia con lo que se hizo; borra las resueltas más viejas */
    async resolve(id, action) {
      const r = reports[id]
      if (!r) return null
      r.resolved = { at: Date.now(), action }
      const done = Object.values(reports).filter((x) => x.resolved).sort((a, b) => b.resolved.at - a.resolved.at)
      for (const old of done.slice(KEEP_RESOLVED)) delete reports[old.id]
      await save()
      return r
    }
  }
}
