// Genera resources/icon.png (512x512) a partir del bloque de hierba de la app (src/renderer/src/assets/mc/grass-block.png),
// ampliado píxel a píxel (sin difuminar) y centrado sobre fondo transparente. Uso: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const block = 'data:image/png;base64,' + readFileSync(join(root, 'src', 'renderer', 'src', 'assets', 'mc', 'grass-block.png')).toString('base64')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } })
  const html = `<html><body style="margin:0;width:512px;height:512px;display:grid;place-items:center;background:transparent">
<img src="${block}" style="width:448px;height:512px;object-fit:contain;image-rendering:pixelated"></body></html>`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 400))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 })
  mkdirSync(join(root, 'resources'), { recursive: true })
  writeFileSync(join(root, 'resources', 'icon.png'), img.resize({ width: 512, height: 512, quality: 'best' }).toPNG())
  console.log('icon.png listo')
  app.exit(0)
})
