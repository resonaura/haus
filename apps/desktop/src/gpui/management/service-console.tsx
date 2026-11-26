/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  buildDemoServiceConsoleOutput,
  switchServiceConsoleMode,
  type ActiveServiceConsole,
} from '@haus/core/transport';
import { ServiceConsoleModal } from '@haus/ui/components';
import { GpuiLiveTerminal } from './live-terminal.js';
import type { GpuiTerminalPort } from './servers-port.js';

export function GpuiServiceConsoleModal({
  serverId,
  serverName,
  consoleState,
  demo,
  terminal,
  onCopyText,
  onChangeMode,
  onClose,
}: {
  readonly serverId: string;
  readonly serverName: string;
  readonly consoleState: ActiveServiceConsole;
  readonly demo?: boolean;
  readonly terminal?: GpuiTerminalPort;
  readonly onCopyText?: (text: string) => void;
  readonly onChangeMode: (next: ActiveServiceConsole) => void;
  readonly onClose: () => void;
}) {
  const readOnly = consoleState.target.kind !== 'docker-exec';

  return (
    <ServiceConsoleModal consoleState={consoleState} onChangeMode={onChangeMode} onClose={onClose}>
      <GpuiLiveTerminal
        serverId={serverId}
        serverName={serverName}
        target={consoleState.target}
        demo={demo}
        demoLogs={demo ? buildDemoServiceConsoleOutput(serverName, consoleState) : undefined}
        terminal={terminal}
        heightPx={380}
        onCopyText={onCopyText}
        onSwitchToLogs={
          consoleState.containerId && !readOnly
            ? () => onChangeMode(switchServiceConsoleMode(consoleState, 'logs'))
            : undefined
        }
      />
    </ServiceConsoleModal>
  );
}
