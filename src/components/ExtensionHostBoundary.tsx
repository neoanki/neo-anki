import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ExtensionHostBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
  onError(error: Error): void
}

export class ExtensionHostBoundary extends Component<ExtensionHostBoundaryProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError(error)
  }

  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children
  }
}
