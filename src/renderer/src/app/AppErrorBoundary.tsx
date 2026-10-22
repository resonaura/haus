import { Component, useEffect, type ReactNode } from 'react';
import { failureReport } from '../../../shared/recovery';
import '../styles/recovery.scss';

export function RendererReady() {
  useEffect(() => {
    void window.hausNative?.rendererReady?.().catch(() => {});
  }, []);
  return null;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    void window.hausNative?.reportFailure?.(failureReport('render', error)).catch(() => {});
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="app-recovery" role="alert">
        <section className="recovery-card">
          <h1>Let’s get you back home.</h1>
          <p>
            Something interrupted the app. Reload to try again. Your home configuration is kept.
          </p>
          <div className="recovery-actions">
            <button
              type="button"
              onClick={() => {
                if (window.hausNative?.recoveryAction)
                  void window.hausNative.recoveryAction('reload');
                else window.location.reload();
              }}
            >
              Reload Haus
            </button>
          </div>
        </section>
      </main>
    );
  }
}
