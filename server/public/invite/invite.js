// Página de un enlace de invitación: enseña quién invita y a qué, abre la app (poxilauncher://invite/<código>) o la descarga
const code = location.pathname.split('/').pop()
const $ = (id) => document.getElementById(id)
const LOADERS = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' }

/** El instalador actual (el pequeño, que baja el resto) en los botones de descargar */
async function download() {
  const yml = await fetch('/updates/latest.yml')
    .then((r) => (r.ok ? r.text() : ''))
    .catch(() => '')
  const file = /^path:\s*(\S+\.exe)\s*$/m.exec(yml)?.[1]
  if (file) for (const a of document.querySelectorAll('.dl')) a.href = `/updates/${encodeURIComponent(file)}`
}

async function main() {
  void download()
  const res = await fetch(`/api/invites/${encodeURIComponent(code)}`).catch(() => null)
  if (!res?.ok) return void ($('bad').hidden = false)
  const inv = await res.json()
  const name = inv.by.displayName || inv.by.username
  $('name').textContent = name
  $('ava').textContent = name.slice(0, 1).toUpperCase()
  if (inv.pack) {
    $('pack').hidden = false
    $('pack-name').textContent = inv.pack.name
    $('pack-info').textContent = `Minecraft ${inv.pack.mc} · ${LOADERS[inv.pack.loader] ?? inv.pack.loader} · ${inv.pack.mods} ${inv.pack.mods === 1 ? 'mod' : 'mods'} · ${inv.pack.members} ${inv.pack.members === 1 ? 'jugador' : 'jugadores'}`
    if (inv.pack.icon?.startsWith('https://cdn.modrinth.com/')) {
      $('icon').src = inv.pack.icon
      $('icon').hidden = false
    }
    $('what').textContent = `Al aceptar, ${name} y tú seréis amigos y PoxiLauncher instalará el pack con todos sus mods.`
    $('full').hidden = !inv.pack.full
  } else {
    $('friend-title').hidden = false
    $('what').textContent = `Al aceptar, ${name} y tú seréis amigos: veréis a qué jugáis y os podréis unir a la partida del otro.`
  }
  const days = Math.max(1, Math.round((inv.expires - Date.now()) / 86_400_000))
  $('expires').textContent = `La invitación caduca en ${days} ${days === 1 ? 'día' : 'días'}.`
  $('open').href = `poxilauncher://invite/${code}`
  $('ok').hidden = false
}

main()
