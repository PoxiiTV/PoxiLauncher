import { mkdir, readFile, rename, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { createAvatars } from './avatars.js'
import { createBanners } from './banners.js'
import { badgesOf, mergeProfile, visibleProfile } from './profile.js'

// Cuentas de PoxiLauncher (Poxi y sus amigos): usuario único + contraseña, amigos y a qué Minecraft está jugando
// cada uno. Nadie ve nada de quien no es su amigo. El admin gestiona las cuentas desde el panel,
// pero nunca ve contraseñas (solo hay hashes bcrypt).
//
// Sesión de la app: token de acceso (15 min) + token de renovación (30 días), devueltos en el cuerpo: la app
// de escritorio los guarda cifrados con safeStorage (no hay navegador ni cookies). "tv" (versión de token)
// invalida todas las sesiones de una cuenta al cambiar la contraseña o al cerrarlas desde el panel.

const BCRYPT_ROUNDS = 12
const ACCESS_S = 15 * 60
const REFRESH_S = 30 * 24 * 60 * 60
/** Sin latido en este tiempo, desconectado */
const ONLINE_MS = 75 * 1000
/** Intentos fallidos seguidos antes de bloquear un rato el inicio de sesión de esa cuenta */
const MAX_FAILS = 5
const LOCK_MS = 15 * 60 * 1000

export const USERNAME_RE = /^[a-zA-Z0-9_.]{3,20}$/
export const usernameSchema = z.string().trim().regex(USERNAME_RE, 'Usuario: 3-20 letras, números, "_" o "."')
export const passwordSchema = z.string().min(8, 'La contraseña necesita al menos 8 caracteres').max(200)

/** Estado que ven los amigos (pura) */
export function presenceOf(u, now = Date.now()) {
  if (!u.presence || now - u.presence.at > ONLINE_MS) return { state: 'offline' }
  const p = u.presence
  return p.mc ? { state: 'playing', gameName: p.gameName, since: p.since, mc: p.mc } : { state: 'online' }
}

/** live: avisos en directo (live.js); sin él (pruebas sueltas) no se avisa a nadie */
export function createAccounts(dataDir, secret, live = { notify: () => undefined }) {
  const file = join(dataDir, 'users.json')
  const auditFile = join(dataDir, 'accounts-audit.log')
  const avatars = createAvatars(dataDir)
  const banners = createBanners(dataDir)
  /** id → usuario */
  let users = {}
  const fails = new Map() // usuario (en minúsculas) → { n, until }
  let saving = Promise.resolve()
  /** Hash de relleno: si el usuario no existe se compara igual (mismo tiempo de respuesta) */
  let dummy = ''
  const removeListeners = []

  const save = () => {
    // Una escritura detrás de otra (nunca dos a la vez sobre el mismo archivo)
    saving = saving.then(async () => {
      await mkdir(dataDir, { recursive: true })
      await writeFile(`${file}.tmp`, JSON.stringify(users))
      await rename(`${file}.tmp`, file)
    })
    return saving
  }
  const audit = (action, detail) =>
    appendFile(auditFile, `${new Date().toISOString()} ${action} ${JSON.stringify(detail)}\n`).catch(() => undefined)

  const byName = (name) => Object.values(users).find((u) => u.lower === name.trim().toLowerCase())
  const nameTaken = (name, exceptId) => {
    const u = byName(name)
    return !!u && u.id !== exceptId
  }

  const tokens = (u) => ({
    access: jwt.sign({ typ: 'user', sub: u.id, tv: u.tv }, secret, { expiresIn: ACCESS_S }),
    refresh: jwt.sign({ typ: 'urefresh', sub: u.id, tv: u.tv }, secret, { expiresIn: REFRESH_S }),
    user: publicMe(u)
  })
  const publicMe = (u) => ({
    id: u.id,
    username: u.username,
    mustChange: !!u.mustChange,
    createdAt: u.createdAt,
    avatar: u.avatar ?? null,
    profile: visibleProfile(u.profile),
    badges: badgesOf(u, firstId())
  })
  /** La primera cuenta que se creó (la del fundador) */
  const firstId = () => Object.values(users).reduce((a, b) => (!a || (b.createdAt ?? Infinity) < (a.createdAt ?? Infinity) ? b : a), null)?.id

  /** Usuario de un token válido (y vigente) o null */
  function fromToken(token, typ) {
    try {
      const p = jwt.verify(token ?? '', secret)
      const u = p.typ === typ ? users[p.sub] : null
      return u && !u.blocked && u.tv === p.tv ? u : null
    } catch {
      return null
    }
  }

  const friendView = (u, viewer) => {
    const friend = viewer.friends.includes(u.id)
    const { mc, ...presence } = presenceOf(u)
    // El apodo que le has puesto tú (solo lo ves tú)
    const nickname = viewer.nicknames?.[u.id]
    return {
      id: u.id,
      username: u.username,
      ...(nickname ? { nickname } : {}),
      ...presence,
      // Dónde juega a Minecraft (y su servidor) solo lo ven sus amigos
      ...(friend && mc ? { mc } : {}),
      createdAt: u.createdAt,
      // Versión de su foto (la app la descarga una vez y la guarda)
      avatar: u.avatar ?? null,
      // Su perfil personalizado y sus insignias
      profile: visibleProfile(u.profile),
      badges: badgesOf(u, firstId())
    }
  }

  return {
    async init() {
      dummy = await bcrypt.hash(randomUUID(), BCRYPT_ROUNDS)
      try {
        users = JSON.parse(await readFile(file, 'utf8'))
      } catch {
        users = {}
      }
    },

    // ——— Cuenta ———
    /** terms: versión de los términos y la privacidad que acepta (se guarda cuándo) */
    async register(username, password, terms) {
      if (nameTaken(username)) return { error: 'Ese nombre de usuario ya existe' }
      const u = {
        id: randomUUID(),
        username: username.trim(),
        lower: username.trim().toLowerCase(),
        hash: await bcrypt.hash(password, BCRYPT_ROUNDS),
        createdAt: Date.now(),
        lastSeen: Date.now(),
        tv: 1,
        friends: [],
        incoming: [],
        outgoing: [],
        ...(terms ? { terms: { v: terms, at: Date.now() } } : {})
      }
      users[u.id] = u
      await save()
      return tokens(u)
    },

    async login(username, password) {
      const key = username.trim().toLowerCase()
      const f = fails.get(key)
      if (f && f.until > Date.now()) return { error: 'Demasiados intentos. Espera unos minutos', locked: true }
      const u = byName(username)
      // Mismo trabajo exista o no el usuario (no se revela qué nombres existen)
      const ok = await bcrypt.compare(password, u?.hash ?? dummy)
      if (!u || !ok) {
        // Solo se empieza de cero cuando termina un bloqueo (until = 0 mientras no lo hay)
        const n = (f?.until && f.until <= Date.now() ? 0 : (f?.n ?? 0)) + 1
        fails.set(key, { n, until: n >= MAX_FAILS ? Date.now() + LOCK_MS : 0 })
        return { error: 'Usuario o contraseña incorrectos' }
      }
      if (u.blocked) return { error: 'Esta cuenta está bloqueada' }
      fails.delete(key)
      u.lastSeen = Date.now()
      await save()
      return tokens(u)
    },

    refresh(token) {
      const u = fromToken(token, 'urefresh')
      return u ? tokens(u) : null
    },

    /** Usuario de una petición (token de acceso) */
    auth: (token) => fromToken(token, 'user'),

    /** Usuario por id (para otras partes del servidor: packs de Minecraft, chat…) */
    user: (id) => users[id],

    async changePassword(u, current, next) {
      if (!(await bcrypt.compare(current, u.hash))) return { error: 'La contraseña actual no es correcta' }
      u.hash = await bcrypt.hash(next, BCRYPT_ROUNDS)
      u.mustChange = false
      u.tv += 1 // cierra las demás sesiones
      await save()
      return tokens(u)
    },

    async deleteMe(u, password) {
      if (!(await bcrypt.compare(password, u.hash))) return { error: 'Contraseña incorrecta' }
      await this.remove(u.id)
      return { ok: true }
    },

    /** Al borrar una cuenta, otras partes limpian lo suyo (sus chats) */
    onRemove(fn) {
      removeListeners.push(fn)
    },

    async remove(id) {
      const u = users[id]
      if (!u) return false
      for (const fn of removeListeners) await fn(id)
      // Sus amigos y quien tenía solicitudes con ella lo ven al momento
      live.notify([...u.friends, ...u.incoming, ...u.outgoing])
      for (const o of Object.values(users)) {
        o.friends = o.friends.filter((x) => x !== id)
        o.incoming = o.incoming.filter((x) => x !== id)
        o.outgoing = o.outgoing.filter((x) => x !== id)
        if (o.blocks) o.blocks = o.blocks.filter((x) => x !== id)
        delete o.nicknames?.[id]
      }
      delete users[id]
      await avatars.remove(id)
      await banners.remove(id)
      await save()
      return true
    },

    // ——— Foto de perfil ———
    async setAvatar(u, buf) {
      const version = await avatars.save(u.id, buf)
      if (!version) return { error: 'Imagen no válida' }
      u.avatar = version
      await save()
      return { ok: true, avatar: version }
    },

    async removeAvatar(u) {
      await avatars.remove(u.id)
      delete u.avatar
      await save()
      return { ok: true }
    },

    /** Banner de imagen o GIF (hasta 20 MB): pasa a ser el banner del perfil */
    async setBanner(u, buf) {
      const out = await banners.save(u.id, buf)
      if (!out) return { error: 'Imagen no válida' }
      u.profile = { ...u.profile, banner: { kind: 'image', v: out.v } }
      await save()
      live.notify([u.id, ...u.friends])
      return { ok: true, user: publicMe(u) }
    },

    async removeBanner(u) {
      await banners.remove(u.id)
      if (u.profile?.banner?.kind === 'image') delete u.profile.banner
      await save()
      live.notify([u.id, ...u.friends])
      return { ok: true, user: publicMe(u) }
    },

    /** Banner de una cuenta: solo lo ven ella misma y sus amigos */
    bannerFor(viewer, id) {
      if (viewer.id !== id && !viewer.friends.includes(id)) return null
      return users[id]?.profile?.banner?.kind === 'image' ? banners.read(id) : null
    },

    /** Foto de una cuenta: solo la ven ella misma y sus amigos */
    avatarFor(viewer, id) {
      if (viewer.id !== id && !viewer.friends.includes(id)) return null
      return users[id]?.avatar ? avatars.read(id) : null
    },

    // ——— Estado ———
    /** Latido de la app: conectado o jugando a Minecraft (qué instancia y dónde, para «Unirme») */
    async heartbeat(u, p) {
      const before = presenceOf(u)
      const prev = u.presence
      const mc = p.mc ?? null
      u.presence = {
        at: Date.now(),
        gameName: mc ? (p.gameName ?? 'Minecraft') : null,
        since: mc ? (prev?.mc?.name === mc.name && prev.since ? prev.since : Date.now()) : null,
        mc
      }
      u.lastSeen = Date.now()
      // Si cambia lo que ven sus amigos (se conecta, empieza o deja de jugar, cambia de servidor), se les avisa al momento
      const after = presenceOf(u)
      if (before.state !== after.state || JSON.stringify(before.mc) !== JSON.stringify(after.mc)) live.notify(u.friends)
      // El latido no se escribe a disco (cada 30 s por usuario sería mucho): basta con memoria. La versión de la
      // app cambia muy de vez en cuando: esa sí se guarda (la ve el admin en el panel)
      if (p.version && p.version !== u.appVersion) {
        u.appVersion = p.version
        await save()
      }
    },

    // ——— Amigos ———
    friends(u) {
      const list = (ids) => ids.map((id) => users[id]).filter(Boolean)
      return {
        friends: list(u.friends).map((f) => friendView(f, u)),
        incoming: list(u.incoming).map((f) => ({ id: f.id, username: f.username, ...(f.profile?.displayName ? { displayName: f.profile.displayName } : {}) })),
        outgoing: list(u.outgoing).map((f) => ({ id: f.id, username: f.username, ...(f.profile?.displayName ? { displayName: f.profile.displayName } : {}) })),
        // A quién has bloqueado (para ocultar sus mensajes en los grupos y poder desbloquearlo)
        blocked: list(u.blocks ?? []).map((f) => ({ id: f.id, username: f.username }))
      }
    },

    async request(u, username) {
      const o = byName(username)
      // Si te ha bloqueado, como si no existiera (no se le dice que le han bloqueado)
      if (!o || o.blocked || o.blocks?.includes(u.id)) return { error: 'No existe ese usuario' }
      if (o.id === u.id) return { error: 'No puedes añadirte a ti mismo' }
      if (u.blocks?.includes(o.id)) return { error: 'Has bloqueado a ese usuario: desbloquéalo antes' }
      if (u.friends.includes(o.id)) return { error: 'Ya sois amigos' }
      // Si el otro ya te lo había pedido, se aceptan los dos a la vez
      if (u.incoming.includes(o.id)) return this.accept(u, o.id)
      if (!u.outgoing.includes(o.id)) u.outgoing.push(o.id)
      if (!o.incoming.includes(u.id)) o.incoming.push(u.id)
      await save()
      live.notify([o.id])
      return { ok: true }
    },

    async accept(u, id) {
      const o = users[id]
      if (!o || !u.incoming.includes(id)) return { error: 'No hay ninguna solicitud de ese usuario' }
      u.incoming = u.incoming.filter((x) => x !== id)
      o.outgoing = o.outgoing.filter((x) => x !== u.id)
      if (!u.friends.includes(id)) u.friends.push(id)
      if (!o.friends.includes(u.id)) o.friends.push(u.id)
      await save()
      live.notify([o.id])
      return { ok: true }
    },

    /** Enlace de invitación: os hacéis amigos sin solicitud (el enlace ya es el «sí» de quien lo creó) */
    async befriend(u, id) {
      const o = users[id]
      if (!o || o.id === u.id || o.blocked || o.blocks?.includes(u.id) || u.blocks?.includes(o.id)) return { error: 'No existe ese usuario' }
      for (const [a, b] of [
        [u, o],
        [o, u]
      ]) {
        a.incoming = a.incoming.filter((x) => x !== b.id)
        a.outgoing = a.outgoing.filter((x) => x !== b.id)
        if (!a.friends.includes(b.id)) a.friends.push(b.id)
      }
      await save()
      live.notify([u.id, o.id])
      return { ok: true }
    },

    async decline(u, id) {
      const o = users[id]
      u.incoming = u.incoming.filter((x) => x !== id)
      u.outgoing = u.outgoing.filter((x) => x !== id)
      if (o) {
        o.outgoing = o.outgoing.filter((x) => x !== u.id)
        o.incoming = o.incoming.filter((x) => x !== u.id)
      }
      await save()
      live.notify([id])
      return { ok: true }
    },

    /** Apodo para un amigo (como en Discord o Steam): solo lo ve quien lo pone. Vacío = quitarlo */
    /** Lo que ve la propia cuenta de sí misma (con su perfil) */
    me: (u) => publicMe(u),

    /** Cambia su perfil (solo lo que llega). El nombre visible no puede ser el usuario de otra cuenta (suplantación) */
    async setProfile(u, patch) {
      const dn = patch.displayName?.trim()
      if (dn && Object.values(users).some((o) => o.id !== u.id && o.lower === dn.toLowerCase())) return { error: 'Ese nombre es el usuario de otra cuenta' }
      const old = u.profile?.banner
      // Un banner de imagen solo se encuadra: tiene que ser el que se subió
      if (patch.banner?.kind === 'image' && (old?.kind !== 'image' || old.v !== patch.banner.v)) return { error: 'Ese banner no existe' }
      // Otro banner (de color): el de imagen se borra del disco
      if (patch.banner !== undefined && patch.banner?.kind !== 'image' && old?.kind === 'image') await banners.remove(u.id)
      u.profile = mergeProfile(u.profile, patch)
      await save()
      // Sus amigos (y sus otros PCs) lo ven al momento
      live.notify([u.id, ...u.friends])
      return { ok: true, user: publicMe(u) }
    },

    async setNickname(u, id, nickname) {
      if (!u.friends.includes(id)) return { error: 'No es tu amigo' }
      if (nickname) u.nicknames = { ...u.nicknames, [id]: nickname }
      else delete u.nicknames?.[id]
      await save()
      // Tus otros PCs lo ven al momento
      live.notify([u.id])
      return { ok: true }
    },

    /**
     * Bloquear: deja de ser tu amigo (y se van las solicitudes entre los dos), ya no puede escribirte por privado ni
     * pedirte amistad, y deja de ver tu estado. En los grupos que compartáis, la app oculta sus mensajes.
     */
    async block(u, id) {
      const o = users[id]
      if (!o || o.id === u.id) return { error: 'No existe ese usuario' }
      for (const [a, b] of [
        [u, o],
        [o, u]
      ]) {
        a.friends = a.friends.filter((x) => x !== b.id)
        a.incoming = a.incoming.filter((x) => x !== b.id)
        a.outgoing = a.outgoing.filter((x) => x !== b.id)
        delete a.nicknames?.[b.id]
      }
      u.blocks = [...new Set([...(u.blocks ?? []), id])].slice(-1000)
      await save()
      live.notify([u.id, o.id])
      return { ok: true }
    },

    async unblock(u, id) {
      u.blocks = (u.blocks ?? []).filter((x) => x !== id)
      await save()
      live.notify([u.id])
      return { ok: true }
    },

    async unfriend(u, id) {
      const o = users[id]
      u.friends = u.friends.filter((x) => x !== id)
      if (o) o.friends = o.friends.filter((x) => x !== u.id)
      // Los apodos de uno a otro se van con la amistad
      delete u.nicknames?.[id]
      if (o) delete o.nicknames?.[u.id]
      await save()
      live.notify([id])
      return { ok: true }
    },

    // ——— Panel de admin ———
    adminList() {
      return Object.values(users)
        .map((u) => ({
          id: u.id,
          username: u.username,
          createdAt: u.createdAt,
          lastSeen: u.lastSeen,
          friends: u.friends.length,
          blocked: !!u.blocked,
          mustChange: !!u.mustChange,
          appVersion: u.appVersion ?? null,
          avatar: u.avatar ?? null,
          ...presenceOf(u)
        }))
        .sort((a, b) => a.username.localeCompare(b.username))
    },

    /** Ficha completa de una cuenta para el panel (nunca la contraseña: solo existe su hash) */
    adminDetail(id) {
      const u = users[id]
      if (!u) return null
      const names = (ids) => ids.map((x) => users[x]).filter(Boolean).map((o) => ({ id: o.id, username: o.username }))
      return {
        id: u.id,
        username: u.username,
        createdAt: u.createdAt,
        lastSeen: u.lastSeen,
        blocked: !!u.blocked,
        mustChange: !!u.mustChange,
        ...presenceOf(u),
        appVersion: u.appVersion ?? null,
        avatar: u.avatar ?? null,
        friends: names(u.friends),
        incoming: names(u.incoming),
        outgoing: names(u.outgoing)
      }
    },

    async adminSetCreated(id, at) {
      const u = users[id]
      if (!u) return false
      u.createdAt = at
      await save()
      void audit('created', { user: u.username, date: new Date(at).toISOString().slice(0, 10) })
      return true
    },

    async adminSetAvatar(id, buf) {
      const u = users[id]
      if (!u) return { error: 'No existe' }
      const version = await avatars.save(id, buf)
      if (!version) return { error: 'Imagen no válida' }
      u.avatar = version
      await save()
      void audit('avatar', { user: u.username })
      return { ok: true, avatar: version }
    },

    async adminRemoveAvatar(id) {
      const u = users[id]
      if (!u) return false
      await avatars.remove(id)
      delete u.avatar
      await save()
      void audit('avatarRemove', { user: u.username })
      return true
    },

    adminAvatar(id) {
      return users[id]?.avatar ? avatars.read(id) : null
    },

    /** Contraseña temporal: al entrar con ella, la app obliga a elegir otra. Cierra sus sesiones. */
    async adminSetPassword(id, temp) {
      const u = users[id]
      if (!u) return false
      u.hash = await bcrypt.hash(temp, BCRYPT_ROUNDS)
      u.mustChange = true
      u.tv += 1
      fails.delete(u.lower)
      await save()
      void audit('password', { user: u.username })
      return true
    },

    async adminRename(id, username) {
      const u = users[id]
      if (!u) return { error: 'No existe' }
      if (nameTaken(username, id)) return { error: 'Ese nombre de usuario ya existe' }
      const old = u.username
      u.username = username.trim()
      u.lower = u.username.toLowerCase()
      await save()
      void audit('rename', { from: old, to: u.username })
      return { ok: true }
    },

    async adminBlock(id, blocked) {
      const u = users[id]
      if (!u) return false
      u.blocked = blocked
      if (blocked) u.tv += 1
      await save()
      void audit(blocked ? 'block' : 'unblock', { user: u.username })
      return true
    },

    async adminLogout(id) {
      const u = users[id]
      if (!u) return false
      u.tv += 1
      await save()
      void audit('logout', { user: u.username })
      return true
    },

    /** Últimas acciones del admin sobre cuentas (lo más reciente primero) */
    async adminAudit(limit = 100) {
      const text = await readFile(auditFile, 'utf8').catch(() => '')
      return text
        .trim()
        .split('\n')
        .filter(Boolean)
        .slice(-limit)
        .reverse()
        .map((line) => {
          const [at, action, ...rest] = line.split(' ')
          let detail = {}
          try {
            detail = JSON.parse(rest.join(' '))
          } catch {
            /* línea dañada: se muestra sin detalle */
          }
          return { at, action, detail }
        })
    },

    async adminRemove(id) {
      const name = users[id]?.username
      const ok = await this.remove(id)
      if (ok) void audit('delete', { user: name })
      return ok
    }
  }
}
