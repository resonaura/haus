/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Box, HausButton } from '@haus/ui';
import { FileText, TerminalSquare } from 'lucide-react';
import type { TerminalTarget } from '@haus/core/protocol';
import { Dialog } from '@haus/ui/components';
import { LiveTerminal } from './live-terminal';

export interface ActiveServiceConsole {
  readonly title: string;
  readonly containerId?: string;
  readonly running?: boolean;
  readonly target: TerminalTarget;
}

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
    <Dialog title={consoleState.title} onClose={onClose} className="service-terminal-dialog">
      {consoleState.containerId && (
        <Box className="service-terminal-mode-bar">
          <HausButton
            size="sm"
            variant={consoleState.target.kind === 'docker-logs' ? 'secondary' : 'ghost'}
            onPress={() =>
              onChangeMode({
                ...consoleState,
                title: consoleState.title.replace(/ · (?:Logs|Terminal)$/, ' · Logs'),
                target: { kind: 'docker-logs', containerId: consoleState.containerId!, tail: 500 },
              })
            }
          >
            <FileText size={14} />
            Live logs
          </HausButton>
          <HausButton
            size="sm"
            variant={consoleState.target.kind === 'docker-exec' ? 'secondary' : 'ghost'}
            isDisabled={!consoleState.running}
            onPress={() =>
              onChangeMode({
                ...consoleState,
                title: consoleState.title.replace(/ · (?:Logs|Terminal)$/, ' · Terminal'),
                target: { kind: 'docker-exec', containerId: consoleState.containerId! },
              })
            }
          >
            <TerminalSquare size={14} />
            Terminal
          </HausButton>
        </Box>
      )}
      <LiveTerminal
        className="service-terminal-viewport"
        serverId={serverId}
        target={consoleState.target}
        active
        onSwitchToLogs={
          consoleState.containerId && consoleState.target.kind === 'docker-exec'
            ? () =>
                onChangeMode({
                  ...consoleState,
                  title: consoleState.title.replace(/ · (?:Logs|Terminal)$/, ' · Logs'),
                  target: {
                    kind: 'docker-logs',
                    containerId: consoleState.containerId!,
                    tail: 500,
                  },
                })
            : undefined
        }
      />
    </Dialog>
  );
}
