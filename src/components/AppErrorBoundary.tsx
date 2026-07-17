import { AlertTriangle, Bug, RefreshCw, ShieldCheck } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State { error: Error | null; exporting: boolean; message: string }

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, exporting: false, message: '' }

  static getDerivedStateFromError(error: Error): State {
    return { error, exporting: false, message: '' }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void window.neoAnkiDesktop?.reportDiagnostic({ source: 'renderer', level: 'error', code: 'react-boundary', message: error.message, stack: `${error.stack || ''}\n${info.componentStack || ''}` })
  }

  private exportDiagnostics = async () => {
    if (!window.neoAnkiDesktop) return
    this.setState({ exporting: true, message: '' })
    try {
      const result = await window.neoAnkiDesktop.exportDiagnostics()
      this.setState({ exporting: false, message: result.canceled ? '' : 'Diagnostics exported.' })
    } catch {
      this.setState({ exporting: false, message: 'Diagnostics could not be exported.' })
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    return <main className="fatal-recovery" aria-labelledby="fatal-title">
      <div className="fatal-recovery-card">
        <span className="fatal-mark"><AlertTriangle size={28}/></span>
        <p className="eyebrow">Neo Anki recovered the window</p>
        <h1 id="fatal-title">Something stopped this screen.</h1>
        <p>Your workspace is still stored locally. Reload first; if the problem returns, start without locally installed extensions and export diagnostics for a bug report.</p>
        <details><summary>Technical detail</summary><code>{this.state.error.message || 'Unknown renderer failure'}</code></details>
        <div className="fatal-actions">
          <button className="primary-button" onClick={() => window.location.reload()}><RefreshCw size={18}/> Reload Neo Anki</button>
          <button className="secondary-button" onClick={() => { window.location.search = '?safe-mode=1' }}><ShieldCheck size={18}/> Start in safe mode</button>
          {window.neoAnkiDesktop && <button className="secondary-button" disabled={this.state.exporting} onClick={() => void this.exportDiagnostics()}><Bug size={18}/> {this.state.exporting ? 'Exporting…' : 'Export diagnostics'}</button>}
        </div>
        {this.state.message && <p role="status" className="inline-message">{this.state.message}</p>}
      </div>
    </main>
  }
}
