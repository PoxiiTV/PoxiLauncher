/// <reference types="electron-vite/node" />

interface ImportMetaEnv {
  /** Servidor de PoxiLauncher (cuentas, amigos, chat y packs), sin "/" final. Se define en .env */
  readonly MAIN_VITE_SERVER_URL?: string
  /** URL de las actualizaciones de PoxiLauncher (sin definir: no se actualiza solo). Se define en .env */
  readonly MAIN_VITE_UPDATE_URL?: string
  /** La web (privacidad, términos y la página de los enlaces de invitación), sin "/" final. Se define en .env */
  readonly MAIN_VITE_WEB_URL?: string
  /** Id de la aplicación de Discord (presencia "Jugando a PoxiLauncher"). Se define en .env; no es secreto */
  readonly MAIN_VITE_DISCORD_APP_ID?: string
  /** Client ID de Azure para iniciar sesión con Microsoft en Minecraft (el de Prism Launcher, uso personal) */
  readonly MAIN_VITE_MSA_CLIENT_ID?: string
}
