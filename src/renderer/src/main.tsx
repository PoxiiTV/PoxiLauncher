import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { initMotion } from './lib/motion'
import '@fontsource-variable/nunito'
import './styles/app.css'
import './styles/pages.css'
import { App } from './App'
import { OverlayApp } from './pages/Overlay'
import { IS_OVERLAY } from './lib/overlay'
import { boot } from './store'

/** Si algo revienta en la interfaz, mensaje amable en vez de pantalla negra. */
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  componentDidCatch(e: Error): void {
    console.error(e)
  }
  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div className="empty" style={{ height: '100%' }}>
        <div className="emoji">😵</div>
        <h3>Algo ha fallado / Something went wrong</h3>
        <button className="btn btn-primary" onClick={() => location.reload()}>
          Recargar / Reload
        </button>
      </div>
    )
  }
}

// Los cosméticos animados, quietos cuando nadie los mira (y todo quieto con la ventana sin foco)
initMotion()

createRoot(document.getElementById('root')!).render(
  <Boundary>{IS_OVERLAY ? <OverlayApp /> : <App />}</Boundary>
)
void boot()
