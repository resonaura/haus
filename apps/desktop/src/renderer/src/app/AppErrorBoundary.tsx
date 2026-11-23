/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Component, useEffect, type ReactNode } from 'react';
import { Box, Heading, Pressable, Text } from '@haus/ui';
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
      <Box semantic="main" className="app-recovery" role="alert">
        <Box semantic="section" className="recovery-card">
          <Heading level={1}>Let’s get you back home.</Heading>
          <Text semantic="p">
            Something interrupted the app. Reload to try again. Your home configuration is kept.
          </Text>
          <Box className="recovery-actions">
            <Pressable
              type="button"
              onPress={() => {
                if (window.hausNative?.recoveryAction)
                  void window.hausNative.recoveryAction('reload');
                else window.location.reload();
              }}
            >
              Reload Haus
            </Pressable>
          </Box>
        </Box>
      </Box>
    );
  }
}
