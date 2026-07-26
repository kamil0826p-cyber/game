import { Component, type ErrorInfo, type PropsWithChildren, type ReactNode } from 'react';

interface ErrorBoundaryState {
  error?: Error;
}

export class ErrorBoundary extends Component<PropsWithChildren, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Frontend rendering failed.', error, errorInfo);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
          <section className="fantasy-panel max-w-xl p-8 text-center">
            <h1 className="font-display text-2xl text-rose-200">The client encountered an error</h1>
            <p className="mt-3 text-sm text-slate-300">{this.state.error.message}</p>
            <button
              className="retro-button mt-6 border-amber-300/70 bg-amber-500/20 text-amber-100"
              onClick={() => window.location.reload()}
              type="button"
            >
              Reload client
            </button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}
