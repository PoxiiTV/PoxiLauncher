import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// En Windows, compilar desde "f:\…" en vez de "F:\…" hacía que el mismo archivo entrase dos veces en el
// paquete (dos catálogos, dos cachés de carátulas: la app se quedaba sin portadas ni fichas).
// Se normaliza la carpeta de trabajo a su forma real antes de resolver ninguna ruta.
process.chdir(realpathSync.native(process.cwd()))

const shared = { '@shared': resolve('src/shared') }

// CSP estricta en producción; en desarrollo Vite necesita scripts inline (React Refresh) y websocket.
const csp = (): Plugin => ({
  name: 'poxi-csp',
  transformIndexHtml(html, ctx) {
    const dev = !!ctx.server
    return html
      .replace('%DEV_SCRIPT%', dev ? "'unsafe-inline'" : '')
      .replace('%DEV_CONNECT%', dev ? 'ws: http://localhost:*' : '')
  }
})

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    // Dependencias opcionales de ws (el túnel de Minecraft): si Vite las empaqueta, pone un módulo vacío en su lugar
    // y ws se rompe con mensajes de 48 bytes o más. Fuera del paquete, faltan de verdad y ws usa su versión en JS.
    build: { rollupOptions: { external: ['bufferutil', 'utf-8-validate'] } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared }
  },
  renderer: {
    resolve: { alias: { ...shared, '@': resolve('src/renderer/src') } },
    plugins: [react(), csp()],
    // La ventana oculta del audio de los clips tiene su propia página (sin cargar la interfaz entera)
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html'), audiocap: resolve('src/renderer/audiocap.html') } } }
  }
})
