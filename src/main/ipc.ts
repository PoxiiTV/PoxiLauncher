import { BrowserWindow, dialog, ipcMain, app, type OpenDialogOptions } from 'electron'
import { z } from 'zod'
import type { Handlers } from '@shared/ipc'
import { closeOverlay, overlayInfo, overlayReady, toggleOverlay } from './overlay/service'
import { captures, openCaptureFolder, screenshot } from './capture/service'
import { audioFailed, clipDevices, clipStatus, pushPcm, saveClip } from './capture/recorder'
import { shareCapture } from './capture/share'
import { getSettings, setSettings, settingsPatch } from './settings'
import { checkUpdate, installUpdate, quitNow } from './system'
import {
  addFriend,
  answerFriend,
  changePassword,
  deleteAccount,
  avatarOf,
  removeAvatar,
  setProfile,
  setBanner,
  removeBanner,
  setAvatar,
  getAccount,
  login,
  logout,
  register,
  removeFriend,
  setNickname,
  blockUser,
  unblockUser,
  report
} from './account/service'
import { answerPack, applyPack, installFromCloud, joinFriend, leavePack, removeCloudPack, rollbackPack, sharePack } from './minecraft/share'
import { openAsUser } from './system/browser'
import { UPDATE_BASE } from './net'
import { acceptInvite, createInvite, previewInvite, revokeInvite, takeInvite } from './invites'
import { serverCommand, serverLog, setupServer, startHosting, stopHosting } from './minecraft/hosting'
import {
  addMicrosoftAccount,
  addOfflineAccount,
  cancelInstall,
  cancelMicrosoftLogin,
  createInstance,
  deleteInstance,
  dismissCrash,
  duplicateInstance,
  exportInstancePack,
  exportInstanceServer,
  fixCrash,
  importPackFile,
  installModpack,
  mcBackupWorld,
  openServerFolder,
  playOwnServer,
  mcResetSkin,
  mcSetCape,
  mcSetSkin,
  mcSkin,
  mcDeleteBackup,
  mcOpenBackups,
  mcRestoreWorld,
  mcWorlds,
  getMinecraft,
  instanceLog,
  mcContent,
  mcEditContent,
  mcHistory,
  mcInstall,
  mcOptimize,
  mcOptimizePlan,
  mcPreflight,
  mcFixIssues,
  mcLoaderVersions,
  mcProjectVersions,
  mcRemove,
  mcRollback,
  mcSearch,
  mcSetVersions,
  mcToggle,
  mcToggleTag,
  mcUpdates,
  mcVersions,
  openInstanceFolder,
  playInstance,
  removeAccount,
  setActiveAccount,
  stopInstance,
  updateInstance
} from './minecraft/service'
import { FRAMES, MAX_ABOUT, MAX_BANNER, MAX_CUSTOM, MAX_DISPLAY, MAX_PRONOUNS, NAME_EFFECTS, NAME_FONTS } from '@shared/profile'
import { gifs, addMembers, addSticker, emotes, sendInvite, MAX_STICKER, myStickers, removeSticker, createGroup, deleteMessage, editMessage, focusChat, getChats, markRead, messages, openDm, patchGroup, pin, react, reads, removeMember, sendMessage, typing } from './chat/service'

// Cambios del perfil personalizado (el servidor vuelve a validarlo todo)
const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i)
const profilePatch = z
  .object({
    displayName: z.string().max(MAX_DISPLAY),
    pronouns: z.string().max(MAX_PRONOUNS),
    about: z.string().max(MAX_ABOUT),
    name: z.object({ colors: z.array(hexColor).min(1).max(2), effect: z.enum(NAME_EFFECTS), font: z.enum(NAME_FONTS) }).nullable(),
    banner: z
      .union([
        z.object({ kind: z.literal('color'), colors: z.array(hexColor).min(1).max(2) }),
        z.object({ kind: z.literal('image'), v: z.string().regex(/^[0-9a-f]{16}$/), x: z.number().min(0).max(100), y: z.number().min(0).max(100), zoom: z.number().min(1).max(3) })
      ])
      .nullable(),
    theme: z.array(hexColor).length(2).nullable(),
    frame: z.enum(FRAMES),
    custom: z.object({ emoji: z.string().max(16), text: z.string().max(MAX_CUSTOM), until: z.number().int().nullable() }).nullable(),
    plate: z.array(hexColor).min(1).max(2).nullable()
  })
  .partial()
  .strict()

const id = z.number().int().positive()
const uuid = z.string().uuid()
// Mensaje del chat (el servidor lo vuelve a validar todo)
const KLIPY = /^https:\/\/([a-z0-9-]+\.)*klipy\.com\/[\w\-./%]+$/i
const chatBody = z
  .object({
    text: z.string().max(4000).optional(),
    reply: z.number().int().positive().optional(),
    gif: z.object({ url: z.string().max(500).regex(KLIPY), w: z.number().int().min(1).max(4096), h: z.number().int().min(1).max(4096) }).strict().optional(),
    sticker: z
      .union([
        z.object({ kind: z.literal('pack'), code: z.string().regex(/^[0-9a-f]{2,6}(_[0-9a-f]{2,6}){0,3}$/) }).strict(),
        z.object({ kind: z.literal('klipy'), url: z.string().max(500).regex(KLIPY) }).strict(),
        z.object({ kind: z.literal('user'), owner: z.string().uuid(), id: z.string().regex(/^[a-f0-9]{16}$/) }).strict()
      ])
      .optional(),
    invite: z
      .object({ kind: z.literal('mc'), name: z.string().min(1).max(60), version: z.string().max(24), loader: z.enum(['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']), where: z.string().max(80).optional() })
      .strict()
      .optional()
  })
  .strict()
// (una captura o un clip no se manda así: se sube y se manda en main, con chat:share)
// Mismas reglas que el servidor (que vuelve a comprobarlo todo)
const username = z.string().trim().regex(/^[a-zA-Z0-9_.]{3,20}$/)
const loginName = z.string().trim().min(1).max(40)
const secret = z.string().min(1).max(200)
const newSecret = z.string().min(8).max(200)
const friendId = z.string().uuid()
const inviteCode = z.string().regex(/^[A-HJKMNP-Z2-9]{8}$/)
// Minecraft: ids de 8 caracteres hexadecimales; versiones oficiales ("1.21.8", "26.3", "25w14a", "b1.7.3"…)
const mcId = z.string().regex(/^[a-f0-9]{8}$/)
const mcVersion = z.string().regex(/^[\w.+ -]{1,40}$/)
const mcName = z.string().trim().min(1).max(40)
const mcRam = z.number().int().min(1024).max(65536).nullable()
const mcLoader = z.enum(['fabric', 'quilt', 'forge', 'neoforge'])
const mcLoaderVersion = z.string().regex(/^[\w.+-]{1,60}$/)
// Modrinth: ids de 8 caracteres (base62)
const mrId = z.string().regex(/^[A-Za-z0-9]{8}$/)
const mcKind = z.enum(['mod', 'resourcepack', 'shader'])
const mcFile = z.string().regex(/^[^<>:"|?*\\/]{1,200}$/)
const mcFiles = z.array(mcFile).min(1).max(500)
const mcTag = z.string().trim().min(1).max(24)
// Mundos: el nombre de su carpeta en saves/ (el servicio comprueba que existe y que no se sale de ahí)
const mcWorld = z.string().min(1).max(200).regex(/^[^<>:"|?*\\/]+$/)

type Impl = {
  [K in keyof Handlers]: (...args: Parameters<Handlers[K]>) => ReturnType<Handlers[K]> | Promise<ReturnType<Handlers[K]>>
}

const appWindow = (): BrowserWindow | undefined => BrowserWindow.getAllWindows()[0]

/** Todos los canales: cada argumento que llega de la interfaz se valida aquí. */
export const handlers: Impl = {
  'app:info': () => ({ version: app.getVersion() }),
  'settings:get': () => getSettings(),
  'settings:set': (patch) => setSettings(settingsPatch.parse(patch)),
  'settings:pickDir': async (current) => {
    const win = BrowserWindow.getFocusedWindow()
    const o: OpenDialogOptions = {
      defaultPath: z.string().max(260).parse(current),
      properties: ['openDirectory', 'createDirectory']
    }
    const r = await (win ? dialog.showOpenDialog(win, o) : dialog.showOpenDialog(o))
    return r.canceled ? null : r.filePaths[0]
  },
  'overlay:info': () => overlayInfo(),
  'overlay:close': () => closeOverlay(),
  'overlay:ready': () => overlayReady(),
  'overlay:toggle': () => toggleOverlay(),
  'capture:list': () => captures(),
  'capture:shot': () => screenshot(),
  'capture:status': () => clipStatus(),
  'capture:devices': () => clipDevices(),
  'capture:clip': () => saveClip(),
  'capture:pcm': (chunk) => pushPcm(z.instanceof(Uint8Array).refine((b) => b.byteLength <= 65536).parse(chunk)),
  'capture:audioFailed': (why) => audioFailed(z.string().max(200).parse(why)),
  'capture:openFolder': (kind) => openCaptureFolder(z.enum(['pictures', 'videos']).parse(kind)),
  'chat:share': (chatId, captureId, text) => shareCapture(uuid.parse(chatId), uuid.parse(captureId), z.string().max(4000).optional().parse(text)),
  'chat:list': () => getChats(),
  'chat:dm': (userId) => openDm(uuid.parse(userId)),
  'chat:group': (name, icon, members) =>
    createGroup(z.string().trim().min(1).max(40).parse(name), z.union([z.string().max(16), z.string().regex(/^<e:[\w\-!?.']{1,40}:([0-9A-Z]{26}|[0-9a-f]{24})>$/)]).nullable().parse(icon), z.array(uuid).min(1).max(24).parse(members)),
  'chat:patch': (chatId, patch) => patchGroup(uuid.parse(chatId), z.object({ name: z.string().trim().min(1).max(40).optional(), icon: z.union([z.string().max(16), z.string().regex(/^<e:[\w\-!?.']{1,40}:([0-9A-Z]{26}|[0-9a-f]{24})>$/)]).optional() }).strict().parse(patch)),
  'chat:addMembers': (chatId, ids) => addMembers(uuid.parse(chatId), z.array(uuid).min(1).max(24).parse(ids)),
  'chat:removeMember': (chatId, user) => removeMember(uuid.parse(chatId), uuid.parse(user)),
  'chat:messages': (chatId, opts) =>
    messages(uuid.parse(chatId), z.object({ before: z.number().int().positive().optional(), after: z.number().int().min(0).optional() }).strict().parse(opts)),
  'chat:send': (chatId, body) => sendMessage(uuid.parse(chatId), chatBody.parse(body)),
  'chat:edit': (chatId, mid, text) => editMessage(uuid.parse(chatId), id.parse(mid), z.string().trim().min(1).max(4000).parse(text)),
  'chat:delete': (chatId, mid) => deleteMessage(uuid.parse(chatId), id.parse(mid)),
  'chat:react': (chatId, mid, emoji) => react(uuid.parse(chatId), id.parse(mid), z.string().min(1).max(16).parse(emoji)),
  'chat:pin': (chatId, mid) => pin(uuid.parse(chatId), id.parse(mid)),
  'chat:read': (chatId, mid) => markRead(uuid.parse(chatId), z.number().int().min(0).parse(mid)),
  'chat:reads': (chatId) => reads(uuid.parse(chatId)),
  'chat:typing': (chatId) => typing(uuid.parse(chatId)),
  'chat:focus': (chatId) => focusChat(uuid.nullable().parse(chatId)),
  'chat:invite': (to) => sendInvite(z.object({ chats: z.array(uuid).max(50).optional(), friends: z.array(uuid).max(50).optional() }).strict().parse(to)),
  'chat:emotes': (q, page) => emotes(z.string().max(40).parse(q).trim(), z.number().int().min(1).max(100).optional().parse(page)),
  'chat:stickers': () => myStickers(),
  'chat:stickerAdd': (bytes) => addSticker(z.instanceof(Uint8Array).refine((b) => b.length <= MAX_STICKER).parse(bytes)),
  'chat:stickerRemove': (sid) => removeSticker(z.string().regex(/^[0-9a-f]{16}$/).parse(sid)),
  'chat:gifs': (q, kind) => gifs(z.string().max(80).parse(q), z.enum(['gifs', 'stickers']).optional().parse(kind)),
  'system:checkUpdate': () => checkUpdate(),
  'system:installUpdate': () => installUpdate(),
  'account:get': () => getAccount(),
  'account:login': (u, p) => login(loginName.parse(u), secret.parse(p)),
  'account:register': (u, p, accept) => register(username.parse(u), newSecret.parse(p), z.literal(true).parse(accept)),
  'invite:create': (inst) => createInvite(inst === null ? null : mcId.parse(inst)),
  'invite:revoke': (code) => revokeInvite(inviteCode.parse(code)),
  'invite:preview': (code) => previewInvite(inviteCode.parse(code)),
  'invite:accept': (code) => acceptInvite(inviteCode.parse(code)),
  'invite:take': () => takeInvite(),
  'account:block': (uid) => blockUser(friendId.parse(uid)),
  'account:unblock': (uid) => unblockUser(friendId.parse(uid)),
  'account:report': (body) =>
    report(
      z
        .object({
          kind: z.enum(['message', 'user']),
          user: friendId,
          chat: uuid.optional(),
          message: id.optional(),
          reason: z.enum(['spam', 'harassment', 'inappropriate', 'impersonation', 'other']),
          text: z.string().trim().max(500).regex(/^[^\p{Cc}]*$/u).optional()
        })
        .strict()
        .parse(body)
    ),
  'account:logout': () => logout(),
  'account:password': (cur, next) => changePassword(secret.parse(cur), newSecret.parse(next)),
  'account:delete': (p) => deleteAccount(secret.parse(p)),
  // La foto ya viene recortada y en WebP; el proceso principal y el servidor vuelven a comprobarla
  'account:setAvatar': (d) => setAvatar(z.string().max(300_000).regex(/^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/).parse(d)),
  'account:removeAvatar': () => removeAvatar(),
  // El servidor valida cada campo; aquí se limpia antes de mandarlo
  'account:setProfile': (patch) => setProfile(profilePatch.parse(patch)),
  'account:setBanner': (bytes) => setBanner(z.instanceof(Uint8Array).refine((b) => b.length <= MAX_BANNER).parse(bytes)),
  'account:removeBanner': () => removeBanner(),
  'account:avatar': (u, v) => avatarOf(friendId.parse(u), z.string().regex(/^[0-9a-f]{16}$/).parse(v)),
  'account:addFriend': (u) => addFriend(loginName.parse(u)),
  'account:answerFriend': (fid, accept) => answerFriend(friendId.parse(fid), z.boolean().parse(accept)),
  'account:removeFriend': (fid) => removeFriend(friendId.parse(fid)),
  'account:nickname': (fid, n) =>
    setNickname(
      friendId.parse(fid),
      z.string().trim().max(32).regex(/^[^\p{Cc}]*$/u).parse(n)
    ),
  'mc:get': () => getMinecraft(),
  'mc:versions': () => mcVersions(),
  'mc:loaderVersions': (l, v) => mcLoaderVersions(mcLoader.parse(l), mcVersion.parse(v)),
  'mc:create': (name, v, l, lv) =>
    createInstance(
      mcName.parse(name),
      mcVersion.parse(v),
      z.enum(['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']).optional().parse(l),
      mcLoaderVersion.optional().parse(lv)
    ),
  'mc:update': (i, patch) =>
    updateInstance(mcId.parse(i), z.object({ name: mcName, ramMB: mcRam, autoBackup: z.boolean(), shareSettings: z.boolean() }).partial().strict().parse(patch)),
  'mc:duplicate': (i, w) => duplicateInstance(mcId.parse(i), z.boolean().parse(w)),
  'mc:delete': (i) => deleteInstance(mcId.parse(i)),
  'mc:openFolder': (i) => openInstanceFolder(mcId.parse(i)),
  'mc:log': (i) => instanceLog(mcId.parse(i)),
  'mc:addOffline': (name) => addOfflineAccount(z.string().trim().regex(/^[A-Za-z0-9_]{3,16}$/).parse(name)),
  'mc:addMicrosoft': () => addMicrosoftAccount(),
  'mc:cancelLogin': () => cancelMicrosoftLogin(),
  'mc:removeAccount': (i) => removeAccount(mcId.parse(i)),
  'mc:setAccount': (i) => setActiveAccount(mcId.parse(i)),
  'mc:play': (i) => playInstance(mcId.parse(i)),
  'mc:cancel': () => cancelInstall(),
  'mc:stop': () => stopInstance(),
  'mc:content': (i) => mcContent(mcId.parse(i)),
  'mc:search': (i, q, kind, sort, offset) =>
    mcSearch(
      mcId.nullable().parse(i),
      z.string().max(100).parse(q),
      z.enum(['mod', 'resourcepack', 'shader', 'modpack']).parse(kind),
      z.enum(['relevance', 'downloads', 'updated', 'newest']).parse(sort),
      z.number().int().min(0).max(10_000).parse(offset)
    ),
  'mc:install': (i, p, k, v) => mcInstall(mcId.parse(i), mrId.parse(p), mcKind.parse(k), mrId.optional().parse(v)),
  'mc:projectVersions': (i, p, k) => mcProjectVersions(mcId.parse(i), mrId.parse(p), mcKind.parse(k)),
  'mc:updates': (i) => mcUpdates(mcId.parse(i)),
  'mc:setVersions': (i, vs, down) => mcSetVersions(mcId.parse(i), z.array(mrId).min(1).max(500).parse(vs), z.boolean().parse(down)),
  'mc:remove': (i, f, o) => mcRemove(mcId.parse(i), mcFiles.parse(f), z.boolean().parse(o)),
  'mc:toggle': (i, f, on) => mcToggle(mcId.parse(i), mcFiles.parse(f), z.boolean().parse(on)),
  'mc:toggleTag': (i, t, on) => mcToggleTag(mcId.parse(i), mcTag.parse(t), z.boolean().parse(on)),
  'mc:editContent': (i, f, patch) =>
    mcEditContent(mcId.parse(i), mcFile.parse(f), z.object({ locked: z.boolean(), tags: z.array(mcTag).max(10) }).partial().strict().parse(patch)),
  'mc:history': (i) => mcHistory(mcId.parse(i)),
  'mc:rollback': (i, at) => mcRollback(mcId.parse(i), z.number().int().positive().parse(at)),
  'mc:worlds': (i) => mcWorlds(mcId.parse(i)),
  'mc:backupWorld': (i, w) => mcBackupWorld(mcId.parse(i), mcWorld.parse(w)),
  'mc:restoreWorld': (i, w, at) => mcRestoreWorld(mcId.parse(i), mcWorld.parse(w), z.number().int().positive().parse(at)),
  'mc:deleteBackup': (i, w, at) => mcDeleteBackup(mcId.parse(i), mcWorld.parse(w), z.number().int().positive().parse(at)),
  'mc:openBackups': (i, w) => mcOpenBackups(mcId.parse(i), mcWorld.parse(w)),
  'mc:importPack': () => importPackFile(),
  'mc:installModpack': (p, v) => installModpack(mrId.parse(p), mrId.optional().parse(v)),
  'mc:exportPack': (i) => exportInstancePack(mcId.parse(i)),
  'mc:exportServer': (i) => exportInstanceServer(mcId.parse(i)),
  'mc:fixCrash': (i, n) => fixCrash(mcId.parse(i), z.number().int().min(0).max(20).parse(n)),
  'mc:dismissCrash': (i) => dismissCrash(mcId.parse(i)),
  'mc:share': (i, ids) => sharePack(mcId.parse(i), z.array(friendId).max(7).parse(ids)),
  'mc:leavePack': (i) => leavePack(mcId.parse(i)),
  'mc:answerPack': (p, accept) => answerPack(friendId.parse(p), z.boolean().parse(accept)),
  'mc:applyPack': (i) => applyPack(mcId.parse(i)),
  'mc:rollbackPack': (i, rev) => rollbackPack(mcId.parse(i), z.number().int().positive().parse(rev)),
  'mc:preflight': (i) => mcPreflight(mcId.parse(i)),
  'mc:fixIssues': (i) => mcFixIssues(mcId.parse(i)),
  'mc:optimizePlan': (i) => mcOptimizePlan(mcId.parse(i)),
  'mc:optimize': (i, ids) => mcOptimize(mcId.parse(i), z.array(z.string().regex(/^[A-Za-z0-9]{8}$/)).max(20).parse(ids)),
  'mc:joinFriend': (f) => joinFriend(friendId.parse(f)),
  'mc:installFromCloud': (p) => installFromCloud(friendId.parse(p)),
  'mc:removeCloudPack': (p) => removeCloudPack(friendId.parse(p)),
  'mc:openEula': () => openAsUser('https://aka.ms/MinecraftEULA'),
  'mc:skin': (a) => mcSkin(mcId.parse(a)),
  // La skin llega como PNG en data URL; el servicio vuelve a comprobar que es un PNG de 64×64 o 64×32
  'mc:setSkin': (a, d, v) =>
    mcSetSkin(
      mcId.parse(a),
      Buffer.from(z.string().max(90_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/).parse(d).split(',')[1], 'base64'),
      z.enum(['classic', 'slim']).parse(v)
    ),
  'mc:resetSkin': (a) => mcResetSkin(mcId.parse(a)),
  'mc:setCape': (a, c) => mcSetCape(mcId.parse(a), z.string().uuid().nullable().parse(c)),
  'mc:serverSetup': (i, cfg) =>
    setupServer(
      mcId.parse(i),
      z
        .object({
          online: z.boolean(),
          ramMB: z.number().int().min(1024).max(32768),
          motd: z.string().trim().max(60),
          world: z.union([z.enum(['new', 'group']), z.object({ copy: mcWorld }).strict()])
        })
        .strict()
        .parse(cfg)
    ),
  'mc:serverStart': (i) => startHosting(mcId.parse(i)),
  'mc:serverStop': (i) => stopHosting(mcId.parse(i)),
  // Comandos de consola: una línea, sin saltos (los mismos que escribirías en la consola del servidor)
  'mc:serverCommand': (i, l) => serverCommand(mcId.parse(i), z.string().trim().min(1).max(300).regex(/^[^\r\n]+$/).parse(l)),
  'mc:serverLog': (i) => serverLog(mcId.parse(i)),
  'mc:serverOpenFolder': (i) => openServerFolder(mcId.parse(i)),
  'mc:playOwnServer': (i) => playOwnServer(mcId.parse(i)),
  'app:quit': () => quitNow(),
  'app:openLegal': (page) => openAsUser(`${UPDATE_BASE}/${z.enum(['privacidad', 'terminos']).parse(page)}`),
  'app:openLink': (url) => openAsUser(z.string().max(2000).regex(/^https:\/\/[^\s"'<>]+$/).parse(url)),
  // Siempre la ventana de la app (con "la enfocada", si el foco estaba en otro programa el botón no hacía nada)
  'window:minimize': () => appWindow()?.minimize(),
  'window:capture': async () => {
    const w = appWindow()
    return w ? (await w.webContents.capturePage()).toJPEG(88) : null
  },
  'window:maximize': () => {
    const w = appWindow()
    if (w) w.isMaximized() ? w.unmaximize() : w.maximize()
  },
  'window:close': () => appWindow()?.close(),
  'window:fullscreen': (on) => BrowserWindow.getAllWindows()[0]?.setFullScreen(z.boolean().parse(on))
}

export function registerIpc(): void {
  for (const [channel, fn] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (_e, ...args: unknown[]) => {
      try {
        return await (fn as (...a: unknown[]) => unknown)(...args)
      } catch (e) {
        // Sin trazas al cliente: solo un mensaje genérico
        console.error(`[ipc] ${channel}:`, (e as Error).message)
        throw new Error('ERR')
      }
    })
  }
}
