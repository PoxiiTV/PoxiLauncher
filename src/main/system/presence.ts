import { getSettings, onSettingsChange } from '../settings'
import { translate } from '@shared/i18n'
import { createDiscordPresence } from './discord'
import { mcPlaying, onMcPlaying } from '../minecraft/service'

// Lo que se ve en Discord: la app con "Buscando a qué jugar" o, jugando, la instancia de Minecraft y el tiempo.
// Se puede apagar en Ajustes (solo afecta a Discord; los amigos lo siguen viendo).

const APP_ID = (import.meta.env.MAIN_VITE_DISCORD_APP_ID as string | undefined) ?? ''

export function startPresence(): void {
  if (!APP_ID) return
  let rpc: ReturnType<typeof createDiscordPresence> | null = null
  let since = 0

  const update = async (): Promise<void> => {
    if (!rpc) return
    const lang = getSettings().lang
    const mc = mcPlaying()
    if (mc) {
      // Minecraft: la versión, el loader y la instancia; de imagen, el icono del modpack si lo tiene
      return rpc.set({
        details: `Minecraft ${mc.version}`,
        state: `${translate(lang, `mc.loader.${mc.loader}`)} · ${mc.name}`,
        startedAt: since,
        largeImage: mc.icon && /^https:\/\//.test(mc.icon) ? mc.icon : undefined,
        largeText: mc.name
      })
    }
    return rpc.set({ details: translate(lang, 'discord.idle') })
  }

  const apply = (on: boolean): void => {
    if (on && !rpc) {
      rpc = createDiscordPresence(APP_ID)
      void update()
    } else if (!on && rpc) {
      rpc.stop()
      rpc = null
    }
  }

  onMcPlaying(() => {
    since = mcPlaying() ? Date.now() : 0
    void update()
  })
  onSettingsChange((s, patch) => {
    if ('discordPresence' in patch) apply(s.discordPresence)
    if ('lang' in patch) void update()
  })
  apply(getSettings().discordPresence)
}
