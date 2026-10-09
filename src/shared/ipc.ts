import type {
  AccountResult,
  ReportBody,
  InviteLink,
  InvitePreview,
  InviteResult,
  AccountState,
  McContent,
  McContentKind,
  McError,
  McOptimizePlan,
  McIssue,
  McHit,
  McImportable,
  McLoader,
  McProjectVersion,
  McServerConfig,
  McSkinInfo,
  McSnapshot,
  McState,
  McUpdate,
  McVersion,
  McWorld,
  OverlayInfo,
  Settings
} from './types'
import type { ChatInfo, ChatMessage, ChatSend, Emote } from './chat'
import type { ProfilePatch } from './profile'
import type { CaptureItem, ClipDevices, ClipStatus } from './capture'

/** Funciones que la interfaz puede pedir al proceso principal. */
export interface Handlers {
  'app:info': () => { version: string }
  'settings:get': () => Settings
  'settings:set': (patch: Partial<Settings>) => Settings
  'settings:pickDir': (current: string) => string | null
  // ——— Chat entre amigos ———
  'chat:list': () => ChatInfo[]
  /** Abre (o crea) el privado con un amigo */
  'chat:dm': (userId: string) => ChatInfo | null
  'chat:group': (name: string, icon: string | null, members: string[]) => ChatInfo | null
  'chat:patch': (id: string, patch: { name?: string; icon?: string }) => boolean
  'chat:addMembers': (id: string, ids: string[]) => boolean
  'chat:removeMember': (id: string, user: string) => boolean
  'chat:messages': (id: string, opts: { before?: number; after?: number }) => { messages: ChatMessage[]; more: boolean } | null
  'chat:send': (id: string, body: ChatSend) => { message?: ChatMessage; error?: string }
  'chat:edit': (id: string, mid: number, text: string) => ChatMessage | null
  'chat:delete': (id: string, mid: number) => ChatMessage | null
  'chat:react': (id: string, mid: number, emoji: string) => ChatMessage | null
  'chat:pin': (id: string, mid: number) => number[] | null
  'chat:read': (id: string, mid: number) => void
  'chat:reads': (id: string) => Record<string, number>
  'chat:typing': (id: string) => void
  /** El chat que tienes abierto (sus mensajes no avisan) */
  'chat:focus': (id: string | null) => void
  /** GIFs o stickers de KLIPY; null si el servidor no tiene KLIPY */
  /** Invitar a tu partida (juego o Minecraft con mundo abierto o servidor) a chats o amigos */
  'chat:invite': (to: { chats?: string[]; friends?: string[] }) => { sent: number; error?: 'notPlaying' | 'send' }
  /** Emotes de 7TV (y globales de BetterTTV) por nombre; null si no responden */
  'chat:emotes': (q: string, page?: number) => { items: Emote[]; more: boolean } | null
  /** Tus stickers subidos (ids) */
  'chat:stickers': () => string[]
  'chat:stickerAdd': (bytes: Uint8Array) => { id?: string; error?: 'too-big' | 'invalid' | 'full' | 'offline' }
  'chat:stickerRemove': (id: string) => boolean
  'chat:gifs': (q: string, kind?: 'gifs' | 'stickers') => { id: string; preview: string; url: string; w: number; h: number }[] | null | 'limit'
  /** El menú dentro del juego: a qué se juega, cerrarlo, abrirlo (pruebas) y los FPS de ahora mismo */
  'overlay:info': () => OverlayInfo
  'overlay:close': () => void
  /** La interfaz del menú ya ha pintado: se puede enseñar la ventana (sin parpadeo) */
  'overlay:ready': () => void
  'overlay:toggle': () => void
  /** Capturas y clips guardados (lo más nuevo primero); hacer una captura (pruebas) */
  'capture:list': () => CaptureItem[]
  'capture:shot': () => CaptureItem | null
  /** Clips: cómo van, guardar uno (pruebas) y lo que manda la ventana oculta del audio del sistema */
  'capture:status': () => ClipStatus
  'capture:clip': () => CaptureItem | null
  'capture:pcm': (chunk: Uint8Array) => void
  'capture:audioFailed': (why: string) => void
  'capture:openFolder': (kind: 'pictures' | 'videos') => void
  /** Pantallas y salidas de audio que se pueden grabar en los clips */
  'capture:devices': () => ClipDevices
  /** Compartir una captura o un clip en un chat (se sube y se manda; con texto, si lo había escrito) */
  'chat:share': (chatId: string, captureId: string, text?: string) => { message?: ChatMessage; error?: 'gone' | 'too-big' | 'full' | 'offline' | 'invalid' | 'limit' | 'forbidden' }
  'system:checkUpdate': () => { available: boolean; version?: string }
  'system:installUpdate': () => void
  'account:get': () => AccountState
  'account:login': (username: string, password: string) => AccountResult
  /** accept: casilla de «14 años o más y acepto los términos y la privacidad» (sin ella no se crea) */
  'account:register': (username: string, password: string, accept: boolean) => AccountResult
  'account:block': (userId: string) => AccountResult
  'account:unblock': (userId: string) => AccountResult
  'account:report': (body: ReportBody) => AccountResult
  /** Enlaces de invitación: el tuyo (de amistad, o de una instancia que se comparte en un pack), anularlo, verlo y aceptarlo */
  'invite:create': (instanceId: string | null) => InviteLink | null
  'invite:revoke': (code: string) => boolean
  'invite:preview': (code: string) => InvitePreview | null | 'offline'
  'invite:accept': (code: string) => InviteResult
  /** El enlace con el que se abrió la app (una vez) */
  'invite:take': () => string | null
  'account:logout': () => void
  'account:password': (current: string, next: string) => AccountResult
  'account:delete': (password: string) => AccountResult
  /** Foto de perfil: subir la tuya (WebP ya recortado), quitarla y traer la de una cuenta (en caché por versión) */
  'account:setAvatar': (dataUrl: string) => AccountResult
  'account:removeAvatar': () => AccountResult
  /** Cambia tu perfil personalizado (solo lo que llega) */
  'account:setProfile': (patch: ProfilePatch) => AccountResult
  /** Banner de imagen o GIF (hasta 20 MB) */
  'account:setBanner': (bytes: Uint8Array) => AccountResult
  'account:removeBanner': () => AccountResult
  'account:avatar': (userId: string, version: string) => string | null
  'account:addFriend': (username: string) => AccountResult
  'account:answerFriend': (id: string, accept: boolean) => AccountResult
  'account:removeFriend': (id: string) => AccountResult
  /** Apodo para un amigo (vacío = quitarlo) */
  'account:nickname': (id: string, nickname: string) => AccountResult
  /** Minecraft (beta): instancias, cuentas y jugar */
  'mc:get': () => McState
  'mc:versions': () => McVersion[]
  /** Versiones de un loader para esa versión de Minecraft (la recomendada primero) */
  'mc:loaderVersions': (loader: Exclude<McLoader, 'vanilla'>, mc: string) => { id: string; stable: boolean }[]
  'mc:create': (name: string, version: string, loader?: McLoader, loaderVersion?: string) => string
  'mc:update': (id: string, patch: { name?: string; ramMB?: number | null; autoBackup?: boolean; shareSettings?: boolean }) => void
  /** Copia de la instancia (con o sin sus mundos); devuelve la nueva */
  'mc:duplicate': (id: string, withWorlds: boolean) => string
  'mc:delete': (id: string) => void
  'mc:openFolder': (id: string) => void
  /** Lo que escribió el juego la última vez (para ver por qué falló) */
  'mc:log': (id: string) => string
  'mc:addOffline': (name: string) => { ok: boolean; error?: McError }
  /** Abre la página de Microsoft en una ventana de la app y espera a que termines */
  'mc:addMicrosoft': () => { ok: boolean; error?: McError }
  'mc:cancelLogin': () => void
  'mc:removeAccount': (id: string) => void
  'mc:setAccount': (id: string) => void
  /** Instala lo que falte y abre el juego con la cuenta activa */
  'mc:play': (id: string) => { ok: boolean; error?: McError }
  'mc:cancel': () => void
  'mc:stop': () => void
  /** Contenido de una instancia (mods, resource packs, shaders) */
  'mc:content': (id: string) => McContent[]
  /** Buscar en Modrinth (con instancia: solo lo que vale para ella) */
  'mc:search': (
    id: string | null,
    q: string,
    kind: McContentKind | 'modpack',
    sort: 'relevance' | 'downloads' | 'updated' | 'newest',
    offset: number
  ) => { hits: McHit[]; total: number }
  'mc:install': (id: string, projectId: string, kind: McContentKind, versionId?: string) => McResult
  'mc:projectVersions': (id: string, projectId: string, kind: McContentKind) => McProjectVersion[]
  'mc:updates': (id: string) => McUpdate[]
  /** Poner estas versiones: actualizar (uno o todos) o bajar de versión */
  'mc:setVersions': (id: string, versionIds: string[], downgrade: boolean) => McResult
  'mc:remove': (id: string, files: string[], orphans: boolean) => McResult
  'mc:toggle': (id: string, files: string[], enabled: boolean) => McResult
  'mc:toggleTag': (id: string, tag: string, enabled: boolean) => McResult
  'mc:editContent': (id: string, file: string, patch: { locked?: boolean; tags?: string[] }) => McContent[]
  'mc:history': (id: string) => McSnapshot[]
  'mc:rollback': (id: string, at: number) => McResult
  /** Mundos de la instancia y sus copias */
  'mc:worlds': (id: string) => McWorld[]
  'mc:backupWorld': (id: string, world: string) => { ok: boolean }
  'mc:restoreWorld': (id: string, world: string, at: number) => { ok: boolean; error?: McError }
  'mc:deleteBackup': (id: string, world: string, at: number) => void
  'mc:openBackups': (id: string, world: string) => void
  /** Modpacks: importar un .mrpack del disco, instalar uno de Modrinth, exportar la instancia o su pack de servidor */
  'mc:importPack': () => { ok: boolean; id?: string; error?: McError }
  'mc:installModpack': (projectId: string, versionId?: string) => { ok: boolean; id?: string; error?: McError }
  /** Traer instancias de otros launchers: las que hay en este PC, y traer las elegidas (con o sin sus mundos) */
  'mc:importScan': () => McImportable[]
  /** `disabled`: mods de Modrinth que no son para su versión o su loader, que se han dejado desactivados */
  'mc:importRun': (keys: string[], worlds: boolean) => { key: string; id?: string; error?: McError; disabled?: string[] }[]
  'mc:exportPack': (id: string) => { ok: boolean }
  'mc:exportServer': (id: string) => { ok: boolean }
  /** Explicador de crasheos: aplicar el arreglo de una causa, o descartar el aviso */
  'mc:fixCrash': (id: string, index: number) => McResult
  'mc:dismissCrash': (id: string) => void
  /** Amigos: compartir la instancia (crea el pack la primera vez) e invitar, salir, contestar a una invitación,
   * ponerse al día con el grupo, volver atrás todo el grupo y unirse a la partida de un amigo */
  'mc:share': (id: string, friendIds: string[]) => { ok: boolean; error?: McError }
  'mc:leavePack': (id: string) => { ok: boolean; error?: McError }
  'mc:answerPack': (packId: string, accept: boolean) => { ok: boolean; error?: McError; id?: string }
  'mc:applyPack': (id: string) => McResult
  'mc:rollbackPack': (id: string, rev: number) => McResult
  /** Antes de jugar: lo que haría que el juego se cerrara, y arreglarlo todo */
  'mc:preflight': (id: string) => McIssue[]
  'mc:fixIssues': (id: string) => { ok: boolean; error?: McError }
  /** «Optimizar»: qué mods de rendimiento valen (null sin conexión) e instalarlos (vanilla: en una copia en Fabric) */
  'mc:optimizePlan': (id: string) => McOptimizePlan | null
  'mc:optimize': (id: string, projectIds: string[]) => { ok: boolean; id?: string; error?: McError }
  'mc:joinFriend': (friendId: string) => { ok: boolean; error?: McError; id?: string }
  /** Instalar en este PC un pack tuyo que está en la nube */
  'mc:installFromCloud': (packId: string) => { ok: boolean; error?: McError; id?: string }
  /** Quitar de la nube un pack que no está en este PC (sales de él; si eras el último, se borra) */
  'mc:removeCloudPack': (packId: string) => { ok: boolean; error?: McError }
  /** El EULA de Minecraft en tu navegador */
  'mc:openEula': () => void
  /** Skin y capa de una cuenta Microsoft (null si no se ha podido leer) */
  'mc:skin': (accountId: string) => McSkinInfo | null
  'mc:setSkin': (accountId: string, pngDataUrl: string, variant: 'classic' | 'slim') => McSkinInfo | null
  'mc:resetSkin': (accountId: string) => McSkinInfo | null
  'mc:setCape': (accountId: string, capeId: string | null) => McSkinInfo | null
  /** Servidor en tu PC a partir de una instancia: configurarlo (con el EULA aceptado), arrancar, parar, consola */
  'mc:serverSetup': (id: string, cfg: Pick<McServerConfig, 'online' | 'ramMB' | 'motd' | 'world'>) => void
  'mc:serverStart': (id: string) => { ok: boolean; error?: McError; params?: Record<string, string> }
  'mc:serverStop': (id: string) => void
  'mc:serverCommand': (id: string, line: string) => void
  'mc:serverLog': (id: string) => string[]
  'mc:serverOpenFolder': (id: string) => void
  /** Entrar tú mismo en tu servidor */
  'mc:playOwnServer': (id: string) => { ok: boolean; error?: McError }
  'app:quit': () => void
  /** Enlace de fuera (de un comentario) en el navegador del usuario */
  'app:openLink': (url: string) => void
  /** Política de privacidad o términos (en el servidor de PoxiLauncher), en el navegador */
  'app:openLegal': (page: 'privacidad' | 'terminos') => void
  'window:minimize': () => void
  /** Foto de la ventana (JPEG), para las transiciones */
  'window:capture': () => Uint8Array | null
  'window:maximize': () => void
  'window:close': () => void
  'window:fullscreen': (on: boolean) => void
}

export type McResult = { ok: boolean; error?: McError; missing?: string[] }

export type Channel = keyof Handlers

/** Eventos que el proceso principal empuja a la interfaz. */
export interface PushEvent {
  chats: ChatInfo[]
  /** Algo pasó en un chat: mensaje nuevo, cambio en uno, leído, «escribiendo…» */
  chatEvent: { what: 'chat' | 'chatEdit' | 'chatRead' | 'typing' | 'chats'; chat: string; id?: number; user?: string }
  /** Mensaje nuevo con la app a la vista (aviso dentro de la app) */
  chatToast: { chat: string; from: string; title: string; text: string }
  /** Suena el aviso de un mensaje nuevo */
  chatSound: null
  /** Pulsaste la notificación de un mensaje: abrir ese chat */
  chatOpen: string
  /** Se ha abierto un enlace de invitación (su código) */
  invite: string
  settings: Settings
  /** Se abre o se cierra el menú dentro del juego */
  overlay: { open: boolean; info?: OverlayInfo }
  /** Cambió la lista de capturas y clips */
  captures: CaptureItem[]
  clipStatus: ClipStatus
  /** Progreso al actualizar la app */
  update: { state: 'downloading' | 'error'; version: string; progress: number }
  /** key = clave i18n; la interfaz traduce */
  toast: {
    kind: 'info' | 'success' | 'error'
    key: string
    params?: Record<string, string>
  }
  account: AccountState
  minecraft: McState
  /** Código del inicio de sesión de Microsoft (por si la página lo vuelve a pedir); null al terminar */
  minecraftCode: { code: string | null }
  /** Contenido de una instancia tras un cambio */
  minecraftContent: { instanceId: string; items: McContent[] }
  /** Descargando contenido: paso actual de total */
  minecraftTask: { instanceId: string; done: number; total: number }
  /** Una línea nueva en la consola de un servidor */
  minecraftServerLog: { instanceId: string; line: string }
  /** Botones atrás/adelante del ratón cuando Windows los manda como orden (app-command) */
  nav: { dir: 'back' | 'forward' }
}

