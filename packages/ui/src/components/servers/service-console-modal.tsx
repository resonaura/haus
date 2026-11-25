/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ReactNode } from 'react';
import { switchServiceConsoleMode, type ActiveServiceConsole } from '@haus/core/transport';
import { pct } from '../../ir/geometry.js';
import { HausButton, HausDialog, Row, Stack, Text } from '../../primitives/index.js';
import { UiIcon } from '../icon.js';

export type { ActiveServiceConsole };

export function ServiceConsoleModal({
  consoleState,
  className = 'service-terminal-dialog',
  onChangeMode,
  onClose,
  children,
}: {
  readonly consoleState: ActiveServiceConsole;
  readonly className?: string;
  readonly onChangeMode: (next: ActiveServiceConsole) => void;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  return (
    <HausDialog
      size="lg"
      title={consoleState.title}
      className={className}
      backdrop="blur"
      scrollable
      onClose={onClose}
      footer={
        <Row justify="end" style={{ layout: { width: pct(100) } }}>
          <HausButton id="service-console-done" variant="secondary" onPress={onClose}>
            Done
          </HausButton>
        </Row>
      }
    >
      <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
        {consoleState.containerId && (
          <Row align="center" gapPx={8} className="service-terminal-mode-bar">
            <HausButton
              id="service-console-mode-logs"
              size="sm"
              variant={consoleState.target.kind === 'docker-logs' ? 'secondary' : 'ghost'}
              onPress={() => onChangeMode(switchServiceConsoleMode(consoleState, 'logs'))}
            >
              <UiIcon name="file-text" size={14} />
              <Text size={12.5}>Live logs</Text>
            </HausButton>
            <HausButton
              id="service-console-mode-terminal"
              size="sm"
              variant={consoleState.target.kind === 'docker-exec' ? 'secondary' : 'ghost'}
              disabled={!consoleState.running}
              onPress={() => onChangeMode(switchServiceConsoleMode(consoleState, 'terminal'))}
            >
              <UiIcon name="terminal" size={14} />
              <Text size={12.5}>Terminal</Text>
            </HausButton>
          </Row>
        )}
        <Stack gapPx={8} style={{ layout: { width: pct(100) } }}>
          {children}
        </Stack>
      </Stack>
    </HausDialog>
  );
}
