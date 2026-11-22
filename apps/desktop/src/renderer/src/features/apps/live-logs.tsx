/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { LiveTerminal } from '../servers/terminal/live-terminal';

/**
 * Live ANSI-colored App logs rendered through the unified Haus Direct Binary E2EE IPC xterm viewer.
 */
export function AppLiveLogs({ appId }: { readonly appId: string; readonly appState?: string }) {
  return (
    <LiveTerminal
      className="native-app-xterm"
      serverId="local"
      target={{ kind: 'app-logs', appId, tail: 500 }}
      active
    />
  );
}
