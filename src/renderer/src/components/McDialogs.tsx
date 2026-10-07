import { useEffect, useMemo, useState } from 'react'
import { Check, FolderOpen, Loader2, LogIn, Shirt, Trash2, TriangleAlert, UserRound } from 'lucide-react'
import type { McAccount, McInstance, McLoader, McState, McVersion } from '@shared/types'
import { invoke } from '../api'
import { navigate, toast, useStore } from '../store'
import { useT } from '../i18n'
import { Modal } from './Overlays'
import { Select } from './Select'
import playerHead from '../assets/mc/player-head.png'
import { SkinDialog } from './McSkin'

// Ventanas de la sección Minecraft (con el estilo de la sección: clase mc-modal)

/** Cara del jugador: de su skin (cara + capa del sombrero) o, sin conexión, la cabeza por defecto */
export function McHead({ account, size = 32 }: { account: McAccount | null; size?: number }): React.JSX.Element {
  if (!account?.skin) return <img className="mc-head" src={playerHead} width={size} height={size} alt="" draggable={false} />
  const url = `url("${account.skin.replace(/"/g, '')}")`
  return (
    <span
      className="mc-head"
      style={{
        width: size,
        height: size,
        backgroundImage: `${url}, ${url}`,
        backgroundSize: `${size * 8}px auto`,
        backgroundPosition: `${-size * 5}px ${-size}px, ${-size}px ${-size}px`
      }}
    />
  )
}

export function AccountsDialog({ mc, onClose }: { mc: McState; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const code = useStore((s) => s.mcCode)
  const [signing, setSigning] = useState(false)
  const [skinOf, setSkinOf] = useState<McAccount | null>(null)
  const [name, setName] = useState('')
  const validName = /^[A-Za-z0-9_]{3,16}$/.test(name)

  const microsoft = async (): Promise<void> => {
    setSigning(true)
    const r = await invoke('mc:addMicrosoft').finally(() => setSigning(false))
    if (!r.ok && r.error && r.error !== 'mc.auth.cancelled') toast({ kind: 'error', key: r.error })
  }

  const offline = async (): Promise<void> => {
    if (!validName) return
    const r = await invoke('mc:addOffline', name)
    if (r.ok) setName('')
    else if (r.error) toast({ kind: 'error', key: r.error })
  }

  return (
    <Modal
      className="mc-modal"
      title={t('mc.accounts.title')}
      onClose={() => {
        if (signing) void invoke('mc:cancelLogin')
        onClose()
      }}
      actions={
        <button className="mc-btn" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      {!!mc.accounts.length && (
        <ul className="mc-accounts">
          {mc.accounts.map((a) => {
            const active = a.id === mc.activeAccount
            return (
              <li key={a.id} className={active ? 'active' : ''}>
                <span className="mc-slot mc-slot-sm">
                  <McHead account={a} size={28} />
                </span>
                <span className="mc-account-text">
                  <b>{a.name}</b>
                  <small>{t(a.kind === 'msa' ? 'mc.accounts.kindMsa' : 'mc.accounts.kindOffline')}</small>
                </span>
                {active ? (
                  <span className="mc-tag mc-tag-on">
                    <Check size={12} /> {t('mc.accounts.active')}
                  </span>
                ) : (
                  <button className="mc-btn mc-btn-sm" onClick={() => void invoke('mc:setAccount', a.id)}>
                    {t('mc.accounts.use')}
                  </button>
                )}
                {a.kind === 'msa' && (
                  <button className="mc-btn mc-btn-sm mc-btn-lapis" onClick={() => setSkinOf(a)}>
                    <Shirt size={14} /> {t('mc.skin.button')}
                  </button>
                )}
                <button className="mc-iconbtn mc-iconbtn-danger" title={t('mc.accounts.remove')} onClick={() => void invoke('mc:removeAccount', a.id)}>
                  <Trash2 size={16} />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="mc-add">
        <div className="mc-add-head">
          <b>{t('mc.accounts.microsoft')}</b>
          <small>{t('mc.accounts.microsoftSub')}</small>
        </div>
        {signing ? (
          <div className="mc-signing">
            <Loader2 size={16} className="spin" />
            <span>
              {t('mc.accounts.waiting')}
              {code && <em>{t('mc.accounts.code', { code })}</em>}
            </span>
            <button className="mc-btn mc-btn-sm" onClick={() => void invoke('mc:cancelLogin')}>
              {t('common.cancel')}
            </button>
          </div>
        ) : (
          <button className="mc-btn mc-btn-lapis" disabled={!mc.msa} onClick={() => void microsoft()}>
            <LogIn size={16} /> {t('mc.accounts.microsoft')}
          </button>
        )}
      </div>

      <div className="mc-add">
        <div className="mc-add-head">
          <b>{t('mc.accounts.offline')}</b>
          <small>{t('mc.accounts.offlineSub')}</small>
        </div>
        <form
          className="mc-add-row"
          onSubmit={(e) => {
            e.preventDefault()
            void offline()
          }}
        >
          <input
            className="mc-input"
            value={name}
            maxLength={16}
            placeholder={t('mc.accounts.offlineName')}
            onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))}
            aria-label={t('mc.accounts.offlineName')}
          />
          <button className="mc-btn" type="submit" disabled={!validName}>
            <UserRound size={16} /> {t('mc.accounts.add2')}
          </button>
        </form>
        <small className="mc-hint">{t('mc.accounts.offlineHint')}</small>
        <p className="mc-warn">
          <TriangleAlert size={15} /> {t('mc.accounts.offlineWarn')}
        </p>
      </div>
      {skinOf && <SkinDialog account={skinOf} onClose={() => setSkinOf(null)} />}
    </Modal>
  )
}

export function CreateDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const t = useT()
  const [versions, setVersions] = useState<McVersion[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [snapshots, setSnapshots] = useState(false)
  const [name, setName] = useState('')
  const [version, setVersion] = useState('')
  const [loader, setLoader] = useState<McLoader>('vanilla')
  const [loaderList, setLoaderList] = useState<{ id: string; stable: boolean }[] | null>(null)
  const [loaderVersion, setLoaderVersion] = useState('')
  const [saving, setSaving] = useState(false)

  // Versiones del loader para la versión elegida (la recomendada ya marcada)
  useEffect(() => {
    setLoaderList(null)
    setLoaderVersion('')
    if (loader === 'vanilla' || !version) return
    let alive = true
    invoke('mc:loaderVersions', loader, version)
      .then((list) => {
        if (!alive) return
        setLoaderList(list)
        setLoaderVersion((list.find((v) => v.stable) ?? list[0])?.id ?? '')
      })
      .catch(() => alive && setLoaderList([]))
    return () => {
      alive = false
    }
  }, [loader, version])

  useEffect(() => {
    invoke('mc:versions')
      .then((v) => {
        setVersions(v)
        setVersion(v.find((x) => x.type === 'release')?.id ?? '')
      })
      .catch(() => setFailed(true))
  }, [])

  const options = useMemo(
    () => (versions ?? []).filter((v) => v.type === 'release' || (snapshots && v.type === 'snapshot')).map((v) => ({ value: v.id, label: v.id })),
    [versions, snapshots]
  )

  const loaderReady = loader === 'vanilla' || !!loaderVersion
  const loaderName = t(`mc.loader.${loader}`)
  const loaderOptions = useMemo(
    () =>
      (loaderList ?? []).map((v, i) => ({
        value: v.id,
        label: v.stable && (loaderList ?? []).findIndex((x) => x.stable) === i ? `${v.id} (${t('mc.create.recommended')})` : v.id
      })),
    [loaderList, t]
  )

  const create = async (): Promise<void> => {
    if (!version || !loaderReady) return
    setSaving(true)
    try {
      const fallback = loader === 'vanilla' ? `Minecraft ${version}` : `${loaderName} ${version}`
      await invoke('mc:create', name.trim() || fallback, version, loader, loader === 'vanilla' ? undefined : loaderVersion)
      onClose()
    } catch {
      toast({ kind: 'error', key: 'mc.create.offline' })
      setSaving(false)
    }
  }

  return (
    <Modal
      className="mc-modal"
      title={t('mc.create.title')}
      onClose={onClose}
      actions={
        <>
          <button className="mc-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="mc-btn mc-btn-emerald" disabled={!version || !loaderReady || saving} onClick={() => void create()}>
            {t('mc.create.create')}
          </button>
        </>
      }
    >
      <label className="mc-field">
        <span>{t('mc.create.name')}</span>
        <input
          className="mc-input"
          value={name}
          maxLength={40}
          autoFocus
          placeholder={version ? `Minecraft ${version}` : t('mc.create.namePlaceholder')}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="mc-field">
        <span>{t('mc.create.version')}</span>
        {failed ? (
          <p className="mc-warn">{t('mc.create.offline')}</p>
        ) : !versions ? (
          <p className="mc-hint">
            <Loader2 size={14} className="spin" /> {t('mc.create.loading')}
          </p>
        ) : (
          <Select value={version} options={options} onChange={setVersion} className="mc-select" menuClassName="mc-menu" ariaLabel={t('mc.create.version')} />
        )}
      </div>
      <div className="mc-field">
        <span>{t('mc.create.loader')}</span>
        <div className="mc-seg" role="radiogroup" aria-label={t('mc.create.loader')}>
          {(['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'] as McLoader[]).map((l) => (
            <button key={l} type="button" role="radio" aria-checked={loader === l} className={loader === l ? 'on' : ''} onClick={() => setLoader(l)}>
              {t(`mc.loader.${l}`)}
            </button>
          ))}
        </div>
      </div>
      {loader !== 'vanilla' && (
        <div className="mc-field">
          <span>{t('mc.create.loaderVersion')}</span>
          {!loaderList ? (
            <p className="mc-hint">
              <Loader2 size={14} className="spin" /> {t('mc.create.loadingLoader', { loader: loaderName })}
            </p>
          ) : loaderList.length ? (
            <Select value={loaderVersion} options={loaderOptions} onChange={setLoaderVersion} className="mc-select" menuClassName="mc-menu" ariaLabel={t('mc.create.loaderVersion')} />
          ) : (
            <p className="mc-warn">{t('mc.create.noLoader', { loader: loaderName, v: version })}</p>
          )}
        </div>
      )}
      <label className="mc-check">
        <input
          type="checkbox"
          checked={snapshots}
          onChange={(e) => {
            setSnapshots(e.target.checked)
            // Al ocultarlas, si estaba elegida una snapshot se vuelve a la última versión normal
            if (!e.target.checked && versions?.find((v) => v.id === version)?.type === 'snapshot')
              setVersion(versions.find((v) => v.type === 'release')?.id ?? '')
          }}
        />
        {t('mc.create.snapshots')}
      </label>
    </Modal>
  )
}

const RAM_STEPS = [2, 3, 4, 6, 8, 10, 12, 16]

export function EditDialog({ inst, autoRamMB, onClose }: { inst: McInstance; autoRamMB: number; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const [name, setName] = useState(inst.name)
  const [ram, setRam] = useState<number>(inst.ramMB ?? 0)
  const [autoBackup, setAutoBackup] = useState(inst.autoBackup !== false)
  const [shareSettings, setShareSettings] = useState(inst.shareSettings !== false)
  const gb = (mb: number): string => String(Math.round((mb / 1024) * 10) / 10)
  const options = [{ value: 0, label: t('mc.edit.ramAuto', { gb: gb(autoRamMB) }) }, ...RAM_STEPS.map((g) => ({ value: g * 1024, label: `${g} GB` }))]

  const save = async (): Promise<void> => {
    await invoke('mc:update', inst.id, { name: name.trim() || inst.name, ramMB: ram || null, autoBackup, shareSettings })
    onClose()
  }

  return (
    <Modal
      className="mc-modal"
      title={t('mc.edit.title', { name: inst.name })}
      onClose={onClose}
      actions={
        <>
          <button className="mc-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="mc-btn mc-btn-emerald" onClick={() => void save()}>
            {t('mc.edit.save')}
          </button>
        </>
      }
    >
      <label className="mc-field">
        <span>{t('mc.create.name')}</span>
        <input className="mc-input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="mc-field">
        <span>{t('mc.edit.ram')}</span>
        <Select value={ram} options={options} onChange={setRam} className="mc-select" menuClassName="mc-menu" ariaLabel={t('mc.edit.ram')} />
        <small className="mc-hint">{t('mc.edit.ramHint')}</small>
      </div>
      <McToggle on={autoBackup} onChange={setAutoBackup} label={t('mc.edit.autoBackup')} sub={t('mc.edit.autoBackupSub')} />
      <McToggle on={shareSettings} onChange={setShareSettings} label={t('mc.edit.shareSettings')} sub={t('mc.edit.shareSettingsSub')} />
    </Modal>
  )
}

/** Fila con interruptor de píxel */
export function McToggle({ on, onChange, label, sub }: { on: boolean; onChange: (v: boolean) => void; label: string; sub?: string }): React.JSX.Element {
  return (
    <div className="mc-toggle-row">
      <span>
        <b>{label}</b>
        {sub && <small>{sub}</small>}
      </span>
      <button type="button" className={`mc-switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />
    </div>
  )
}

export function DuplicateDialog({ inst, onClose }: { inst: McInstance; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const [worlds, setWorlds] = useState(true)
  const [busy, setBusy] = useState(false)
  const go = async (): Promise<void> => {
    setBusy(true)
    const id = await invoke('mc:duplicate', inst.id, worlds).finally(() => setBusy(false))
    onClose()
    navigate({ name: 'mcInstance', id })
  }
  return (
    <Modal
      className="mc-modal"
      title={t('mc.duplicate.title', { name: inst.name })}
      onClose={onClose}
      actions={
        <>
          <button className="mc-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="mc-btn mc-btn-emerald" disabled={busy} onClick={() => void go()}>
            {busy && <Loader2 size={16} className="spin" />} {t('mc.duplicate.confirm')}
          </button>
        </>
      }
    >
      <p>{t('mc.duplicate.text')}</p>
      <label className="mc-check">
        <input type="checkbox" checked={worlds} onChange={(e) => setWorlds(e.target.checked)} />
        {t('mc.duplicate.worlds')}
      </label>
    </Modal>
  )
}

export function LogDialog({ inst, onClose }: { inst: McInstance; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const [log, setLog] = useState<string | null>(null)
  useEffect(() => {
    void invoke('mc:log', inst.id).then(setLog)
  }, [inst.id])

  return (
    <Modal
      className="mc-modal"
      wide
      title={t('mc.log.title', { name: inst.name })}
      onClose={onClose}
      actions={
        <>
          <button className="mc-btn" onClick={() => void invoke('mc:openFolder', inst.id)}>
            <FolderOpen size={16} /> {t('mc.menu.folder')}
          </button>
          <button className="mc-btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </>
      }
    >
      {log === null ? null : log ? (
        <pre
          className="mc-log"
          ref={(el) => {
            // Lo último (donde suele estar el error) a la vista
            if (el) el.scrollTop = el.scrollHeight
          }}
        >
          {log}
        </pre>
      ) : (
        <p className="mc-hint">{t('mc.log.empty')}</p>
      )}
    </Modal>
  )
}

export function DeleteDialog({ inst, onClose }: { inst: McInstance; onClose: () => void }): React.JSX.Element {
  const t = useT()
  return (
    <Modal
      className="mc-modal"
      title={t('mc.remove.title', { name: inst.name })}
      onClose={onClose}
      actions={
        <>
          <button className="mc-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="mc-btn mc-btn-redstone"
            onClick={async () => {
              await invoke('mc:delete', inst.id)
              onClose()
            }}
          >
            <Trash2 size={16} /> {t('mc.remove.confirm')}
          </button>
        </>
      }
    >
      <p>{t('mc.remove.text')}</p>
    </Modal>
  )
}
