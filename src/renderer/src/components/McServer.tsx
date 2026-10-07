import { useEffect, useRef, useState } from 'react'
import { ExternalLink, FolderOpen, LogIn, Power, PowerOff, Send, Server, Settings2, Users, Wifi, WifiOff } from 'lucide-react'
import type { McInstance, McPack, McServerConfig, McState, McWorld } from '@shared/types'
import { invoke, on } from '../api'
import { toast } from '../store'
import { useT } from '../i18n'
import { formatRelative } from '../lib/format'
import { Select } from './Select'
import { McToggle } from './McDialogs'
import { useFriendName } from './Account'

// Servidor de Minecraft en tu PC a partir de la instancia, abierto a tus amigos por el túnel de PoxiLauncher

const RAM = [2, 3, 4, 6, 8]

function ServerForm({ inst, pack, onDone }: { inst: McInstance; pack: McPack | undefined; onDone?: () => void }): React.JSX.Element {
  const t = useT()
  const cfg = inst.server
  const [online, setOnline] = useState(cfg?.online ?? false)
  const [ram, setRam] = useState(cfg?.ramMB ?? 3072)
  const [motd, setMotd] = useState(cfg?.motd ?? '')
  const [world, setWorld] = useState<string>(cfg ? (typeof cfg.world === 'object' ? `copy:${cfg.world.copy}` : cfg.world) : pack ? 'group' : 'new')
  const [eula, setEula] = useState(!!cfg)
  const [worlds, setWorlds] = useState<McWorld[]>([])

  useEffect(() => {
    void invoke('mc:worlds', inst.id).then(setWorlds)
  }, [inst.id])

  const worldOptions = [
    { value: 'new', label: t('mc.server.worldNew') },
    ...worlds.map((w) => ({ value: `copy:${w.id}`, label: t('mc.server.worldCopy', { name: w.id }) })),
    ...(inst.packId ? [{ value: 'group', label: t('mc.server.worldGroup') }] : [])
  ]

  const save = async (): Promise<void> => {
    const w: McServerConfig['world'] = world.startsWith('copy:') ? { copy: world.slice(5) } : (world as 'new' | 'group')
    await invoke('mc:serverSetup', inst.id, { online, ramMB: ram, motd: motd.trim() || inst.name, world: w })
    onDone?.()
  }

  return (
    <div className="mc-panel mc-server-form">
      {!cfg && (
        <>
          <h2 className="mc-title">
            <Server size={16} /> {t('mc.server.title')}
          </h2>
          <p className="mc-hint mc-hint-block">{t('mc.server.intro')}</p>
        </>
      )}
      <label className="mc-field">
        <span>{t('mc.server.motd')}</span>
        <input className="mc-input" value={motd} maxLength={60} placeholder={inst.name} onChange={(e) => setMotd(e.target.value)} />
      </label>
      <div className="mc-field">
        <span>{t('mc.server.world')}</span>
        <Select value={world} options={worldOptions} onChange={setWorld} className="mc-select" menuClassName="mc-menu" ariaLabel={t('mc.server.world')} />
      </div>
      <div className="mc-field">
        <span>{t('mc.server.ram')}</span>
        <Select value={ram} options={RAM.map((g) => ({ value: g * 1024, label: `${g} GB` }))} onChange={setRam} className="mc-select" menuClassName="mc-menu" ariaLabel={t('mc.server.ram')} />
      </div>
      <McToggle on={online} onChange={setOnline} label={t('mc.server.online')} sub={t('mc.server.onlineSub')} />
      {!cfg && (
        <label className="mc-check mc-eula">
          <input type="checkbox" checked={eula} onChange={(e) => setEula(e.target.checked)} />
          {t('mc.server.eula')}
          <button type="button" className="mc-link" onClick={() => void invoke('mc:openEula')}>
            {t('mc.server.eulaLink')} <ExternalLink size={12} />
          </button>
        </label>
      )}
      <div className="mc-form-actions">
        <button className="mc-btn mc-btn-emerald" disabled={!eula} onClick={() => void save()}>
          <Server size={16} /> {cfg ? t('mc.server.save') : t('mc.server.create')}
        </button>
      </div>
    </div>
  )
}

export function McServerTab({ inst, mc, pack }: { inst: McInstance; mc: McState; pack: McPack | undefined }): React.JSX.Element {
  const t = useT()
  const who = useFriendName()
  const live = mc.servers[inst.id]
  const [editing, setEditing] = useState(false)
  const [lines, setLines] = useState<string[]>([])
  const [cmd, setCmd] = useState('')
  const pre = useRef<HTMLPreElement>(null)

  useEffect(() => {
    void invoke('mc:serverLog', inst.id).then(setLines)
    return on('minecraftServerLog', (e) => {
      if (e.instanceId === inst.id) setLines((l) => [...l.slice(-1999), e.line])
    })
  }, [inst.id])

  // La consola sigue lo último, salvo que hayas subido a leer algo (al volver abajo, vuelve a seguirlo)
  const stick = useRef(true)
  useEffect(() => {
    const el = pre.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [lines, editing])

  if (!inst.server || editing) return <ServerForm inst={inst} pack={pack} onDone={() => setEditing(false)} />

  const state = live?.state ?? 'off'
  const start = async (): Promise<void> => {
    const r = await invoke('mc:serverStart', inst.id)
    if (r.error) toast({ kind: 'error', key: r.error, params: r.params })
  }
  const send = (): void => {
    if (!cmd.trim()) return
    void invoke('mc:serverCommand', inst.id, cmd.trim())
    setCmd('')
  }
  const groupBusy = inst.server.world === 'group' && pack?.lock && !live ? who(pack.lock.by) : null

  return (
    <section className="mc-server">
      <div className="mc-panel mc-server-head">
        <span className={`mc-server-dot ${state}`} />
        <div className="mc-server-info">
          <b>{t(`mc.server.state.${state}`)}</b>
          <small>
            {live?.state === 'running' ? (live.players.length ? `${t('mc.server.players', { n: live.players.length })}: ${live.players.join(', ')}` : t('mc.server.nobody')) : inst.server.motd}
          </small>
          {live?.state === 'running' && (
            <small className={live.tunnel ? 'ok' : ''}>
              {live.tunnel ? <Wifi size={12} /> : <WifiOff size={12} />} {live.tunnel ? t('mc.server.tunnel') : t('mc.server.noTunnel')}
              {live.port ? ` · ${t('mc.server.local', { port: live.port })}` : ''}
            </small>
          )}
        </div>
        <div className="mc-server-actions">
          {state === 'running' && (
            <button className="mc-btn mc-btn-emerald" disabled={!!mc.running || !!mc.busy} onClick={() => void invoke('mc:playOwnServer', inst.id)}>
              <LogIn size={16} /> {t('mc.server.join')}
            </button>
          )}
          {live ? (
            <button className="mc-btn mc-btn-redstone" disabled={state === 'stopping' || state === 'installing'} onClick={() => void invoke('mc:serverStop', inst.id)}>
              <PowerOff size={16} /> {t('mc.server.stop')}
            </button>
          ) : (
            <button className="mc-btn mc-btn-emerald" disabled={!!groupBusy || !!mc.busy} onClick={() => void start()}>
              <Power size={16} /> {t('mc.server.start')}
            </button>
          )}
          <button className="mc-iconbtn" title={t('mc.server.settings')} aria-label={t('mc.server.settings')} disabled={!!live} onClick={() => setEditing(true)}>
            <Settings2 size={18} />
          </button>
          <button className="mc-iconbtn" title={t('mc.server.folder')} aria-label={t('mc.server.folder')} onClick={() => void invoke('mc:serverOpenFolder', inst.id)}>
            <FolderOpen size={18} />
          </button>
        </div>
      </div>

      {inst.server.world === 'group' && pack && (
        <p className="mc-hint mc-hint-block">
          <Users size={14} />{' '}
          {groupBusy
            ? t('mc.server.groupBusy', { user: groupBusy })
            : pack.world
              ? t('mc.server.groupWorld', { rev: pack.world.rev, user: who(pack.world.by), when: formatRelative(pack.world.at, t) })
              : t('mc.server.groupEmpty')}
        </p>
      )}

      <pre
        ref={pre}
        className="mc-log mc-console"
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {lines.join('\n')}
      </pre>
      <form
        className="mc-add-row mc-console-input"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <input className="mc-input" value={cmd} maxLength={300} disabled={state !== 'running'} placeholder={t('mc.server.command')} onChange={(e) => setCmd(e.target.value)} />
        <button className="mc-btn" type="submit" disabled={state !== 'running' || !cmd.trim()}>
          <Send size={16} /> {t('mc.server.send')}
        </button>
      </form>
    </section>
  )
}
