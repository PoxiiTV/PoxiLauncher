import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

// Packs de Minecraft compartidos entre amigos: la receta de una instancia (versión, loader y la lista de mods,
// resource packs y shaders de Modrinth). Nada de archivos: cada app se los baja de Modrinth. Cada cambio sube la
// revisión y guarda cómo quedó, para poder volver atrás todo el grupo a la vez.

export const MAX_PACK_MEMBERS = 8
const MAX_PACKS_PER_USER = 50
const MAX_ITEMS = 500
const MAX_HISTORY = 30
/** Quien aloja el mundo del grupo lo renueva cada minuto; si deja de hacerlo, a los 3 queda libre */
const LOCK_MS = 3 * 60_000

const mrId = z.string().regex(/^[A-Za-z0-9]{8}$/)
export const packItemSchema = z
  .object({
    kind: z.enum(['mod', 'resourcepack', 'shader']),
    projectId: mrId,
    versionId: mrId,
    title: z.string().max(100),
    file: z.string().max(200)
  })
  .strict()

export const packInfoSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    mc: z.string().regex(/^[\w.+ -]{1,40}$/),
    loader: z.enum(['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']),
    loaderVersion: z.string().regex(/^[\w.+-]{1,60}$/).optional(),
    icon: z.string().url().max(400).startsWith('https://').nullable().optional()
  })
  .strict()

/** Qué se hizo (la app lo traduce): clave corta y datos */
export const noteSchema = z
  .object({
    key: z.enum(['create', 'install', 'update', 'version', 'remove', 'enable', 'disable', 'rollback', 'sync']),
    params: z.record(z.string().max(20), z.string().max(100)).optional()
  })
  .strict()

export const packOpSchema = z.union([
  z.object({ op: z.literal('set'), item: packItemSchema }).strict(),
  z.object({ op: z.literal('remove'), projectId: mrId }).strict()
])

export function createMcPacks(dataDir, accounts, live = { notify: () => undefined }, maxWorldBytes = 500 * 1024 * 1024) {
  const file = join(dataDir, 'mcpacks.json')
  /** id → { id, owner, name, mc, loader, loaderVersion, icon, members[], invited[], items[], rev, history[], updatedAt } */
  let packs = {}
  let saving = Promise.resolve()
  const save = () => {
    saving = saving.then(async () => {
      await mkdir(dataDir, { recursive: true })
      await writeFile(`${file}.tmp`, JSON.stringify(packs))
      await rename(`${file}.tmp`, file)
    })
    return saving
  }
  /** Avisa al momento a los del pack (y a los invitados), menos a quien hizo el cambio */
  const tell = (p, except) => live.notify([...p.members, ...p.invited].filter((x) => x !== except), 'mcpacks')

  const alive = (ids) => ids.filter((id) => accounts.user(id))
  const who = (id) => ({ id, username: accounts.user(id)?.username ?? '?' })
  const view = (p, me) => ({
    id: p.id,
    name: p.name,
    mc: p.mc,
    loader: p.loader,
    loaderVersion: p.loaderVersion ?? null,
    icon: p.icon ?? null,
    rev: p.rev,
    items: p.items,
    owner: who(p.owner),
    invited: !p.members.includes(me.id),
    members: alive(p.members).map(who),
    pending: alive(p.invited).map(who),
    // Historial sin las listas (solo qué, quién y cuándo): la de cada revisión la guarda el servidor para volver
    history: p.history.map((h) => ({ rev: h.rev, at: h.at, by: who(h.by), note: h.note, count: h.items.length })),
    // Mundo del grupo: su versión y quién lo está alojando ahora (si alguien)
    world: p.world ? { rev: p.world.rev, size: p.world.size, at: p.world.at, by: who(p.world.by) } : null,
    lock: lockOf(p) ? { by: who(p.lock.by), at: p.lock.at } : null
  })
  const lockOf = (p) => (p.lock && Date.now() - p.lock.at < LOCK_MS ? p.lock : null)
  const worldDir = join(dataDir, 'mcworlds')
  const worldFile = (id) => join(worldDir, `${id}.zip`)
  /** Subidas del mundo a medias: pack:subida → parte siguiente, bytes y quién */
  const uploads = new Map()
  const mine = (u) => Object.values(packs).filter((p) => p.members.includes(u.id) || p.invited.includes(u.id))
  const member = (u, id) => {
    const p = packs[id]
    return p && p.members.includes(u.id) ? p : null
  }
  const record = (p, by, note) => {
    p.rev += 1
    p.updatedAt = Date.now()
    p.history = [{ rev: p.rev, at: p.updatedAt, by, note, items: p.items }, ...p.history].slice(0, MAX_HISTORY)
  }

  return {
    async init() {
      try {
        packs = JSON.parse(await readFile(file, 'utf8'))
      } catch {
        packs = {}
      }
    },

    list: (u) => mine(u).map((p) => view(p, u)),

    async create(u, info, items) {
      if (mine(u).length >= MAX_PACKS_PER_USER) return { error: 'Demasiados packs' }
      const p = { id: randomUUID(), owner: u.id, ...info, members: [u.id], invited: [], items: items.slice(0, MAX_ITEMS), rev: 0, history: [] }
      record(p, u.id, { key: 'create' })
      packs[p.id] = p
      await save()
      return { pack: view(p, u) }
    },

    /** Solo se invita a amigos tuyos, y el pack tiene un máximo */
    async invite(u, id, friendId) {
      const p = member(u, id)
      if (!p) return { error: 'No existe' }
      if (!u.friends.includes(friendId) || !accounts.user(friendId)) return { error: 'Solo puedes invitar a tus amigos' }
      if (p.members.includes(friendId)) return { pack: view(p, u) }
      if (alive(p.members).length + alive(p.invited).length >= MAX_PACK_MEMBERS) return { error: 'El pack está lleno' }
      if (!p.invited.includes(friendId)) p.invited.push(friendId)
      await save()
      tell(p, u.id)
      return { pack: view(p, u) }
    },

    async answer(u, id, accept) {
      const p = packs[id]
      if (!p || !p.invited.includes(u.id)) return { error: 'No hay invitación' }
      p.invited = p.invited.filter((x) => x !== u.id)
      if (accept) p.members.push(u.id)
      await save()
      tell(p, u.id)
      return accept ? { pack: view(p, u) } : { ok: true }
    },

    /** Lo que enseña un enlace de invitación (sin la lista de mods): null si no existe o esa persona ya no está dentro */
    summary(id, member) {
      const p = packs[id]
      if (!p || !p.members.includes(member)) return null
      return { id: p.id, name: p.name, mc: p.mc, loader: p.loader, icon: p.icon ?? null, mods: p.items.length, members: alive(p.members).length, full: alive(p.members).length + alive(p.invited).length >= MAX_PACK_MEMBERS }
    },

    /** ¿Está dentro? (para crear un enlace de su pack) */
    isMember: (id, u) => !!packs[id]?.members.includes(u.id),

    /** "Unirme a mi amigo": entrar sin invitación en el pack de alguien que es tu amigo y está dentro */
    async join(u, id) {
      const p = packs[id]
      if (!p) return { error: 'No existe' }
      if (p.members.includes(u.id)) return { pack: view(p, u) }
      if (!p.members.some((m) => u.friends.includes(m))) return { error: 'Solo con tus amigos' }
      if (alive(p.members).length + alive(p.invited).length >= MAX_PACK_MEMBERS) return { error: 'El pack está lleno' }
      p.invited = p.invited.filter((x) => x !== u.id)
      p.members.push(u.id)
      await save()
      tell(p, u.id)
      return { pack: view(p, u) }
    },

    async leave(u, id) {
      const p = packs[id]
      if (!p) return { ok: true }
      p.members = p.members.filter((x) => x !== u.id)
      p.invited = p.invited.filter((x) => x !== u.id)
      if (lockOf(p)?.by === u.id) p.lock = null
      if (!alive(p.members).length) {
        delete packs[id]
        await rm(worldFile(id), { force: true })
      }
      await save()
      tell(p, u.id)
      return { ok: true }
    },

    /**
     * Cambios de un miembro, uno a uno sobre la lista actual: así dos amigos pueden cambiar cosas a la vez sin
     * pisarse (en el mismo mod gana el último).
     */
    async change(u, id, ops, note) {
      const p = member(u, id)
      if (!p) return { error: 'No existe' }
      let items = p.items
      for (const op of ops) {
        const pid = op.op === 'set' ? op.item.projectId : op.projectId
        const rest = items.filter((x) => x.projectId !== pid)
        items = op.op === 'remove' ? rest : [...rest, op.item].slice(0, MAX_ITEMS)
      }
      p.items = items
      record(p, u.id, note)
      await save()
      tell(p, u.id)
      return { pack: view(p, u) }
    },

    // ——— Mundo del grupo ———
    /** Alojar el mundo: solo uno a la vez (si otro lo tiene, se dice quién). También sirve para renovarlo. */
    async lockWorld(u, id) {
      const p = member(u, id)
      if (!p) return { error: 'No existe' }
      const l = lockOf(p)
      if (l && l.by !== u.id) return { error: 'Lo está alojando otro', lockedBy: who(l.by).username }
      const first = !l
      p.lock = { by: u.id, at: Date.now() }
      if (first) {
        await save()
        tell(p, u.id)
      }
      return { pack: view(p, u) }
    },

    async unlockWorld(u, id) {
      const p = member(u, id)
      if (!p) return { error: 'No existe' }
      if (lockOf(p)?.by === u.id) {
        p.lock = null
        await save()
        tell(p, u.id)
      }
      return { pack: view(p, u) }
    },

    /** Ruta del zip del mundo (solo para los del pack) */
    worldPath(u, id) {
      const p = member(u, id)
      return p?.world ? worldFile(id) : null
    },

    /**
     * Sube el mundo por partes (Cloudflare gratis corta los cuerpos de más de 100 MB), solo quien lo está alojando.
     * Las partes llegan en orden a un temporal; con la última se comprueba que es un zip y que no pasa del máximo, y
     * entonces sustituye al anterior (si algo falla, el mundo anterior sigue intacto).
     */
    async uploadWorld(u, id, stream, { part, parts, upload }) {
      const p = member(u, id)
      if (!p) return { error: 'No existe' }
      if (lockOf(p)?.by !== u.id) return { error: 'Primero hay que alojarlo' }
      await mkdir(worldDir, { recursive: true })
      const key = `${id}:${upload}`
      const up = uploads.get(key) ?? { next: 0, size: 0, by: u.id, at: Date.now() }
      if (part !== up.next || up.by !== u.id) return { error: 'Parte fuera de orden', status: 409 }
      const tmp = `${worldFile(id)}.${upload}.tmp`
      const ok = await new Promise((resolve) => {
        const out = createWriteStream(tmp, { flags: part === 0 ? 'w' : 'a' })
        stream.on('data', (c) => {
          up.size += c.length
          if (up.size > maxWorldBytes) {
            stream.destroy()
            out.destroy()
            resolve(false)
          }
        })
        stream.on('error', () => resolve(false))
        out.on('error', () => resolve(false))
        out.on('finish', () => resolve(true))
        stream.pipe(out)
      })
      if (!ok) {
        uploads.delete(key)
        await rm(tmp, { force: true })
        return { error: up.size > maxWorldBytes ? 'El mundo es demasiado grande' : 'No se ha podido subir', status: up.size > maxWorldBytes ? 413 : 400 }
      }
      up.next += 1
      up.at = Date.now()
      if (up.next < parts) {
        uploads.set(key, up)
        return { ok: true, next: up.next }
      }
      uploads.delete(key)
      // Un zip empieza por "PK"
      const head = await readHead(tmp)
      if (head[0] !== 0x50 || head[1] !== 0x4b) {
        await rm(tmp, { force: true })
        return { error: 'No es un mundo válido', status: 400 }
      }
      await rename(tmp, worldFile(id))
      // La revisión nunca baja (aunque el admin borrara el mundo): la app solo baja uno con revisión mayor que la suya
      p.world = { rev: (p.world?.rev ?? p.lastWorldRev ?? 0) + 1, size: (await stat(worldFile(id))).size, at: Date.now(), by: u.id }
      p.lock = { by: u.id, at: Date.now() }
      await save()
      tell(p, u.id)
      return { pack: view(p, u) }
    },

    openWorld: (path) => createReadStream(path),

    /** Todo el grupo vuelve a como estaba el pack en esa revisión */
    async rollback(u, id, rev) {
      const p = member(u, id)
      if (!p) return { error: 'No existe' }
      const h = p.history.find((x) => x.rev === rev)
      if (!h) return { error: 'Esa versión ya no está' }
      p.items = h.items
      record(p, u.id, { key: 'rollback', params: { rev: String(rev) } })
      await save()
      tell(p, u.id)
      return { pack: view(p, u) }
    },

    // ——— Panel de admin ———
    /** Todos los packs: quién está, cuántos mods y su mundo (lo que ocupa en disco) */
    adminList() {
      return Object.values(packs)
        .map((p) => ({
          id: p.id,
          name: p.name,
          mc: p.mc,
          loader: p.loader,
          owner: who(p.owner),
          members: alive(p.members).map(who),
          invited: alive(p.invited).length,
          items: p.items.length,
          rev: p.rev,
          updatedAt: p.updatedAt ?? null,
          world: p.world ? { size: p.world.size, at: p.world.at, by: who(p.world.by) } : null,
          hosting: lockOf(p) ? who(p.lock.by) : null
        }))
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    },

    /** Borra un pack entero (y su mundo): sus miembros dejan de verlo al momento */
    async adminRemove(id) {
      const p = packs[id]
      if (!p) return false
      delete packs[id]
      await rm(worldFile(id), { force: true })
      await save()
      tell(p)
      return true
    },

    /** Borra solo el mundo del grupo (el pack sigue): el próximo que lo aloje empieza uno nuevo */
    async adminRemoveWorld(id) {
      const p = packs[id]
      if (!p?.world) return false
      await rm(worldFile(id), { force: true })
      p.lastWorldRev = p.world.rev
      p.world = null
      p.lock = null
      await save()
      tell(p)
      return true
    }
  }
}

async function readHead(file) {
  const fh = await open(file, 'r')
  try {
    const b = Buffer.alloc(4)
    await fh.read(b, 0, 4, 0)
    return b
  } finally {
    await fh.close()
  }
}
