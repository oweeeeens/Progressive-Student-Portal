import { Component } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'

// The last line of defence against a blank white page.
//
// React unmounts the whole tree when a render throws. Without a boundary
// that means the app simply disappears — no message, no navigation, no way
// back except knowing to reload. This system gets demonstrated live in front
// of a panel, where a white screen is the worst thing that can happen and
// the least recoverable.
//
// A class component on purpose: componentDidCatch and
// getDerivedStateFromError have no hook equivalent, so this is one of the
// few places React still requires one.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Kept in the console rather than shown: a component stack is useful to
    // whoever is debugging and meaningless to a teacher.
    console.error('Unhandled render error:', error, info?.componentStack)
  }

  handleReload = () => {
    window.location.reload()
  }

  // Going home rather than reloading matters when the crash is specific to
  // one record — reloading would land straight back on it.
  handleGoHome = () => {
    window.location.href = '/'
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="error-boundary">
        <div className="error-boundary__card">
          <AlertTriangle className="error-boundary__icon" size={32} strokeWidth={1.75} aria-hidden="true" />
          <h1>Something went wrong on this page</h1>
          <p>
            The page stopped responding before it finished loading. Nothing you had already saved is
            affected — this is a display problem, not a problem with the records themselves.
          </p>
          <div className="error-boundary__actions">
            <button type="button" className="btn-primary" onClick={this.handleReload}>
              <RotateCw size={16} strokeWidth={1.75} />
              Reload this page
            </button>
            <button type="button" onClick={this.handleGoHome}>
              Go to Home
            </button>
          </div>
          {/* The message, for whoever is helping. Deliberately small and
              last: it is a clue, not the headline. */}
          <p className="error-boundary__detail">{String(this.state.error?.message || this.state.error)}</p>
        </div>
      </div>
    )
  }
}
