import { useEffect, useState } from 'react'
import { ChevronDown, FileUp, FolderInput, Loader2, Plus, Shirt, TriangleAlert, Users } from 'lucide-react'
import '@fontsource-variable/archivo'
import '@fontsource/archivo-black'
import type { McImportable, McInstance, McState } from '@shared/types'
import { invoke } from '../api'
import { navigate, setState, toast, updateSettings, useStore } from '../store'
import { useT } from '../i18n'
import { formatDuration, formatRelative } from '../lib/format'
import { McPlay, versionLabel } from '../components/McPlay'
import { AccountsDialog, CreateDialog, McHead } from '../components/McDialogs'
import { SkinDialog } from '../components/McSkin'
import { McInstanceMenu } from '../components/McInstanceMenu'
import { McExplore } from '../components/McExplore'
import { CloudPacks, PackInvites } from '../components/McShare'
import { ImportDialog, ImportOffer } from '../components/McImport'
import grass from '../assets/mc/grass.webp'
import craftingTable from '../assets/mc/crafting-table.webp'
import '../styles/minecraft.css'

// Minecraft (beta): tus instancias (cada una con su versión, mundos y opciones) y tus cuentas. Estética de
// inventario de Minecraft adaptada de Minepanel (github.com/Ketbome/minepanel).

type Dialog = 'accounts' | 'create' | 'skin' | 'import' | null

/** La oferta de traer instancias de otros launchers se mira una vez por sesión */
let offerChecked = false

export function Minecraft(): React.JSX.Element {
  const t = useT()
  const mc = useStore((s) => s.mc)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [view, setView] = useState<'instances' | 'modpacks'>('instances')
  const [importing, setImporting] = useState(false)
  const settings = useStore((s) => s.settings)
  // Lo encontrado en otros launchers al ofrecerlo (la ventana de importar lo reutiliza sin volver a buscar)
  const [offer, setOffer] = useState<McImportable[] | null>(null)
  const [found, setFound] = useState<McImportable[] | undefined>(undefined)

  const importPack = async (): Promise<void> => {
    setImporting(true)
    const r = await invoke('mc:importPack').finally(() => setImporting(false))
    if (r.error) toast({ kind: 'error', key: r.error })
    else if (r.id) navigate({ name: 'mcInstance', id: r.id })
  }

  useEffect(() => {
    void invoke('mc:get').then((m) => setState({ mc: m }))
  }, [])

  // La primera vez, si hay algo que traer de otros launchers, se ofrece. Una sola vez (y después de elegir idioma)
  useEffect(() => {
    if (offerChecked || !settings || settings.importOffered || settings.langAsked === false) return
    offerChecked = true
    void invoke('mc:importScan')
      .then((list) => {
        if (!list.some((i) => !i.unsupported && !i.imported && !i.shares)) return
        setOffer(list)
        void updateSettings({ importOffered: true })
      })
      .catch(() => undefined)
  }, [settings])

  const active = mc?.accounts.find((a) => a.id === mc.activeAccount) ?? null

  return (
    <div className="page mc-page">
      <header className="mc-hero mc-panel">
        <img className="mc-hero-block" src={grass} alt="" draggable={false} />
        <div className="mc-hero-text">
          <h1 className="mc-display">
            {t('mc.title')} <span className="mc-tag mc-tag-beta">{t('mc.beta')}</span>
          </h1>
          <p>{t('mc.sub')}</p>
        </div>
        <button className="mc-account mc-slot-btn" onClick={() => setDialog('accounts')} title={t('mc.accounts.title')}>
          <McHead account={active} size={36} />
          <span className="mc-account-text">
            <b>{active?.name ?? t('mc.accounts.none')}</b>
            <small>{active ? t(active.kind === 'msa' ? 'mc.accounts.kindMsa' : 'mc.accounts.kindOffline') : t('mc.accounts.add')}</small>
          </span>
          <ChevronDown size={16} />
        </button>
        {active?.kind === 'msa' && (
          <button className="mc-btn mc-btn-lapis mc-hero-skin" onClick={() => setDialog('skin')}>
            <Shirt size={16} /> {t('mc.skin.button')}
          </button>
        )}
      </header>

      {mc && !mc.accounts.length && (
        <section className="mc-panel mc-welcome">
          <McHead account={null} size={48} />
          <div>
            <h2>{t('mc.welcome.title')}</h2>
            <p>{t('mc.welcome.text')}</p>
          </div>
          <button className="mc-btn mc-btn-emerald" onClick={() => setDialog('accounts')}>
            <Plus size={16} /> {t('mc.accounts.add')}
          </button>
        </section>
      )}

      {mc && <PackInvites mc={mc} />}
      {mc && <CloudPacks mc={mc} />}

      <div className="mc-section-head">
        <nav className="mc-tabs mc-tabs-inline" role="tablist">
          <button role="tab" aria-selected={view === 'instances'} className={view === 'instances' ? 'on' : ''} onClick={() => setView('instances')}>
            {t('mc.instances')}
          </button>
          <button role="tab" aria-selected={view === 'modpacks'} className={view === 'modpacks' ? 'on' : ''} onClick={() => setView('modpacks')}>
            {t('mc.modpacks.tab')}
          </button>
        </nav>
        <div className="mc-section-actions">
          <button
            className="mc-btn"
            onClick={() => {
              setFound(undefined)
              setDialog('import')
            }}
          >
            <FolderInput size={16} /> {t('mc.import.button')}
          </button>
          <button className="mc-btn" disabled={importing} onClick={() => void importPack()}>
            {importing ? <Loader2 size={16} className="spin" /> : <FileUp size={16} />} {t('mc.modpacks.import')}
          </button>
          {!!mc?.instances.length && (
            <button className="mc-btn mc-btn-emerald" onClick={() => setDialog('create')}>
              <Plus size={16} /> {t('mc.newInstance')}
            </button>
          )}
        </div>
      </div>

      {view === 'modpacks' ? (
        <McExplore inst={null} installed={[]} />
      ) : mc && !mc.instances.length ? (
        <section className="mc-panel mc-empty">
          <img src={craftingTable} alt="" width={72} height={72} draggable={false} />
          <h3>{t('mc.emptyTitle')}</h3>
          <p>{t('mc.emptyText')}</p>
          <button className="mc-btn mc-btn-emerald" onClick={() => setDialog('create')}>
            <Plus size={16} /> {t('mc.newInstance')}
          </button>
        </section>
      ) : (
        <div className="mc-grid">
          {mc?.instances.map((inst) => (
            <InstanceCard key={inst.id} inst={inst} mc={mc} />
          ))}
        </div>
      )}

      {dialog === 'accounts' && mc && <AccountsDialog mc={mc} onClose={() => setDialog(null)} />}
      {dialog === 'create' && <CreateDialog onClose={() => setDialog(null)} />}
      {dialog === 'skin' && active && <SkinDialog account={active} onClose={() => setDialog(null)} />}
      {dialog === 'import' && <ImportDialog initial={found} onClose={() => setDialog(null)} />}
      {offer && (
        <ImportOffer
          list={offer}
          onClose={() => setOffer(null)}
          onOpen={() => {
            setFound(offer)
            setOffer(null)
            setDialog('import')
          }}
        />
      )}
    </div>
  )
}

function InstanceCard({ inst, mc }: { inst: McInstance; mc: McState }): React.JSX.Element {
  const t = useT()
  const running = mc.running === inst.id
  const open = (): void => navigate({ name: 'mcInstance', id: inst.id })

  return (
    <article className={`mc-panel mc-card ${running ? 'running' : ''} ${inst.crash ? 'crashed' : ''}`}>
      <div className="mc-card-top">
        <button className="mc-card-open" onClick={open}>
          <span className="mc-slot">
            <img src={inst.icon || grass} alt="" draggable={false} />
          </span>
          <span className="mc-card-text">
            <h3 title={inst.name}>{inst.name}</h3>
            <span className="mc-card-version">{versionLabel(inst, t)}</span>
          </span>
        </button>
        {inst.packId && (
          <span className={`mc-tag ${mc.packDiffs[inst.id] ? 'mc-tag-gold' : 'mc-tag-soft'}`} title={t('mc.share.badge')}>
            <Users size={11} /> {mc.packDiffs[inst.id] ? '!' : ''}
          </span>
        )}
        <McInstanceMenu inst={inst} mc={mc} />
      </div>

      {inst.crash ? (
        <button className="mc-card-crash" onClick={open}>
          <TriangleAlert size={14} /> {t('mc.crash.title')}
        </button>
      ) : (
        <div className="mc-card-meta">
          {inst.lastPlayed
            ? t('mc.played', { time: formatDuration(inst.playtime, t), when: formatRelative(inst.lastPlayed, t) })
            : t('mc.neverPlayed')}
        </div>
      )}

      <McPlay inst={inst} mc={mc} />
    </article>
  )
}
