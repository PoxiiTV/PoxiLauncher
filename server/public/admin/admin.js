// Panel de publicación. Sin dependencias: fetch + DOM. Todo el texto se pinta con textContent.

const $ = (id) => document.getElementById(id)
const CHUNK = 32 * 1024 * 1024 // < 100 MB, el límite de Cloudflare por petición

let selected = []

// ——— API con renovación automática de la sesión ———
async function api(path, opts = {}, retried = false) {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin', ...opts })
  if (res.status === 401 && !retried && (!path.startsWith('/auth/') || path === '/auth/me')) {
    const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    if (r.ok) return api(path, opts, true)
    show('login')
    throw new Error('Sesión caducada')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`)
  return data
}

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

function show(view) {
  $('login').hidden = view !== 'login'
  $('panel').hidden = view !== 'panel'
  if (view === 'login') setTimeout(() => $('password').focus(), 50)
}

function toast(text) {
  const t = $('toast')
  t.textContent = text
  t.hidden = false
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => (t.hidden = true), 3500)
}

const fmtSize = (n) => {
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i < 2 ? 0 : 1)} ${u[i]}`
}
const fmtDate = (ms) => new Date(ms).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })

// ——— Login ———
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const err = $('login-error')
  err.hidden = true
  try {
    await api('/auth/login', json('POST', { password: $('password').value }))
    $('password').value = ''
    show('panel')
    await Promise.all([loadReleases(), loadAccounts(), loadPacks(), loadReports()])
  } catch (ex) {
    err.textContent = ex.message
    err.hidden = false
  }
})

$('logout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => undefined)
  show('login')
})

/** Botón peligroso: el primer clic pide confirmación ("¿Seguro?") y el segundo, en 3 s, lo hace */
function confirmButton(label, action, title = '') {
  const b = document.createElement('button')
  b.className = 'btn small ghost danger'
  b.textContent = label
  if (title) b.title = title
  b.onclick = async () => {
    if (b.dataset.confirm !== '1') {
      b.dataset.confirm = '1'
      b.textContent = '¿Seguro?'
      setTimeout(() => {
        b.dataset.confirm = ''
        b.textContent = label
      }, 3000)
      return
    }
    await action()
  }
  return b
}

// ——— Versiones ———
/** Versión publicada ahora (para marcar las cuentas con la app desactualizada) */
let currentVersion = null

async function loadReleases() {
  const list = await api('/releases')
  const current = list.find((r) => r.current)
  currentVersion = current?.version ?? null
  $('current-version').textContent = current?.version ?? '—'
  $('current-date').textContent = current ? `Publicada ${fmtDate(current.date)}` : 'Aún no hay ninguna publicada'
  $('empty').hidden = list.length > 0
  $('versions-count').textContent = list.length ? `${list.length} ${list.length === 1 ? 'versión' : 'versiones'}` : ''

  const tbody = $('versions')
  tbody.replaceChildren()
  for (const r of list) {
    const tr = document.createElement('tr')

    const tdV = document.createElement('td')
    tdV.textContent = r.version
    if (r.current) {
      const b = document.createElement('span')
      b.className = 'badge'
      b.textContent = 'Actual'
      tdV.append(b)
    }

    const tdD = document.createElement('td')
    tdD.textContent = fmtDate(r.date)

    const tdF = document.createElement('td')
    tdF.className = 'files'
    tdF.textContent = r.files.map((f) => `${f.name} (${fmtSize(f.size)})`).join(' · ')

    const tdA = document.createElement('td')
    if (!r.current) {
      const make = document.createElement('button')
      make.className = 'btn small'
      make.textContent = 'Hacer actual'
      make.onclick = async () => {
        await api(`/releases/${encodeURIComponent(r.version)}/current`, { method: 'POST' })
        toast(`✅ Las apps recibirán la ${r.version}`)
        loadReleases()
      }
      const del = confirmButton('Borrar', async () => {
        await api(`/releases/${encodeURIComponent(r.version)}`, { method: 'DELETE' })
        toast(`🗑️ ${r.version} borrada`)
        loadReleases()
      })
      tdA.append(make, del)
    }

    tr.append(tdV, tdD, tdF, tdA)
    tbody.append(tr)
  }
}

// ——— Selección de archivos ———
const drop = $('drop')
drop.addEventListener('dragover', (e) => {
  e.preventDefault()
  drop.classList.add('over')
})
drop.addEventListener('dragleave', () => drop.classList.remove('over'))
drop.addEventListener('drop', (e) => {
  e.preventDefault()
  drop.classList.remove('over')
  pick([...e.dataTransfer.files])
})
$('files').addEventListener('change', (e) => pick([...e.target.files]))

function pick(files) {
  selected = files.filter((f) => /^(latest\.yml|.+\.exe(\.blockmap)?)$/.test(f.name))
  const list = $('file-list')
  list.replaceChildren()
  for (const f of selected) {
    const li = document.createElement('li')
    const name = document.createElement('span')
    name.textContent = f.name
    const size = document.createElement('span')
    size.className = 'size'
    size.textContent = fmtSize(f.size)
    const bar = document.createElement('div')
    bar.className = 'bar'
    const fill = document.createElement('i')
    bar.append(fill)
    li.append(name, size, bar)
    list.append(li)
    f.fill = fill
  }
  $('publish').disabled = !selected.some((f) => f.name === 'latest.yml')
  $('upload-msg').hidden = true
}

// ——— Publicar: subida por trozos con reintentos ———
async function putChunk(id, file, offset) {
  const blob = file.slice(offset, offset + CHUNK)
  for (let attempt = 1; ; attempt++) {
    try {
      return await api(`/uploads/${id}/files/${encodeURIComponent(file.name)}?offset=${offset}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: blob
      })
    } catch (e) {
      if (attempt >= 3) throw e
      await new Promise((r) => setTimeout(r, 1500 * attempt))
    }
  }
}

$('publish').addEventListener('click', async () => {
  const btn = $('publish')
  const msg = $('upload-msg')
  btn.disabled = true
  msg.hidden = true
  let id = null
  try {
    id = (await api('/uploads', { method: 'POST' })).id
    for (const f of selected) {
      for (let offset = 0; offset < f.size; offset += CHUNK) {
        await putChunk(id, f, offset)
        f.fill.style.transform = `scaleX(${Math.min(1, (offset + CHUNK) / f.size)})`
      }
    }
    msg.textContent = '🔍 Comprobando la huella de los archivos…'
    msg.className = 'msg'
    msg.hidden = false
    const r = await api(`/uploads/${id}/finish`, json('POST', { makeCurrent: $('make-current').checked }))
    msg.textContent = `✅ Versión ${r.version} publicada`
    msg.className = 'msg ok'
    selected = []
    $('file-list').replaceChildren()
    loadReleases()
  } catch (e) {
    if (id) await api(`/uploads/${id}`, { method: 'DELETE' }).catch(() => undefined)
    msg.textContent = `❌ ${e.message}`
    msg.className = 'msg err'
    msg.hidden = false
    btn.disabled = false
  }
})

// ——— Cuentas ———
const ago = (ms) => {
  const m = Math.round((Date.now() - ms) / 60000)
  if (m < 1) return 'ahora mismo'
  if (m < 60) return `hace ${m} min`
  if (m < 48 * 60) return `hace ${Math.round(m / 60)} h`
  return `hace ${Math.round(m / 1440)} días`
}
const minutes = (ms) => `${Math.max(1, Math.round((Date.now() - ms) / 60000))} min`

/** Contraseña temporal fácil de dictar (sin 0/O ni 1/l) */
function tempPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789'
  return [...crypto.getRandomValues(new Uint32Array(12))].map((n) => abc[n % abc.length]).join('')
}

/** Pide un dato en el diálogo; "action" se ejecuta al guardar (si falla, el error sale en el diálogo) */
let askAction = null
function ask({ title, text, value = '', action }) {
  $('ask-title').textContent = title
  $('ask-text').textContent = text
  $('ask-input').value = value
  $('ask-error').hidden = true
  askAction = action
  $('ask').showModal()
  $('ask-input').select()
}
$('ask').querySelector('form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'ok') return
  e.preventDefault()
  try {
    await askAction($('ask-input').value.trim())
    $('ask').close()
  } catch (ex) {
    $('ask-error').textContent = ex.message
    $('ask-error').hidden = false
  }
})

/** Botón de icono con su nombre en el tooltip */
const iconButton = (icon, label, onClick) => {
  const b = document.createElement('button')
  b.className = 'btn small icon'
  b.textContent = icon
  b.title = label
  b.setAttribute('aria-label', label)
  b.onclick = onClick
  return b
}

async function loadAccounts() {
  const list = await api('/accounts')
  $('accounts-empty').hidden = list.length > 0
  const online = list.filter((u) => u.state !== 'offline').length
  $('accounts-summary').textContent = list.length ? `${list.length} cuentas · ${online} conectadas` : ''

  const tbody = $('accounts')
  tbody.replaceChildren()
  for (const u of list) {
    const tr = document.createElement('tr')
    const base = `/accounts/${u.id}`
    const done = (msg) => {
      toast(msg)
      loadAccounts()
      loadAudit()
    }

    const tdU = document.createElement('td')
    const since = document.createElement('small')
    if (u.blocked) since.append(tag('Bloqueada', 'bad'))
    if (u.mustChange) since.append(tag('Contraseña temporal', 'warn'))
    since.append(`Alta ${new Date(u.createdAt).toLocaleDateString('es-ES', { dateStyle: 'medium' })}`)
    if (u.appVersion) since.append(` · v${u.appVersion}`)
    // Foto y nombre: al pulsar, su ficha completa
    const who = document.createElement('button')
    who.className = 'who'
    who.title = 'Ver ficha'
    who.append(avatarOf(u), u.username)
    who.onclick = () => openAccount(u.id)
    tdU.append(who, since)

    const tdS = document.createElement('td')
    const dot = document.createElement('span')
    dot.className = `dot ${u.state}`
    tdS.append(
      dot,
      u.state === 'playing'
        ? `Jugando a ${u.gameName}${u.mc?.name ? ` («${u.mc.name}»)` : ''} · ${minutes(u.since)}`
        : u.state === 'online'
          ? 'En PoxiLauncher'
          : `Desconectado · ${ago(u.lastSeen)}`
    )

    const tdF = document.createElement('td')
    tdF.textContent = u.friends

    const tdA = document.createElement('td')
    const actions = document.createElement('div')
    actions.className = 'actions'
    tdA.append(actions)
    actions.append(
      iconButton('👁️', 'Ver ficha', () => openAccount(u.id)),
      iconButton('🔑', 'Poner contraseña temporal', () =>
        ask({
          title: `Contraseña temporal de ${u.username}`,
          text: 'Pásasela a esa persona: al entrar con ella, la app le pedirá que elija otra. Sus sesiones abiertas se cierran.',
          value: tempPassword(),
          action: async (password) => {
            await api(`${base}/password`, json('POST', { password }))
            done(`🔑 Contraseña temporal puesta a ${u.username}`)
          }
        })
      ),
      iconButton('✏️', 'Cambiar nombre', () =>
        ask({
          title: `Renombrar a ${u.username}`,
          text: '3-20 letras, números, "_" o ".". Sus amigos lo verán con el nombre nuevo.',
          value: u.username,
          action: async (username) => {
            await api(`${base}/rename`, json('POST', { username }))
            done(`✏️ ${u.username} ahora es ${username}`)
          }
        })
      ),
      iconButton(u.blocked ? '✅' : '⛔', u.blocked ? 'Desbloquear' : 'Bloquear', async () => {
        await api(`${base}/block`, json('POST', { blocked: !u.blocked }))
        done(u.blocked ? `✅ ${u.username} desbloqueada` : `⛔ ${u.username} bloqueada`)
      }),
      iconButton('🚪', 'Cerrar sus sesiones', async () => {
        await api(`${base}/logout`, { method: 'POST' })
        done(`🚪 Sesiones de ${u.username} cerradas`)
      }),
      confirmButton('🗑️', async () => {
        await api(base, { method: 'DELETE' })
        done(`🗑️ Cuenta ${u.username} borrada`)
      }, 'Borrar la cuenta')
    )

    tr.append(tdU, tdS, tdF, tdA)
    tbody.append(tr)
  }
}

function tag(text, kind) {
  const t = document.createElement('span')
  t.className = `badge ${kind}`
  t.textContent = text
  return t
}

const AUDIT = {
  password: '🔑 Contraseña temporal',
  rename: '✏️ Renombrada',
  block: '⛔ Bloqueada',
  unblock: '✅ Desbloqueada',
  logout: '🚪 Sesiones cerradas',
  delete: '🗑️ Borrada',
  created: '📅 Fecha de alta cambiada',
  avatar: '🖼️ Foto cambiada',
  avatarRemove: '🖼️ Foto quitada'
}
async function loadAudit() {
  const list = await api('/accounts/audit')
  const ul = $('audit')
  ul.replaceChildren()
  for (const a of list) {
    const li = document.createElement('li')
    const who = (a.detail.user ?? `${a.detail.from} → ${a.detail.to}`) + (a.detail.date ? ` (${a.detail.date})` : '')
    li.textContent = `${AUDIT[a.action] ?? a.action} · ${who}`
    const when = document.createElement('span')
    when.className = 'muted'
    when.textContent = fmtDate(Date.parse(a.at))
    li.append(when)
    ul.append(li)
  }
  if (!list.length) ul.textContent = 'Nada todavía.'
}
document.querySelector('.audit').addEventListener('toggle', (e) => e.target.open && loadAudit())

// El estado de las cuentas cambia solo (quién juega a qué): se refresca mientras el panel está a la vista
setInterval(() => {
  if (!$('panel').hidden && !document.hidden && !$('ask').open && !$('acct').open && !$('crop').open) loadAccounts().catch(() => undefined)
}, 20000)

// ——— Ficha completa de una cuenta ———
/** Foto de la cuenta (si tiene) o su inicial */
function avatarOf(u, big = false) {
  const a = document.createElement('span')
  a.className = `avatar${big ? ' big' : ''}`
  if (u.avatar) {
    const img = document.createElement('img')
    img.alt = ''
    img.src = `/api/accounts/${u.id}/avatar?v=${encodeURIComponent(u.avatar)}`
    a.append(img)
  } else a.textContent = u.username.charAt(0).toUpperCase()
  return a
}


/** Una fila "nombre: valor" de la ficha */
function row(label, ...value) {
  const dt = document.createElement('dt')
  dt.textContent = label
  const dd = document.createElement('dd')
  dd.append(...value)
  return [dt, dd]
}

let acctId = null
async function openAccount(id) {
  acctId = id
  const d = await api(`/accounts/${id}`).catch((e) => (toast(e.message), null))
  if (!d) return
  const refresh = (msg) => {
    toast(msg)
    loadAccounts()
    loadAudit()
    openAccount(id)
  }
  const body = $('acct-body')
  body.replaceChildren()

  // Cabecera: foto, nombre y estado
  const head = document.createElement('div')
  head.className = 'acct-head'
  const info = document.createElement('div')
  const h = document.createElement('h2')
  h.textContent = d.username
  const st = document.createElement('div')
  const dot = document.createElement('span')
  dot.className = `dot ${d.state}`
  st.append(dot, d.state === 'playing' ? `Jugando a ${d.gameName}${d.mc?.name ? ` («${d.mc.name}»)` : ''} · ${minutes(d.since)}` : d.state === 'online' ? 'En PoxiLauncher' : 'Desconectado')
  if (d.blocked) st.append(tag('Bloqueada', 'bad'))
  if (d.mustChange) st.append(tag('Contraseña temporal', 'warn'))
  info.append(h, st)
  head.append(avatarOf(d, true), info)

  // Foto: cambiarla (con recorte) o quitarla
  const photo = document.createElement('div')
  photo.className = 'acct-buttons'
  const change = document.createElement('button')
  change.className = 'btn small'
  change.textContent = '🖼️ Cambiar foto'
  change.onclick = () => $('photo-file').click()
  photo.append(change)
  if (d.avatar)
    photo.append(
      confirmButton('Quitar foto', async () => {
        await api(`/accounts/${id}/avatar`, { method: 'DELETE' })
        refresh(`🖼️ Foto de ${d.username} quitada`)
      })
    )

  // Alta: se puede cambiar la fecha
  const created = document.createElement('div')
  created.className = 'acct-buttons'
  const date = document.createElement('input')
  date.type = 'date'
  date.min = '2020-01-01'
  date.max = new Date().toISOString().slice(0, 10)
  date.value = new Date(d.createdAt).toISOString().slice(0, 10)
  const saveDate = document.createElement('button')
  saveDate.className = 'btn small'
  saveDate.textContent = 'Guardar'
  saveDate.onclick = async () => {
    const [y, m, dd] = date.value.split('-').map(Number)
    try {
      await api(`/accounts/${id}/created`, json('POST', { createdAt: Date.UTC(y, m - 1, dd, 12) }))
      refresh(`📅 Alta de ${d.username}: ${date.value}`)
    } catch (e) {
      toast(e.message)
    }
  }
  created.append(date, saveDate)

  // Versión de la app: al día o desactualizada
  const version = document.createElement('span')
  if (!d.appVersion) version.textContent = '—'
  else {
    version.textContent = `v${d.appVersion}`
    if (currentVersion) version.append(d.appVersion === currentVersion ? tag('Al día', 'ok') : tag(`Desactualizada (actual ${currentVersion})`, 'warn'))
  }

  const names = (list) => (list.length ? list.map((x) => x.username).join(', ') : '—')
  const dl = document.createElement('dl')
  dl.className = 'acct-data'
  dl.append(
    ...row('Foto', photo),
    ...row('Usuario', d.username),
    ...row('Alta', created),
    ...row('Última conexión', d.state === 'offline' ? (d.lastSeen ? fmtDate(d.lastSeen) : '—') : 'Ahora'),
    ...row('Versión de la app', version),
    ...row(`Amigos (${d.friends.length})`, names(d.friends)),
    ...row('Solicitudes', `Recibidas: ${names(d.incoming)} · Enviadas: ${names(d.outgoing)}`),
    ...row('Id', d.id)
  )
  body.append(head, dl)
  if (!$('acct').open) $('acct').showModal()
}
$('acct-close').onclick = () => $('acct').close()

// ——— Recortar y subir la foto de una cuenta (WebP 256×256, como hace la app) ———
const VIEW = 280
const crop = { img: null, zoom: 1, x: 0, y: 0, drag: null }
const cropScale = () => (crop.img ? Math.max(VIEW / crop.img.naturalWidth, VIEW / crop.img.naturalHeight) * crop.zoom : 1)
function cropClamp() {
  const s = cropScale()
  const mx = Math.max(0, (crop.img.naturalWidth * s - VIEW) / 2)
  const my = Math.max(0, (crop.img.naturalHeight * s - VIEW) / 2)
  crop.x = Math.min(mx, Math.max(-mx, crop.x))
  crop.y = Math.min(my, Math.max(-my, crop.y))
}
function cropDraw() {
  if (!crop.img) return
  cropClamp()
  const img = $('crop-img')
  img.style.width = `${crop.img.naturalWidth}px`
  img.style.height = `${crop.img.naturalHeight}px`
  img.style.transform = `translate(-50%, -50%) translate(${crop.x}px, ${crop.y}px) scale(${cropScale()})`
}
$('photo-file').addEventListener('change', () => {
  const f = $('photo-file').files?.[0]
  $('photo-file').value = ''
  if (!f) return
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(f.type) || f.size > 15 * 1024 * 1024) return toast('Esa imagen no vale: PNG, JPG, WebP o GIF de hasta 15 MB')
  const reader = new FileReader()
  reader.onload = () => {
    const i = new Image()
    i.onload = () => {
      Object.assign(crop, { img: i, zoom: 1, x: 0, y: 0 })
      $('crop-img').src = i.src
      $('crop-zoom').value = '1'
      $('crop-error').hidden = true
      cropDraw()
      $('crop').showModal()
    }
    i.onerror = () => toast('No se pudo abrir esa imagen')
    i.src = String(reader.result)
  }
  reader.readAsDataURL(f)
})
const view = $('crop-view')
view.addEventListener('pointerdown', (e) => {
  view.setPointerCapture(e.pointerId)
  crop.drag = { x: e.clientX, y: e.clientY, px: crop.x, py: crop.y }
})
view.addEventListener('pointermove', (e) => {
  if (!crop.drag) return
  crop.x = crop.drag.px + e.clientX - crop.drag.x
  crop.y = crop.drag.py + e.clientY - crop.drag.y
  cropDraw()
})
view.addEventListener('pointerup', () => (crop.drag = null))
view.addEventListener('pointercancel', () => (crop.drag = null))
view.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault()
    crop.zoom = Math.min(4, Math.max(1, crop.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))
    $('crop-zoom').value = String(crop.zoom)
    cropDraw()
  },
  { passive: false }
)
$('crop-zoom').addEventListener('input', () => {
  crop.zoom = Number($('crop-zoom').value)
  cropDraw()
})
$('crop-cancel').onclick = () => $('crop').close()
$('crop-save').onclick = async () => {
  if (!crop.img || !acctId) return
  const s = cropScale()
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const g = canvas.getContext('2d')
  g.imageSmoothingQuality = 'high'
  g.drawImage(crop.img, (-VIEW / 2 - crop.x) / s + crop.img.naturalWidth / 2, (-VIEW / 2 - crop.y) / s + crop.img.naturalHeight / 2, VIEW / s, VIEW / s, 0, 0, 256, 256)
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.86))
  try {
    await api(`/accounts/${acctId}/avatar`, { method: 'PUT', headers: { 'Content-Type': 'image/webp' }, body: blob })
    $('crop').close()
    toast('🖼️ Foto cambiada')
    loadAccounts()
    loadAudit()
    openAccount(acctId)
  } catch (e) {
    $('crop-error').textContent = e.message
    $('crop-error').hidden = false
  }
}

// ——— Minecraft: packs compartidos y mundos del grupo ———
// ——— Denuncias de mensajes y cuentas ———
const REASONS = { spam: 'Spam', harassment: 'Acoso', inappropriate: 'Contenido inapropiado', impersonation: 'Suplantación', other: 'Otro' }
const ACTIONS = { dismiss: 'Descartada', delete: 'Mensaje borrado', block: 'Cuenta bloqueada', deleteBlock: 'Mensaje borrado y cuenta bloqueada' }

/** Un mensaje copiado en la denuncia, en una línea */
function quote(m, bad = false) {
  const p = document.createElement('p')
  p.className = `rep-msg ${bad ? 'bad' : ''}`
  const who = document.createElement('b')
  who.textContent = `${m.from.username} `
  const when = document.createElement('small')
  when.className = 'muted'
  when.textContent = new Date(m.at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
  const body = document.createElement('span')
  body.textContent = m.text ?? (m.gif ? `[GIF] ${m.gif}` : m.sticker ? '[sticker]' : m.media ? `[${m.media === 'video' ? 'clip' : 'captura'}]` : m.invite ? `[invitación a «${m.invite}»]` : '')
  p.append(who, when, document.createElement('br'), body)
  return p
}

async function loadReports() {
  const { open, resolved } = await api('/reports')
  $('reports-empty').hidden = open.length > 0
  $('reports-summary').textContent = open.length ? `${open.length} sin revisar` : ''
  const box = $('reports')
  box.replaceChildren()
  for (const r of open) {
    const card = document.createElement('div')
    card.className = 'rep'
    const head = document.createElement('div')
    head.className = 'rep-head'
    const title = document.createElement('div')
    const t = document.createElement('b')
    t.textContent = `${r.kind === 'message' ? '💬 Mensaje' : '👤 Cuenta'} de ${r.user.username}`
    title.append(t, tag(REASONS[r.reason] ?? r.reason, 'warn'))
    if (r.user.blocked) title.append(tag('Ya bloqueada', 'bad'))
    const meta = document.createElement('small')
    meta.className = 'muted'
    meta.textContent = `Denuncia ${r.by.username} · ${ago(r.at)}${r.snapshot?.chat?.kind === 'group' ? ` · grupo «${r.snapshot.chat.name ?? ''}»` : r.snapshot ? ' · privado' : ''}`
    head.append(title, meta)
    card.append(head)
    if (r.text) {
      const note = document.createElement('p')
      note.className = 'rep-note'
      note.textContent = `«${r.text}»`
      card.append(note)
    }
    if (r.snapshot) {
      const conv = document.createElement('div')
      conv.className = 'rep-conv'
      for (const m of r.snapshot.context) conv.append(quote(m))
      conv.append(quote(r.snapshot.message, true))
      card.append(conv)
    }
    const actions = document.createElement('div')
    actions.className = 'acct-buttons'
    const act = (label, action, danger = false) => {
      const run = async () => {
        await api(`/reports/${r.id}/resolve`, json('POST', { action }))
        toast(`🚩 ${ACTIONS[action]}`)
        loadReports()
        loadAccounts()
      }
      if (danger) return confirmButton(label, run)
      const b = document.createElement('button')
      b.className = 'btn small'
      b.textContent = label
      b.onclick = run
      return b
    }
    if (r.snapshot) actions.append(act('🗑️ Borrar mensaje', 'delete', true), act('⛔ Borrar y bloquear cuenta', 'deleteBlock', true))
    else actions.append(act('⛔ Bloquear cuenta', 'block', true))
    actions.append(act('✓ Descartar', 'dismiss'))
    card.append(actions)
    box.append(card)
  }
  const done = $('reports-done')
  done.replaceChildren()
  for (const r of resolved) {
    const li = document.createElement('li')
    li.textContent = `${fmtDate(r.resolved.at)} · ${r.kind === 'message' ? 'mensaje' : 'cuenta'} de ${r.user.username} (${REASONS[r.reason] ?? r.reason}) → ${ACTIONS[r.resolved.action] ?? r.resolved.action}`
    done.append(li)
  }
}

async function loadPacks() {
  const list = await api('/mc/packs')
  const disk = list.reduce((n, p) => n + (p.world?.size ?? 0), 0)
  const worlds = list.filter((p) => p.world).length
  $('packs-empty').hidden = list.length > 0
  $('packs-summary').textContent = list.length ? `${list.length} ${list.length === 1 ? 'pack' : 'packs'} · ${worlds} ${worlds === 1 ? 'mundo' : 'mundos'} · ${fmtSize(disk)} en disco` : ''
  const tbody = $('packs')
  tbody.replaceChildren()
  for (const p of list) {
    const tr = document.createElement('tr')
    const done = (msg) => {
      toast(msg)
      loadPacks()
    }

    const tdP = document.createElement('td')
    const name = document.createElement('b')
    name.textContent = p.name
    const sub = document.createElement('small')
    sub.textContent = `Minecraft ${p.mc} · ${p.loader} · ${p.items} mods y packs · rev. ${p.rev}${p.updatedAt ? ` · ${ago(p.updatedAt)}` : ''}`
    tdP.append(name, sub)

    const tdM = document.createElement('td')
    tdM.textContent = p.members.map((m) => (m.id === p.owner.id ? `👑 ${m.username}` : m.username)).join(' · ') || '—'
    if (p.invited) tdM.append(tag(`${p.invited} invitados`, 'warn'))

    const tdW = document.createElement('td')
    if (p.world) {
      tdW.append(`${fmtSize(p.world.size)} · ${p.world.by.username}, ${ago(p.world.at)}`)
      if (p.hosting) tdW.append(tag(`Lo aloja ${p.hosting.username}`, 'ok'))
    } else tdW.textContent = p.hosting ? `Lo aloja ${p.hosting.username} (aún sin subir)` : '—'

    const tdA = document.createElement('td')
    tdA.className = 'actions'
    if (p.world)
      tdA.append(
        confirmButton('Borrar mundo', async () => {
          await api(`/mc/packs/${p.id}/world`, { method: 'DELETE' })
          done(`🗺️ Mundo de «${p.name}» borrado`)
        }, 'El pack sigue; el próximo que lo aloje empieza un mundo nuevo')
      )
    tdA.append(
      confirmButton('Borrar pack', async () => {
        await api(`/mc/packs/${p.id}`, { method: 'DELETE' })
        done(`🗑️ Pack «${p.name}» borrado`)
      }, 'Desaparece para todos sus miembros, con su mundo')
    )
    tr.append(tdP, tdM, tdW, tdA)
    tbody.append(tr)
  }
}

// ——— Arranque ———
api('/auth/me')
  .then(() => {
    show('panel')
    return Promise.all([loadReleases(), loadAccounts(), loadPacks(), loadReports()])
  })
  .catch(() => show('login'))
