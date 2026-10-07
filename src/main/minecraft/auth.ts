import { BrowserWindow } from 'electron'
import { translate } from '@shared/i18n'
import { getSettings } from '../settings'
import { safeFetch } from '../net'
import { xstsErrorKey } from './rules'

// Cuenta Microsoft para Minecraft, igual que Prism Launcher (y con su client ID, en .env): código de dispositivo
// de Microsoft → Xbox Live → XSTS → token de Minecraft → perfil. La página de Microsoft se abre en una ventana
// de PoxiLauncher (nunca en el navegador del usuario) con el código ya puesto.

const CLIENT_ID = (import.meta.env.MAIN_VITE_MSA_CLIENT_ID as string | undefined) ?? ''
const MS = 'https://login.microsoftonline.com/consumers/oauth2/v2.0'
const SCOPE = 'XboxLive.SignIn XboxLive.offline_access'

export const msaAvailable = (): boolean => !!CLIENT_ID

/** Error con clave i18n para enseñar al usuario */
export class AuthError extends Error {
  constructor(readonly key: string) {
    super(key)
  }
}

export interface McSession {
  /** Token de Minecraft (dura ~24 h) */
  token: string
  expires: number
  /** Token de renovación de Microsoft (para no volver a pedir la contraseña) */
  refresh: string
  uuid: string
  name: string
  skin: string | null
}

const form = (data: Record<string, string>): string => new URLSearchParams(data).toString()
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' }
const JSON_H = { 'Content-Type': 'application/json', Accept: 'application/json' }

async function post<T>(url: string, body: string, headers: Record<string, string>, tries = 3): Promise<{ status: number; data: T }> {
  const res = await safeFetch(url, tries, headers, body)
  return { status: res.status, data: (await res.json().catch(() => ({}))) as T }
}

/** Microsoft → Xbox → XSTS → Minecraft → perfil (lo mismo al añadir la cuenta y al renovarla) */
async function minecraftSession(msAccess: string, refresh: string): Promise<McSession> {
  const xbl = await post<{ Token?: string; DisplayClaims?: { xui: { uhs: string }[] } }>(
    'https://user.auth.xboxlive.com/user/authenticate',
    JSON.stringify({
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccess}` },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT'
    }),
    JSON_H
  )
  if (!xbl.data.Token) throw new AuthError('mc.auth.failed')
  const xsts = await post<{ Token?: string; XErr?: number; DisplayClaims?: { xui: { uhs: string }[] } }>(
    'https://xsts.auth.xboxlive.com/xsts/authorize',
    JSON.stringify({ Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.data.Token] }, RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT' }),
    JSON_H
  )
  if (xsts.data.XErr) throw new AuthError(xstsErrorKey(xsts.data.XErr))
  const uhs = xsts.data.DisplayClaims?.xui[0]?.uhs
  if (!xsts.data.Token || !uhs) throw new AuthError('mc.auth.failed')
  const mc = await post<{ access_token?: string; expires_in?: number }>(
    'https://api.minecraftservices.com/launcher/login',
    JSON.stringify({ xtoken: `XBL3.0 x=${uhs};${xsts.data.Token}`, platform: 'PC_LAUNCHER' }),
    JSON_H
  )
  if (!mc.data.access_token) throw new AuthError('mc.auth.failed')
  const res = await safeFetch('https://api.minecraftservices.com/minecraft/profile', 3, { Authorization: `Bearer ${mc.data.access_token}` })
  // Sin perfil de Minecraft: la cuenta no tiene el juego
  if (res.status === 404) throw new AuthError('mc.auth.noGame')
  if (!res.ok) throw new AuthError('mc.auth.failed')
  const p = (await res.json()) as { id: string; name: string; skins?: { url: string; state: string }[] }
  return {
    token: mc.data.access_token,
    expires: Date.now() + (mc.data.expires_in ?? 3600) * 1000,
    refresh,
    uuid: p.id,
    name: p.name,
    skin: p.skins?.find((s) => s.state === 'ACTIVE')?.url ?? null
  }
}

/** Renueva la sesión con el token de renovación (sin pedir nada al usuario) */
export async function refreshSession(refresh: string): Promise<McSession> {
  const r = await post<{ access_token?: string; refresh_token?: string }>(
    `${MS}/token`,
    form({ client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: refresh, scope: SCOPE }),
    FORM
  )
  if (!r.data.access_token) throw new AuthError('mc.auth.expired')
  return minecraftSession(r.data.access_token, r.data.refresh_token ?? refresh)
}

let loginWin: BrowserWindow | null = null

/** Cierra la ventana de inicio de sesión (y así se cancela el inicio de sesión en curso) */
export const cancelLogin = (): void => loginWin?.close()

/**
 * Inicio de sesión con código de dispositivo: se abre la página de Microsoft con el código ya puesto y se espera a
 * que el usuario termine. `onCode` enseña el código en la app por si Microsoft lo vuelve a pedir.
 */
export async function loginMicrosoft(onCode: (code: string) => void): Promise<McSession> {
  if (!CLIENT_ID) throw new AuthError('mc.auth.failed')
  cancelLogin()
  const dc = await post<{ device_code?: string; user_code?: string; interval?: number; expires_in?: number }>(
    `${MS}/devicecode`,
    form({ client_id: CLIENT_ID, scope: SCOPE }),
    FORM
  )
  if (!dc.data.device_code || !dc.data.user_code) throw new AuthError('mc.auth.failed')
  onCode(dc.data.user_code)

  const win = new BrowserWindow({
    width: 520,
    height: 720,
    title: translate(getSettings().lang, 'mc.auth.windowTitle'),
    autoHideMenuBar: true,
    parent: BrowserWindow.getAllWindows().find((w) => !w.getParentWindow()) ?? undefined,
    // Sesión en memoria: al cerrar, no queda ninguna cookie de Microsoft guardada
    webPreferences: { partition: 'msa-login', sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false }
  })
  loginWin = win
  let closed = false
  win.on('closed', () => {
    closed = true
    if (loginWin === win) loginWin = null
  })
  win.on('page-title-updated', (e) => e.preventDefault())
  // Enlaces que abren ventana nueva (ayuda, crear cuenta…): en la misma
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void win.loadURL(url)
    return { action: 'deny' }
  })
  void win.loadURL(`https://www.microsoft.com/link?otc=${encodeURIComponent(dc.data.user_code)}`)

  try {
    const until = Date.now() + (dc.data.expires_in ?? 900) * 1000
    let wait = Math.max(2, dc.data.interval ?? 5) * 1000
    while (!closed && Date.now() < until) {
      await new Promise((r) => setTimeout(r, wait))
      if (closed) break
      const r = await post<{ access_token?: string; refresh_token?: string; error?: string }>(
        `${MS}/token`,
        form({ client_id: CLIENT_ID, grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: dc.data.device_code }),
        FORM,
        1
      ).catch(() => null)
      if (!r) continue
      if (r.data.access_token && r.data.refresh_token) {
        if (!win.isDestroyed()) win.close()
        return await minecraftSession(r.data.access_token, r.data.refresh_token)
      }
      if (r.data.error === 'slow_down') wait += 5000
      else if (r.data.error && r.data.error !== 'authorization_pending') throw new AuthError(r.data.error === 'authorization_declined' ? 'mc.auth.cancelled' : 'mc.auth.failed')
    }
    throw new AuthError(closed ? 'mc.auth.cancelled' : 'mc.auth.expired')
  } finally {
    if (!win.isDestroyed()) win.close()
  }
}
