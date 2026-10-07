import { CLIP_QUALITIES, SHOT_HOTKEY } from '@shared/capture'
import { isAccelerator, OVERLAY_HOTKEY } from '@shared/hotkey'
import { z } from 'zod'
import type { Settings } from '@shared/types'
import { dataPath, readJson, writeJson } from './store'
import { emit } from './events'

const FILE = (): string => dataPath('settings.json')

const defaults = (): Settings => ({
  accent: 'violet',
  lang: 'es',
  startWithWindows: false,
  notifications: true,
  minimizeWhilePlaying: false,
  discordPresence: true,
  friendAlerts: true,
  overlayHotkey: OVERLAY_HOTKEY,
  shotHotkey: SHOT_HOTKEY,
  clips: true,
  clipSeconds: 30,
  clipQuality: 'native',
  clipFps: 60,
  clipAudio: true,
  clipScreen: '',
  clipAudioDevice: '',
  chatNotify: true,
  chatSounds: true,
  chatMuted: [],
  chatStyle: { layout: 'list', density: 'cozy', size: 'm', accent: '#9dff3f', bg: { kind: 'none' }, avatars: true, time24: true }
})

/** Validación de lo que llega desde la interfaz: nunca confiamos en el cliente. */
export const settingsPatch = z
  .object({
    accent: z.enum(['violet', 'blue', 'emerald', 'pink', 'amber', 'red']),
    lang: z.enum(['es', 'en']),
    startWithWindows: z.boolean(),
    lastSeenVersion: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/),
    langAsked: z.literal(true),
    chatNotify: z.boolean(),
    chatSounds: z.boolean(),
    chatMuted: z.array(z.string().uuid()).max(500),
    chatStyle: z
      .object({
        layout: z.enum(['list', 'bubbles']),
        density: z.enum(['cozy', 'compact']),
        size: z.enum(['s', 'm', 'l']),
        accent: z.string().regex(/^#[0-9a-f]{6}$/i),
        bg: z.union([
          z.object({ kind: z.literal('none') }).strict(),
          z.object({ kind: z.literal('color'), colors: z.array(z.string().regex(/^#[0-9a-f]{6}$/i)).min(1).max(2) }).strict()
        ]),
        avatars: z.boolean(),
        time24: z.boolean()
      })
      .strict(),
    notifications: z.boolean(),
    minimizeWhilePlaying: z.boolean(),
    discordPresence: z.boolean(),
    friendAlerts: z.boolean(),
    overlayHotkey: z.string().max(60).refine(isAccelerator),
    shotHotkey: z.string().max(60).refine(isAccelerator),
    clips: z.boolean(),
    clipSeconds: z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(120)]),
    clipQuality: z.enum(CLIP_QUALITIES),
    clipFps: z.union([z.literal(30), z.literal(60)]),
    clipAudio: z.boolean(),
    clipScreen: z.string().max(300),
    clipAudioDevice: z.string().max(300)
  })
  .partial()
  .strict()

let current: Settings | null = null
const listeners: ((s: Settings, patch: Partial<Settings>) => void)[] = []

export function getSettings(): Settings {
  if (current) return current
  // Sin ajustes guardados es la primera vez: se pregunta el idioma (a quien ya la usaba, nunca)
  current = { ...defaults(), ...readJson<Partial<Settings>>(FILE(), { langAsked: false }) }
  return current
}

export function setSettings(patch: Partial<Settings>): Settings {
  current = { ...getSettings(), ...patch }
  writeJson(FILE(), current)
  emit('settings', current)
  for (const l of listeners) l(current, patch)
  return current
}

export const onSettingsChange = (fn: (s: Settings, patch: Partial<Settings>) => void): void => {
  listeners.push(fn)
}
