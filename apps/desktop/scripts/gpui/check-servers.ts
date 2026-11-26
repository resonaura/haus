/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { createElement, useState, type ReactElement } from 'react';
import {
  buildDemoServersState,
  type ServerSshProfileInput,
  type ServerSummaryRecord,
} from '@haus/core/transport';
import { createDemoSnapshot } from '@haus/ha/view/demo/snapshot';
import type { HausTerminalEvent, HausTerminalOpenRequest } from '@haus/ipc/client';
import { createTestRoot, hasNativeTestRenderer, type TestRenderer } from '@gpuix/react/testing';
import { SshSettingsForm } from '@haus/ui/components';
import { GPUIX_CONTENT_HOST } from '@haus/ui/gpui';
import { pct } from '@haus/ui/ir';
import { Box, HausUiProvider } from '@haus/ui/primitives';
import { requireGpuiBun } from '../../src/gpui/bun.js';
import type { GpuiSystemPorts } from '../../src/gpui/management/servers-port.js';
import { GpuiServersView } from '../../src/gpui/management/servers.js';

requireGpuiBun();
assert(hasNativeTestRenderer, 'GPUIX native test renderer is required for check-servers');

function click(renderer: TestRenderer, id: string): void {
  const element = renderer.findByTestId(id);
  assert(element, `Missing testId="${id}"`);
  let bounds = renderer.getElementBounds(element.id);
  if (bounds && (bounds.y < 0 || bounds.y + bounds.height > 780)) {
    const scrollX = bounds.x + Math.max(24, bounds.width / 2);
    renderer.nativeSimulateScrollWheel(scrollX, 400, 0, -(bounds.y - 360));
    renderer.dispatchNativeEvents();
    renderer.flush();
    bounds = renderer.getElementBounds(element.id);
  }
  assert(bounds && bounds.width > 0 && bounds.height > 0, `Missing bounds for "${id}"`);
  renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, 0);
  renderer.dispatchNativeEvents();
  renderer.flush();
}

function setInputValue(renderer: TestRenderer, id: string, value: string): void {
  const element = renderer.findByTestId(id);
  assert(element, `Missing input testId="${id}"`);
  renderer.writeToClipboard(value);
  renderer.nativeSimulateKeystrokes(element.id, 'cmd-a backspace cmd-v');
  renderer.dispatchNativeEvents();
  renderer.flush();
}

async function flushMicrotasks(renderer: TestRenderer, turns = 6): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    renderer.dispatchNativeEvents();
    renderer.flush();
  }
}

function withRoot(
  element: ReactElement,
  fn: (renderer: TestRenderer) => void | Promise<void>,
): Promise<void> {
  const { renderer, render, unmount } = createTestRoot({ width: 1080, height: 820 });
  render(
    createElement(HausUiProvider, {
      contentHost: GPUIX_CONTENT_HOST,
      mode: 'dark',
      children: createElement(Box, {
        style: { layout: { width: pct(100), height: pct(100), overflowY: 'scroll' } },
        children: element,
      }),
    }),
  );
  renderer.flush();
  return Promise.resolve(fn(renderer)).finally(() => unmount());
}

function typeTerminal(renderer: TestRenderer, text: string): void {
  const element = renderer.findByTestId('server-terminal-xterm');
  assert(element, 'Missing xterm testId="server-terminal-xterm"');
  const keys = text
    .split('')
    .map((ch) => (ch === ' ' ? 'space' : ch))
    .join(' ');
  renderer.nativeSimulateKeystrokes(element.id, `${keys} enter`);
  renderer.dispatchNativeEvents();
  renderer.flush();
}

async function checkDemoServersAndServiceConsoles(): Promise<void> {
  const snapshot = createDemoSnapshot();
  const copied: string[] = [];

  await withRoot(
    createElement(GpuiServersView, {
      snapshot,
      demo: true,
      onCopyText: (text) => copied.push(text),
    }),
    async (renderer) => {
      click(renderer, 'server-card-haus-hub-main');
      await flushMicrotasks(renderer);

      click(renderer, 'server-tab-terminal');
      await flushMicrotasks(renderer);

      typeTerminal(renderer, 'help');
      await flushMicrotasks(renderer, 10);

      click(renderer, 'console-copy');
      await flushMicrotasks(renderer);
      assert(
        copied.length === 1 && copied[0]?.includes('Available demo commands'),
        `Demo xterm shell should execute help command (copied: ${JSON.stringify(copied)})`,
      );

      click(renderer, 'console-search-toggle');
      await flushMicrotasks(renderer);
      setInputValue(renderer, 'terminal-search-input', 'docker');
      await flushMicrotasks(renderer);
      assert(
        renderer.getAllText().some((text) => text.includes('1 /')),
        'Terminal search bar should show match index/count from real xterm buffer',
      );

      click(renderer, 'terminal-search-close');
      await flushMicrotasks(renderer);

      click(renderer, 'server-tab-services');
      await flushMicrotasks(renderer);

      click(renderer, 'service-logs-zigbee2mqtt');
      await flushMicrotasks(renderer, 8);
      click(renderer, 'console-copy');
      await flushMicrotasks(renderer);
      assert(
        copied.at(-1)?.includes('container zigbee2mqtt logs'),
        'Docker service logs modal should stream into xterm buffer',
      );
      assert(
        renderer.findByTestId('service-console-mode-terminal'),
        'Docker service modal must show Terminal switch button',
      );

      click(renderer, 'service-console-mode-terminal');
      await flushMicrotasks(renderer, 8);
      typeTerminal(renderer, 'uptime');
      await flushMicrotasks(renderer, 10);
      click(renderer, 'console-copy');
      await flushMicrotasks(renderer);
      assert(
        copied.at(-1)?.includes('load average'),
        'Docker service xterm terminal should execute interactive command via keystrokes',
      );

      click(renderer, 'service-console-done');
      await flushMicrotasks(renderer);
      assert(!renderer.findByTestId('service-console-done'), 'Service modal must close');

      click(renderer, 'service-logs-haus-hub.service');
      await flushMicrotasks(renderer);
      assert(
        !renderer.findByTestId('service-console-mode-terminal'),
        'Systemd logs-only service modal must not show interactive container terminal tab',
      );
      click(renderer, 'service-console-done');
      await flushMicrotasks(renderer);
    },
  );
}

async function checkLiveServiceConsoleContracts(): Promise<void> {
  const snapshot = createDemoSnapshot();
  const demoServer: ServerSummaryRecord = buildDemoServersState().servers[0]!;
  const opened: HausTerminalOpenRequest[] = [];
  const written: string[] = [];
  const ackedBytes: number[] = [];
  const closed: string[] = [];
  const copied: string[] = [];
  const listeners = new Set<(event: HausTerminalEvent) => void>();
  const encoder = new TextEncoder();

  const system: GpuiSystemPorts = {
    sessionKind: 'haus-hub',
    requestRpc: async <T>() => ({}) as T,
    servers: {
      loadServers: async () => [demoServer],
      setServerEnabled: async () => undefined,
    },
    terminal: {
      open: async (request) => {
        opened.push(request);
        const emit = (event: HausTerminalEvent) => {
          for (const listener of listeners) listener(event);
        };
        if (request.target?.kind === 'docker-logs') {
          emit({
            sessionId: request.sessionId,
            type: 'status',
            state: 'connected',
            hostname: 'willow',
          });
          emit({
            sessionId: request.sessionId,
            type: 'data',
            data: encoder.encode('\x1b[32m[live]\x1b[0m docker log line\n'),
            bytes: 31,
          });
        } else if (request.target?.kind === 'docker-exec') {
          if (!request.trustFingerprint) {
            emit({
              sessionId: request.sessionId,
              type: 'host-key',
              fingerprint: 'aa'.repeat(32),
              changed: false,
            });
          } else {
            emit({
              sessionId: request.sessionId,
              type: 'status',
              state: 'connected',
              hostname: 'willow',
            });
            emit({
              sessionId: request.sessionId,
              type: 'data',
              data: encoder.encode('\x1b[1;32mroot@zigbee2mqtt\x1b[0m:/# '),
              bytes: 31,
            });
          }
        } else if (request.target?.kind === 'service-logs') {
          emit({
            sessionId: request.sessionId,
            type: 'status',
            state: 'connected',
            hostname: 'willow',
          });
          emit({
            sessionId: request.sessionId,
            type: 'data',
            data: encoder.encode('[live] systemd journal\n'),
            bytes: 23,
          });
        }
      },
      write: async (_sessionId, data) => {
        written.push(data);
      },
      resize: () => undefined,
      ack: (_sessionId, bytes) => {
        ackedBytes.push(bytes);
      },
      close: (sessionId) => closed.push(sessionId),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      closeAll: () => undefined,
    },
  };

  await withRoot(
    createElement(GpuiServersView, {
      snapshot,
      system,
      onCopyText: (text) => copied.push(text),
    }),
    async (renderer) => {
      await flushMicrotasks(renderer);
      click(renderer, 'server-card-haus-hub-main');
      await flushMicrotasks(renderer);
      click(renderer, 'server-tab-services');
      await flushMicrotasks(renderer);

      click(renderer, 'service-logs-zigbee2mqtt');
      await flushMicrotasks(renderer, 10);
      click(renderer, 'console-copy');
      await flushMicrotasks(renderer);
      assert(
        copied.at(-1)?.includes('[live] docker log line'),
        'Live docker logs stream must render in xterm',
      );

      click(renderer, 'service-console-mode-terminal');
      await flushMicrotasks(renderer, 8);
      assert(
        renderer.findByTestId('console-trust-host-key'),
        'TOFU host-key banner must appear on untrusted session',
      );
      click(renderer, 'console-trust-host-key');
      await flushMicrotasks(renderer, 10);
      click(renderer, 'console-copy');
      await flushMicrotasks(renderer);
      assert(
        copied.at(-1)?.includes('root@zigbee2mqtt'),
        'Trusting host key must reconnect docker-exec session in xterm',
      );
      typeTerminal(renderer, 'ls');
      await flushMicrotasks(renderer, 6);
      assert.equal(
        written.join(''),
        'ls\r',
        'Direct xterm keystrokes must stream raw VT100 bytes to terminal.write',
      );
      click(renderer, 'service-console-done');
      await flushMicrotasks(renderer);

      click(renderer, 'service-logs-haus-hub.service');
      await flushMicrotasks(renderer, 10);
      click(renderer, 'console-copy');
      await flushMicrotasks(renderer);
      assert(
        copied.at(-1)?.includes('[live] systemd journal'),
        'Live systemd unit logs must stream cleanly into xterm',
      );
      click(renderer, 'service-console-done');
      await flushMicrotasks(renderer);

      assert(ackedBytes.length >= 3, 'xterm write callbacks must ack streamed PTY bytes');
      assert(
        opened.some(
          (r) => r.target?.kind === 'docker-logs' && r.target.containerId === 'zigbee2mqtt',
        ),
        'Must open docker-logs target',
      );
      assert(
        opened.some(
          (r) =>
            r.target?.kind === 'docker-exec' &&
            r.target.containerId === 'zigbee2mqtt' &&
            r.trustFingerprint === 'aa'.repeat(32),
        ),
        'Must reconnect docker-exec with pinned trustFingerprint',
      );
      assert(
        opened.some(
          (r) =>
            r.target?.kind === 'service-logs' &&
            r.target.manager === 'systemd' &&
            r.target.serviceId === 'haus-hub.service',
        ),
        'Must open systemd service-logs target',
      );
      assert(closed.length >= 4, 'All closed/replaced terminal sessions must call terminal.close');
    },
  );
}

async function checkSshSettingsFormInGpui(): Promise<void> {
  const submitted: ServerSshProfileInput[] = [];
  function Harness() {
    const [profile, setProfile] = useState<ServerSshProfileInput>({
      serverId: 'ssh-1',
      host: '192.168.1.50',
      port: 22,
      username: 'ops',
      environment: 'native',
      auth: 'password',
      rememberPassword: false,
    });
    return createElement(SshSettingsForm, {
      profile,
      configured: false,
      showWslEnvironment: true,
      loaded: true,
      connecting: false,
      onChange: (patch) => setProfile((prev) => ({ ...prev, ...patch })),
      onSubmit: () => submitted.push(profile),
    });
  }

  await withRoot(createElement(Harness), async (renderer) => {
    await flushMicrotasks(renderer);
    setInputValue(renderer, 'ssh-settings-host', '10.0.0.42');
    click(renderer, 'ssh-settings-remember');
    click(renderer, 'ssh-settings-connect');
    await flushMicrotasks(renderer);

    assert.equal(submitted.length, 1);
    assert.equal(submitted[0]?.host, '10.0.0.42');
    assert.equal(submitted[0]?.rememberPassword, true);
  });
}

await checkDemoServersAndServiceConsoles();
await checkLiveServiceConsoleContracts();
await checkSshSettingsFormInGpui();
console.log(
  'check-servers: TerminalSearchBar, ServiceConsoleModal, SshSettingsForm, and per-service consoles passed',
);
process.exit(0);
