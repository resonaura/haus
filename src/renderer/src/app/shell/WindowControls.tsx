import { useEffect, useState } from 'react';
import { X, Minus, Square, Copy } from 'lucide-react';
import type { WindowChrome } from '../../../../shared/native';
export function WindowControls() {
  const [state, setState] = useState<WindowChrome>();
  useEffect(() => {
    const api = window.hausNative;
    if (!api?.getWindowChrome) return;
    let active = true;
    const update = (next: WindowChrome) => {
      if (!active) return;
      setState(next);
      const root = document.documentElement;
      root.dataset.windowControls = next.controls;
      root.dataset.windowMaximized = String(next.maximized || next.fullscreen);
      root.dataset.windowFullscreen = String(next.fullscreen);
    };
    void api
      .getWindowChrome()
      .then(update)
      .catch(() => {});
    const off = api.onEvent((event) => {
      if (event.type === 'window') update(event.state);
    });
    return () => {
      active = false;
      off();
    };
  }, []);
  if (!state || state.fullscreen || !['traffic-left', 'custom-right'].includes(state.controls))
    return null;
  const traffic = state.controls === 'traffic-left';
  return (
    <div
      className={`window-controls ${traffic ? 'is-traffic' : 'is-caption'}`}
      aria-label="Window controls"
    >
      {(traffic ? ['close', 'minimize', 'maximize'] : ['minimize', 'maximize', 'close']).map(
        (action) => (
          <button
            key={action}
            type="button"
            className={`window-control is-${action}`}
            aria-label={
              action === 'close'
                ? 'Close window'
                : action === 'minimize'
                  ? 'Minimize window'
                  : state.maximized
                    ? 'Restore window'
                    : 'Maximize window'
            }
            onClick={() =>
              void window.hausNative
                ?.windowAction(action as 'close' | 'minimize' | 'maximize')
                .catch(() => {})
            }
          >
            {action === 'close' ? (
              <X size={traffic ? 9 : 14} />
            ) : action === 'minimize' ? (
              <Minus size={traffic ? 9 : 14} />
            ) : state.maximized ? (
              <Copy size={12} />
            ) : (
              <Square size={traffic ? 8 : 12} />
            )}
          </button>
        ),
      )}
    </div>
  );
}
