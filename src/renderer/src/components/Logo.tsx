import grassBlock from '../assets/mc/grass-block.png'

/** El logo de la app: el bloque de hierba (el mismo que el icono de Windows) */
export function Logo({ size = 28 }: { size?: number }): React.JSX.Element {
  return <img src={grassBlock} width={size} height={size} alt="" aria-hidden draggable={false} style={{ objectFit: 'contain' }} />
}
