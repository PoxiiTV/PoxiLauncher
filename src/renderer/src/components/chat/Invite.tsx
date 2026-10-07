import { useState } from 'react'
import { Gamepad2, Loader2, LogIn } from 'lucide-react'
import type { ChatInvite, ChatMessage } from '@shared/chat'
import { invoke } from '../../api'
import { toast, useStore } from '../../store'
import { useT } from '../../i18n'
import { joinFriend } from '../../lib/mc'
import grassBlock from '../../assets/mc/grass-block.png'

/** Manda una invitación a tu partida (a chats o a amigos) y dice cómo ha ido */
export async function inviteTo(to: { chats?: string[]; friends?: string[] }): Promise<boolean> {
  const r = await invoke('chat:invite', to).catch(() => ({
    sent: 0,
    error: 'send' as const
  }))
  if (r.error === 'notPlaying') toast({ kind: 'info', key: 'chat.invite.notPlaying' })
  else if (r.error) toast({ kind: 'error', key: 'chat.invite.failed' })
  else if (r.sent)
    toast({
      kind: 'success',
      key: r.sent === 1 ? 'chat.invite.sentOne' : 'chat.invite.sentMany',
      params: { n: String(r.sent) }
    })
  return !r.error
}

const LOADERS: Record<ChatInvite['loader'], string> = {
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge'
}

/** La tarjeta de una invitación en el chat: «Unirse» hace lo mismo que el botón del perfil de quien invita */
export function InviteCard({ m, mine, name }: { m: ChatMessage; mine: boolean; name: string }): React.JSX.Element | null {
  const t = useT()
  const inv = m.invite!
  const friend = useStore((s) => s.account.friends.find((f) => f.id === m.from))
  const [busy, setBusy] = useState(false)
  // ¿Sigue en esa partida? (se mira su estado en directo, no la tarjeta)
  const live = friend?.state === 'playing' && !!friend.mc && !!(friend.mc.tunnel || friend.mc.server)

  const action = (): React.JSX.Element | null => {
    if (mine) return <span className="cm-invite-note">{t('chat.invite.yours')}</span>
    return (
      <button
        className="btn btn-primary btn-sm"
        disabled={!live || busy}
        onClick={async () => {
          setBusy(true)
          await joinFriend(m.from)
          setBusy(false)
        }}
      >
        {busy ? <Loader2 size={15} className="spin" /> : <LogIn size={15} />} {live ? t('chat.invite.join') : t('chat.invite.gone')}
      </button>
    )
  }

  return (
    <div className={`cm-invite ${live || mine ? '' : 'gone'}`}>
      <span className="cm-invite-icon">
        <img className="cover cover-mc loaded" src={grassBlock} alt="" draggable={false} />
      </span>
      <span className="cm-invite-text">
        <small>
          <Gamepad2 size={12} /> {mine ? t('chat.invite.titleMine') : t('chat.invite.title', { name })}
        </small>
        <b>{inv.name}</b>
        <em>
          Minecraft {inv.version} · {LOADERS[inv.loader]}
          {inv.where ? ` · ${inv.where === 'lan' ? t('chat.invite.lan') : inv.where}` : ''}
        </em>
      </span>
      <span className="cm-invite-action">{action()}</span>
    </div>
  )
}
