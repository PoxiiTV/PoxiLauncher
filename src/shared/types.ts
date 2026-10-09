import type { ClipFps, ClipQuality, ClipSeconds } from './capture'
import type { Badge, UserProfile } from './profile'
export type Accent = 'violet' | 'blue' | 'emerald' | 'pink' | 'amber' | 'red'
export type Lang = 'es' | 'en'

export interface Settings {
  accent: Accent
  lang: Lang
  startWithWindows: boolean
  notifications: boolean
  minimizeWhilePlaying: boolean
  /** Última versión cuyas novedades se enseñaron */
  lastSeenVersion?: string
  /** false solo la primera vez (sin ajustes guardados): la app pregunta el idioma al abrirse */
  langAsked?: boolean
  /** Ya se ofreció traer las instancias de otros launchers (se ofrece una sola vez) */
  importOffered?: boolean
  /** Mostrar en Discord que estás en el launcher y a qué instancia juegas */
  discordPresence: boolean
  /** Avisar cuando un amigo empieza a jugar */
  friendAlerts: boolean
  /** Atajo del menú dentro del juego (por defecto Mayús+F1) */
  overlayHotkey: string
  /** Captura (pulsar) y clip (mantener 3 s): por defecto F12 */
  shotHotkey: string
  /** Grabar de fondo los últimos segundos mientras juegas (para los clips). Apagado por defecto */
  clips: boolean
  clipSeconds: ClipSeconds
  clipQuality: ClipQuality
  clipFps: ClipFps
  /** Con el sonido del PC */
  clipAudio: boolean
  /** Pantalla que se graba: su nombre de Windows («\\.\DISPLAY2»); vacío = la principal */
  clipScreen: string
  /** Salida de audio que se graba (id de Windows); vacío = la predeterminada */
  clipAudioDevice: string
  /** Chat: avisos de mensajes, su sonido, chats silenciados y su aspecto */
  chatNotify: boolean
  chatSounds: boolean
  chatMuted: string[]
  chatStyle: ChatStyle
}

/** Aspecto del chat (lo eliges tú; solo en tu PC) */
export interface ChatStyle {
  /** Lista como Discord o burbujas como WhatsApp */
  layout: 'list' | 'bubbles'
  density: 'cozy' | 'compact'
  size: 's' | 'm' | 'l'
  /** Color de tus burbujas y de los detalles */
  accent: string
  /** Fondo: ninguno, un color o degradado, o el banner de un juego */
  bg: { kind: 'none' } | { kind: 'color'; colors: string[] }
  avatars: boolean
  time24: boolean
}

// ——— Cuenta y amigos ———
export interface Me {
  id: string
  username: string
  /** Entró con una contraseña temporal del admin: tiene que elegir otra */
  mustChange: boolean
  /** Alta de la cuenta (ms) */
  createdAt?: number
  /** Versión de tu foto de perfil (null: sin foto) */
  avatar?: string | null
  /** Tu perfil personalizado y tus insignias */
  profile?: UserProfile
  badges?: Badge[]
}

export interface Friend {
  id: string
  username: string
  state: 'offline' | 'online' | 'playing'
  /** Lo que se ve de su partida («Minecraft 1.21.8») */
  gameName?: string
  /** Desde cuándo juega (ms) */
  since?: number
  /** Alta de su cuenta (ms) */
  createdAt?: number
  /** Versión de su foto de perfil (null: sin foto) */
  avatar?: string | null
  /** Jugando a Minecraft: qué instancia y dónde (para "Unirme") */
  mc?: McPresence
  /** Apodo que le has puesto (solo lo ves tú). Con apodo o nombre visible, `username` es el que se ve y `realName` su usuario */
  nickname?: string
  realName?: string
  /** Su perfil personalizado y sus insignias */
  profile?: UserProfile
  badges?: Badge[]
}

/** Lo que ven tus amigos cuando juegas a Minecraft */
export interface McPresence {
  name: string
  version: string
  loader: McLoader
  /** Pack compartido de esa instancia (si lo es) */
  packId?: string
  /** Servidor en el que está */
  server?: { host: string; port: number }
  /** Túnel de PoxiLauncher a su mundo o su servidor (sus amigos entran sin abrir puertos) */
  tunnel?: string
  /** Juega con cuenta Microsoft (a su mundo abierto a LAN solo entran cuentas Microsoft) */
  premium?: boolean
}

export interface AccountState {
  user: Me | null
  friends: Friend[]
  /** Solicitudes de amistad recibidas y enviadas */
  incoming: { id: string; username: string; displayName?: string }[]
  outgoing: { id: string; username: string; displayName?: string }[]
  /** A quién has bloqueado (sus mensajes en los grupos salen ocultos) */
  blocked?: { id: string; username: string }[]
  /** No se llega al servidor (se sigue intentando) */
  offline: boolean
}

/** Tu enlace de invitación (de amistad o de un pack) */
export interface InviteLink {
  code: string
  url: string
  pack: string | null
  expires: number
  uses: number
  max: number
}
/** Lo que enseña un enlace antes de aceptarlo */
export interface InvitePreview {
  by: { id: string; username: string; displayName: string | null }
  pack: { id: string; name: string; mc: string; loader: McLoader; icon: string | null; mods: number; members: number; full: boolean } | null
  expires: number
}
/** Al aceptar: con quién (amigos ya), la instancia del pack y si se entró directo a su partida */
export interface InviteResult {
  ok: boolean
  /** Clave i18n */
  error?: string
  id?: string
  friend?: string
  full?: boolean
  joined?: boolean
}

/** Motivo de una denuncia (el servidor tiene la misma lista) */
export type ReportReason = 'spam' | 'harassment' | 'inappropriate' | 'impersonation' | 'other'
/** Denunciar un mensaje (con su chat) o una cuenta */
export type ReportBody = { kind: 'message' | 'user'; user: string; chat?: string; message?: number; reason: ReportReason; text?: string }

export type AccountError = 'credentials' | 'locked' | 'taken' | 'invalid' | 'current' | 'noUser' | 'offline' | 'tooMany'
export type AccountResult = { ok: boolean; error?: AccountError }

/** El menú dentro del juego: a qué se juega, desde cuándo y con qué atajo se abre */
export interface OverlayInfo {
  game: { kind: 'mc'; id: null; name: string } | null
  startedAt: number
  hotkey: string
}

// ——— Minecraft ———
export interface McAccount {
  id: string
  kind: 'msa' | 'offline'
  name: string
  uuid: string
  /** Skin (solo cuentas Microsoft): dirección de la textura */
  skin: string | null
}

export type McLoader = 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge'

export interface McInstance {
  id: string
  name: string
  /** Versión oficial de Minecraft ("1.21.8", "26.3"…) */
  version: string
  loader: McLoader
  /** Versión del loader (sin loader: no hay) */
  loaderVersion?: string
  /** Icono (el del modpack de Modrinth del que salió) */
  icon?: string | null
  createdAt: number
  lastPlayed: number | null
  /** Segundos jugados */
  playtime: number
  /** RAM para el juego (MB); null = automática */
  ramMB: number | null
  /** Copia de los mundos al jugar (por defecto, sí) */
  autoBackup?: boolean
  /** Opciones, teclas y servidores compartidos con las demás instancias que también lo tengan (por defecto, sí) */
  shareSettings?: boolean
  /** Último cierre inesperado del juego, con su explicación */
  crash?: McCrash | null
  /** Pack compartido con amigos al que está unida */
  packId?: string
  /** Modpack instalándose: si la app se cierra a medias, al volver se borra (no queda una instancia rota) */
  incomplete?: boolean
  /** Servidor en tu PC a partir de esta instancia */
  server?: McServerConfig
  /** Traída de otro launcher: de dónde (la `key` de McImportable), para no traerla dos veces sin querer */
  importedFrom?: string
}

/** Una instancia de otro launcher que se puede traer */
export interface McImportable {
  /** Su origen (launcher, carpeta y perfil) */
  key: string
  launcher: 'official' | 'curseforge' | 'prism' | 'modrinth'
  name: string
  /** Versión de Minecraft ('' si no se sabe) */
  version: string
  loader: McLoader
  loaderVersion?: string
  mods: number
  /** Lo que se copia sin los mundos (bytes) */
  size: number
  worlds: number
  worldsSize: number
  /**
   * Perfil del launcher oficial que comparte carpeta con otro usado después: sale sin marcar. `mods`: también
   * comparte los mods (los dos llevan loader), que serán de la versión del otro
   */
  shares?: { name: string; mods: boolean }
  /** No se puede traer: por qué (clave i18n) */
  unsupported?: 'mc.import.why.version' | 'mc.import.why.meta'
  /** Ya traída antes: la instancia */
  imported?: string
}

export interface McServerConfig {
  /** online-mode: solo cuentas Microsoft (si no, también sin conexión) */
  online: boolean
  ramMB: number
  motd: string
  /** Mundo: uno nuevo, una copia de uno tuyo (su carpeta en saves/) o el del grupo (instancias compartidas) */
  world: 'new' | 'group' | { copy: string }
  /** Cuándo aceptó el EULA de Minecraft quien lo creó */
  eulaAt: number
  /** Versión del mundo del grupo que tiene este PC */
  worldRev?: number
  /** Para qué versión y loader está instalado, y cómo se arranca */
  installedFor?: string
  args?: string[]
}

/** Servidor en marcha */
export interface McServerState {
  state: 'installing' | 'starting' | 'running' | 'stopping'
  port?: number
  players: string[]
  /** Tus amigos pueden entrar desde PoxiLauncher */
  tunnel: boolean
}

/** Un elemento de un pack compartido (siempre de Modrinth) */
export interface McPackItem {
  kind: McContentKind
  projectId: string
  versionId: string
  title: string
  file: string
}

/** Pack de Minecraft compartido con amigos (lo guarda nuestro servidor) */
export interface McPack {
  id: string
  name: string
  mc: string
  loader: McLoader
  loaderVersion: string | null
  icon: string | null
  rev: number
  items: McPackItem[]
  owner: { id: string; username: string }
  /** Te han invitado y aún no has contestado */
  invited: boolean
  members: { id: string; username: string }[]
  pending: { id: string; username: string }[]
  history: { rev: number; at: number; by: { id: string; username: string }; note: { key: string; params?: Record<string, string> }; count: number }[]
  /** Mundo del grupo guardado en el servidor de PoxiLauncher */
  world: { rev: number; size: number; at: number; by: { id: string; username: string } } | null
  /** Quién lo está alojando ahora */
  lock: { by: { id: string; username: string }; at: number } | null
}

/** Lo que cambiaría al ponerte al día con el pack del grupo */
export interface McPackDiff {
  add: McPackItem[]
  remove: { projectId: string; title: string }[]
  change: (McPackItem & { from: string })[]
}

export interface McVersion {
  id: string
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha'
  releaseTime: string
}

export type McContentKind = 'mod' | 'resourcepack' | 'shader'

/** Un mod, resource pack o shader de una instancia */
export interface McContent {
  kind: McContentKind
  /** Nombre del archivo (activado; desactivado lleva además ".disabled" en disco) */
  file: string
  enabled: boolean
  sha1: string
  size: number
  title: string
  /** De Modrinth (sin esto: puesto a mano y no reconocido) */
  projectId?: string
  versionId?: string
  /** Versión del mod ("0.6.13") */
  version?: string
  icon?: string | null
  /** No se actualiza con "Actualizar todo" */
  locked?: boolean
  /** Se instaló porque otro lo necesitaba */
  dependency?: boolean
  /** Proyectos de Modrinth que necesita */
  requires?: string[]
  tags?: string[]
  /** Dónde hace falta (Modrinth): para el pack de servidor */
  client?: string
  server?: string
}

/** Antes de jugar: algo que haría que el juego se cerrara, y cómo se arregla */
export interface McIssue {
  kind: 'missingDep' | 'disabledDep' | 'duplicate' | 'wrongVersion' | 'incompatible'
  /** El mod afectado */
  mod: string
  /** La dependencia o el mod con el que choca (en missingDep, su nombre si se conoce; si no, su id) */
  other?: string
  fix: 'install' | 'enable' | 'disable' | 'update'
  files?: string[]
  projectId?: string
}

/** «Optimizar»: un mod de rendimiento y qué pasa con él (add = se instala) */
export interface McOptimizeItem {
  projectId: string
  /** Clave i18n de su explicación (mc.optimize.mods.<key>) */
  key: string
  title: string
  status: 'add' | 'have' | 'none' | 'conflict'
  versionId?: string
  /** Con qué choca */
  with?: string
}
export interface McOptimizePlan {
  /** Vanilla: se hace una copia en Fabric con los mods (la original no se toca) */
  vanilla: boolean
  items: McOptimizeItem[]
  /** RAM automática para el juego (MB) */
  ramMB: number
}

/** Una foto del contenido de la instancia (antes de cada cambio) */
export interface McSnapshot {
  at: number
  /** Qué se iba a hacer (clave i18n y datos) */
  key: string
  params?: Record<string, string>
  count: number
}

export interface McUpdate {
  file: string
  title: string
  from: string
  to: string
  versionId: string
}

export interface McHit {
  id: string
  slug: string
  title: string
  description: string
  icon: string | null
  downloads: number
  author: string
  categories: string[]
  updated: string
}

export interface McProjectVersion {
  id: string
  name: string
  number: string
  type: 'release' | 'beta' | 'alpha'
  date: string
  loaders: string[]
}

export interface McWorldBackup {
  at: number
  /** Hecha sola al jugar (si no, a mano) */
  auto: boolean
  size: number
}

export interface McWorld {
  /** Nombre de la carpeta en saves/ */
  id: string
  lastPlayed: number
  size: number
  /** icon.png del mundo (data URL) */
  icon: string | null
  backups: McWorldBackup[]
}

/** Por qué se ha cerrado el juego y cómo arreglarlo (explicador de crasheos) */
export interface McCrash {
  at: number
  causes: {
    key: string
    params?: Record<string, string>
    fix?: { type: 'install' | 'disable'; modId: string } | { type: 'version'; modId: string; want: string } | { type: 'ram' | 'drivers' | 'log' }
  }[]
}

/** Skin y capas de una cuenta Microsoft */
export interface McSkinInfo {
  skin: { url: string; variant: 'classic' | 'slim' } | null
  capes: { id: string; alias: string; url: string; active: boolean }[]
}

export type McBusyStage = 'game' | 'java' | 'loader' | 'backup' | 'modpack' | 'import' | 'launching'

export interface McState {
  accounts: McAccount[]
  activeAccount: string | null
  instances: McInstance[]
  /** RAM automática para este PC (MB) */
  autoRamMB: number
  /** Instalando o arrancando: qué instancia y cómo va */
  busy: { instanceId: string; stage: McBusyStage; done: number; total: number } | null
  /** Instancia con el juego abierto */
  running: string | null
  /** Se puede iniciar sesión con Microsoft (hay client ID) */
  msa: boolean
  /** Packs compartidos con amigos (en los que estás o a los que te invitan) */
  packs: McPack[]
  /** Cambios del grupo pendientes de aplicar, por instancia */
  packDiffs: Record<string, McPackDiff>
  /** Servidores en marcha, por instancia */
  servers: Record<string, McServerState>
}

export type McError =
  | 'mc.auth.failed'
  | 'mc.auth.cancelled'
  | 'mc.auth.expired'
  | 'mc.auth.noGame'
  | 'mc.auth.noXbox'
  | 'mc.auth.region'
  | 'mc.auth.ageProof'
  | 'mc.auth.child'
  | 'mc.noAccount'
  | 'mc.busy'
  | 'mc.installFailed'
  | 'mc.launchFailed'
  | 'mc.nameTaken'
  | 'mc.running'
  | 'mc.noVersion'
  | 'mc.downloadFailed'
  | 'mc.badPack'
  | 'mc.share.failed'
  | 'mc.join.notPlaying'
  | 'mc.join.needsPack'
  | 'mc.join.needsPremium'
  | 'mc.join.tunnelFailed'
  | 'mc.server.failed'
  | 'mc.server.unsupported'
  | 'mc.server.worldLocked'
  | 'mc.server.worldFailed'
  | 'mc.import.noSpace'
  | 'mc.import.failed'
