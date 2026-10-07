import type { UserProfile } from '@shared/profile'

// La placa de nombre: el fondo de color de tu fila en las listas (amigos, chats, miembros)

/** ¿Lleva placa? La fila que la pinta necesita la clase plate-row */
export const plateRow = (profile?: UserProfile): string => (profile?.plate?.length ? 'plate-row' : '')

/** La placa detrás de una fila (dentro de un elemento con plateRow) */
export function Plate({ profile }: { profile?: UserProfile }): React.JSX.Element | null {
  const c = profile?.plate
  if (!c?.length) return null
  return <span className="plate" aria-hidden style={{ background: c[1] ? `linear-gradient(90deg, ${c[0]}, ${c[1]})` : c[0] }} />
}
