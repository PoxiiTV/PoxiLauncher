// Con la app enfocada, todo animado (marcos, efectos de nombre…). Sin foco (jugando a Minecraft con la app abierta en
// otra pantalla) todo quieto: así no gasta mientras juegas (medido: un amigo con nombre de neón en la barra lateral
// repintaba a 240 fps, ~1 núcleo de CPU; quieto, ~3 %). Lo que es CSS lo paran las reglas «still-all» de los estilos;
// los SVG animados (SMIL), aquí.

const svgsIn = (root: ParentNode): NodeListOf<SVGSVGElement> => root.querySelectorAll<SVGSVGElement>('svg')

export function initMotion(): void {
  const root = document.documentElement
  const apply = (): void => {
    const still = !document.hasFocus()
    root.classList.toggle('still-all', still)
    svgsIn(document).forEach((s) => (still ? s.pauseAnimations() : s.unpauseAnimations()))
  }
  window.addEventListener('blur', apply)
  window.addEventListener('focus', apply)
  apply()
  // Lo que aparece mientras la ventana está sin foco (un amigo que cambia de marco…) nace quieto
  new MutationObserver((list) => {
    if (!root.classList.contains('still-all')) return
    for (const m of list) for (const n of m.addedNodes) if (n instanceof Element) (n instanceof SVGSVGElement ? [n] : svgsIn(n)).forEach((s) => s.pauseAnimations())
  }).observe(document.body, { childList: true, subtree: true })
}
