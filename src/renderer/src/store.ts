import { useRef, useSyncExternalStore } from 'react'
import type { PushEvent } from '@shared/ipc'
import type { AccountState, McState, Settings } from '@shared/types'
import { invoke, on } from './api'
import type { ChatInfo } from '@shared/chat'
import { playMessageSound } from './lib/sound'
import { IS_OVERLAY } from './lib/overlay'

export type Route =
  | { name: 'account' }
  | { name: 'friend'; id: string }
  /** Chat entre amigos (id: el chat abierto) */
  | { name: 'chat'; id?: string }
  | { name: 'minecraft' }
  | { name: 'mcInstance'; id: string }

/**
 * Lo que se recuerda de cada pantalla para volver a ella tal cual (atrás/adelante): hasta dónde habías
 * bajado y, si la pantalla los guarda, sus filtros. Se guarda en el propio objeto de la ruta.
 */
export interface RouteMemo {
  scroll?: number
  filters?: unknown
}

export type Toast = PushEvent['toast'] & { id: number }

interface State {
  ready: boolean
  settings: Settings | null
  /** Chats con tus amigos (con sus no leídos) y el aviso de un mensaje nuevo */
  chats: ChatInfo[]
  chatToast: (PushEvent['chatToast'] & { key: number }) | null
  route: Route
  history: Route[]
  /** Pantallas a las que se puede volver con "adelante" */
  forward: Route[]
  toasts: Toast[]
  /** Actualización de la app disponible / descargando */
  update: { state: 'available' | 'downloading' | 'error'; version: string; progress: number } | null
  /** Novedades a enseñar: todo lo nuevo desde `from` hasta `to` */
  whatsNew: { from: string; to: string } | null
  /** Tu cuenta y tus amigos */
  account: AccountState
  /** Minecraft: instancias, cuentas y lo que está en marcha (null hasta que se abre la sección) */
  mc: McState | null
  /** Código del inicio de sesión de Microsoft en curso */
  mcCode: string | null
  /** Ajustes abiertos (la capa a pantalla completa): su categoría y, si se pide, la fila a la que saltar */
  settingsOpen: { cat?: string; row?: string } | null
  /** Enlace de invitación abierto (su código) a la espera de aceptarlo */
  invite: string | null
}

let state: State = {
  ready: false,
  settings: null,
  chats: [],
  chatToast: null,
  route: { name: 'minecraft' },
  history: [],
  forward: [],
  toasts: [],
  update: null,
  whatsNew: null,
  account: { user: null, friends: [], incoming: [], outgoing: [], offline: false },
  mc: null,
  mcCode: null,
  settingsOpen: null,
  invite: null
}

const subs = new Set<() => void>()

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)): void {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  for (const s of subs) s()
}

export const getState = (): State => state

const subscribe = (cb: () => void): (() => void) => {
  subs.add(cb)
  return () => subs.delete(cb)
}

const shallowEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  return a.every((x, i) => Object.is(x, b[i]))
}

/**
 * Suscribe al estado global. Si el selector devuelve un array nuevo con el mismo contenido
 * (p. ej. un .filter()), se reutiliza el anterior: sin esto React entra en bucle infinito.
 */
export function useStore<T>(selector: (s: State) => T): T {
  const last = useRef<{ v: T } | null>(null)
  return useSyncExternalStore(subscribe, () => {
    const next = selector(state)
    if (last.current && shallowEqual(last.current.v, next)) return last.current.v
    last.current = { v: next }
    return next
  })
}

// ——— Navegación ———
const main = (): HTMLElement | null => document.querySelector('.main')
const memo = (r: Route): RouteMemo => r as RouteMemo

/** Guarda en la pantalla actual hasta dónde habías bajado (para volver al mismo sitio) */
function rememberScroll(): void {
  memo(state.route).scroll = main()?.scrollTop ?? 0
}

/** Al volver a una pantalla, recupera su posición (cuando ya esté pintada) */
function restoreScroll(r: Route): void {
  const top = memo(r).scroll ?? 0
  let tries = 0
  const go = (): void => {
    const el = main()
    if (!el) return
    el.scrollTo({ top })
    // Las listas largas tardan un momento en tener su altura: se reintenta hasta llegar
    if (Math.abs(el.scrollTop - top) > 2 && ++tries < 20) setTimeout(go, 50)
  }
  requestAnimationFrame(() => requestAnimationFrame(go))
}

export function navigate(route: Route): void {
  rememberScroll()
  setState((s) => ({ route, history: [...s.history.slice(-30), s.route], forward: [] }))
  main()?.scrollTo({ top: 0 })
}

// Un mismo botón del ratón puede llegar por dos caminos (clic y orden de Windows): solo cuenta una vez
let lastNav = 0
const tooSoon = (): boolean => {
  const now = Date.now()
  if (now - lastNav < 250) return true
  lastNav = now
  return false
}

export function goBack(): void {
  const prev = state.history.at(-1)
  if (!prev || tooSoon()) return
  rememberScroll()
  setState((s) => ({ route: prev, history: s.history.slice(0, -1), forward: [...s.forward, s.route] }))
  restoreScroll(prev)
}

export function goForward(): void {
  const next = state.forward.at(-1)
  if (!next || tooSoon()) return
  rememberScroll()
  setState((s) => ({ route: next, history: [...s.history.slice(-30), s.route], forward: s.forward.slice(0, -1) }))
  restoreScroll(next)
}

/** Recuerda algo de la pantalla actual (filtros…) para cuando se vuelva a ella con "atrás" */
export function rememberFilters(filters: unknown): void {
  memo(state.route).filters = filters
}

/** Abre Ajustes (la capa) en una categoría y, si se pide, salta a una fila */
export const openSettings = (cat?: string, row?: string): void => setState({ settingsOpen: { cat, row } })

// ——— Toasts ———
let toastId = 0
export function toast(t: PushEvent['toast']): void {
  const id = ++toastId
  setState((s) => ({ toasts: [...s.toasts, { ...t, id }] }))
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 4200)
}

// ——— Ajustes (optimista) ———
export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  if (state.settings) setState({ settings: { ...state.settings, ...patch } })
  const saved = await invoke('settings:set', patch)
  setState({ settings: saved })
}

// ——— Arranque ———
export async function boot(): Promise<void> {
  on('settings', (settings) => setState({ settings }))
  on('chats', (chats) => setState({ chats }))
  // Mensaje nuevo con la app a la vista: aviso propio unos segundos (pulsarlo abre el chat)
  let chatToastTimer: ReturnType<typeof setTimeout> | undefined
  // En el menú dentro del juego no: ya suena en la ventana principal (si no, sonaría doble)
  if (!IS_OVERLAY) on('chatSound', () => playMessageSound())
  on('chatToast', (c) => {
    setState({ chatToast: { ...c, key: Date.now() } })
    clearTimeout(chatToastTimer)
    chatToastTimer = setTimeout(() => setState({ chatToast: null }), 5500)
  })
  // Pulsaste la notificación de Windows de un mensaje: a ese chat
  on('chatOpen', (id) => navigate({ name: 'chat', id }))
  // Enlace de invitación (con la app abierta, o el que la abrió)
  if (!IS_OVERLAY) {
    on('invite', (invite) => setState({ invite }))
    void invoke('invite:take').then((invite) => invite && setState({ invite }))
  }
  on('toast', toast)
  on('account', (account) => setState({ account }))
  on('update', (u) =>
    setState((s) => ({
      update: {
        ...u,
        progress: Math.min(1, Math.max(u.progress || 0, s.update?.state === u.state ? s.update.progress : 0))
      }
    }))
  )
  on('minecraft', (mc) => setState({ mc }))
  on('minecraftCode', ({ code }) => setState({ mcCode: code }))
  on('nav', ({ dir }) => {
    if (dir === 'back') goBack()
    else goForward()
  })

  const [settings, account] = await Promise.all([invoke('settings:get'), invoke('account:get').catch(() => state.account)])
  void invoke('chat:list').then((chats) => setState({ chats })).catch(() => undefined)
  setState({ settings, account, ready: true })
}
