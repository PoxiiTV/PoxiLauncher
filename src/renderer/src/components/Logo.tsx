import logo from '../assets/logo.svg'

/** El logo de la app: la «P» (la misma que el icono de Windows y la web) */
export function Logo({ size = 28 }: { size?: number }): React.JSX.Element {
  return <img src={logo} width={size} height={size} alt="" aria-hidden draggable={false} style={{ objectFit: 'contain' }} />
}
