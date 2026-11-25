/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { switchServiceConsoleMode, type ActiveServiceConsole } from '@haus/core/transport';
import { ServiceConsoleModal } from '@haus/ui/components';
import { LiveTerminal } from './live-terminal';

export type { ActiveServiceConsole };

export function ServiceConsoleDialog({
  serverId,
  consoleState,
  onChangeMode,
  onClose,
}: {
  readonly serverId: string;
  readonly consoleState: ActiveServiceConsole;
  readonly onChangeMode: (next: ActiveServiceConsole) => void;
  readonly onClose: () => void;
}) {
  return (
    <ServiceConsoleModal consoleState={consoleState} onChangeMode={onChangeMode} onClose={onClose}>
      <LiveTerminal
        className="service-terminal-viewport"
        serverId={serverId}
        target={consoleState.target}
        active
        onSwitchToLogs={
          consoleState.containerId && consoleState.target.kind === 'docker-exec'
            ? () => onChangeMode(switchServiceConsoleMode(consoleState, 'logs'))
            : undefined
        }
      />
    </ServiceConsoleModal>
  );
}
