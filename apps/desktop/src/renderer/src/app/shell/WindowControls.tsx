/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useState } from 'react';
import { Box, Pressable } from '@haus/ui';
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
      root.dataset.windowFocused = String(next.focused !== false);
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
  const artwork = traffic ? state.trafficLights : undefined;
  return (
    <Box
      className={`window-controls ${traffic ? 'is-traffic' : 'is-caption'}${artwork ? ' has-native-artwork' : ''}`}
      ariaLabel="Window controls"
      surfaceTokens={
        artwork
          ? {
              '--native-control-width': `${artwork.width}px`,
              '--native-control-height': `${artwork.height}px`,
              gap: `${artwork.gap}px`,
            }
          : undefined
      }
    >
      {(traffic ? ['close', 'minimize', 'maximize'] : ['minimize', 'maximize', 'close']).map(
        (action) => (
          <Pressable
            key={action}
            type="button"
            className={`window-control is-${action}`}
            surfaceTokens={
              artwork
                ? Object.fromEntries(
                    (['light', 'dark'] as const).flatMap((mode) =>
                      Object.entries(
                        artwork.images[mode][
                          action === 'maximize' ? 'zoom' : (action as 'close' | 'minimize')
                        ],
                      ).map(([phase, image]) => [`--native-${phase}-${mode}`, image]),
                    ),
                  )
                : undefined
            }
            ariaLabel={
              action === 'close'
                ? 'Close window'
                : action === 'minimize'
                  ? 'Minimize window'
                  : state.maximized
                    ? 'Restore window'
                    : 'Maximize window'
            }
            onPress={() =>
              void window.hausNative
                ?.windowAction(action as 'close' | 'minimize' | 'maximize')
                .catch(() => {})
            }
          >
            {artwork ? null : action === 'close' ? (
              <X size={traffic ? 9 : 14} />
            ) : action === 'minimize' ? (
              <Minus size={traffic ? 9 : 14} />
            ) : state.maximized ? (
              <Copy size={12} />
            ) : (
              <Square size={traffic ? 8 : 12} />
            )}
          </Pressable>
        ),
      )}
    </Box>
  );
}
