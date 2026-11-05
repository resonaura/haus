/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it, vi } from 'vitest';
import {
  FakeHaRuntime,
  HaRuntimeAdapter,
  type HaClientLike,
  type HaRuntime,
} from '../src/runtime/index.js';

describe('Home Assistant Runtime Port (Fake vs Adapter)', () => {
  const baseConfig = {
    base: 'http://127.0.0.1:8123',
    ws: 'ws://127.0.0.1:8123/api/websocket',
    token: 'test-token',
  };

  it('proves FakeHaRuntime satisfies the HaRuntime contract', async () => {
    const fake = new FakeHaRuntime({
      status: { version: '2024.11.0' },
      backupSlug: 'fake-slug-42',
    });

    // 1. Status
    const status = await fake.status();
    expect(status.state).toBe('running');
    expect(status.connected).toBe(true);
    expect(status.version).toBe('2024.11.0');

    // 2. Configuration
    const config = await fake.configuration();
    expect(config.base).toBe('http://127.0.0.1:8123');
    expect(config.components).toContain('light');

    // 3. Backup
    const backup = await fake.backup({ name: 'my-backup' });
    expect(backup.slug).toBe('fake-slug-42');
    expect(fake.backupCalls).toHaveLength(1);
    expect(fake.backupCalls[0].name).toBe('my-backup');

    // 4. Update
    fake.setUpdateResult({ status: 'started', version: '2024.12.0' });
    const update = await fake.update({ targetVersion: '2024.12.0' });
    expect(update.status).toBe('started');
    expect(update.version).toBe('2024.12.0');
    expect(fake.updateCalls).toHaveLength(1);

    // 5. Stop
    await fake.stop();
    expect(fake.stopCount).toBe(1);
    const stoppedStatus = await fake.status();
    expect(stoppedStatus.state).toBe('stopped');
    expect(stoppedStatus.connected).toBe(false);
  });

  it('proves HaRuntimeAdapter satisfies the HaRuntime contract with client and supervisor', async () => {
    let clientConnected = true;
    let clientStopped = false;

    const mockClient: HaClientLike = {
      get connected() {
        return clientConnected;
      },
      get stopped() {
        return clientStopped;
      },
      request: vi.fn(async (msg: Record<string, unknown>) => {
        if (msg.type === 'get_config') {
          return {
            version: '2024.10.5',
            time_zone: 'America/New_York',
            unit_system: { temperature: '°F' },
            components: ['camera', 'sensor'],
          };
        }
        return {};
      }),
      stop: vi.fn(() => {
        clientStopped = true;
        clientConnected = false;
      }),
    };

    const mockSupervisor = vi.fn(
      async (path: string, options?: { method?: string; body?: unknown }) => {
        if (path === '/supervisor/info') {
          return { data: { version: '2024.10.1', channel: 'stable', healthy: true } };
        }
        if (path === '/backups/new/partial' && options?.method === 'POST') {
          return { data: { slug: 'supervisor-backup-slug-123' } };
        }
        if (path === '/core/update' && options?.method === 'POST') {
          return { result: 'ok' };
        }
        return {};
      },
    );

    const adapter = new HaRuntimeAdapter({
      client: mockClient,
      config: baseConfig,
      supervisorClient: mockSupervisor,
    });

    // 1. Status
    const status = await adapter.status();
    expect(status.state).toBe('running');
    expect(status.connected).toBe(true);
    expect(status.version).toBe('2024.10.5');
    expect(status.supervisor?.available).toBe(true);
    expect(status.supervisor?.version).toBe('2024.10.1');

    // 2. Configuration
    const config = await adapter.configuration();
    expect(config.base).toBe('http://127.0.0.1:8123');
    expect(config.timezone).toBe('America/New_York');
    expect(config.unitSystem).toBe('°F');
    expect(config.components).toContain('camera');

    // 3. Backup
    const backup = await adapter.backup({ name: 'test-backup' });
    expect(backup.slug).toBe('supervisor-backup-slug-123');
    expect(mockSupervisor).toHaveBeenCalledWith(
      '/backups/new/partial',
      expect.objectContaining({ method: 'POST' }),
    );

    // 4. Update
    const update = await adapter.update({ targetVersion: '2024.11.0' });
    expect(update.status).toBe('started');
    expect(update.version).toBe('2024.11.0');
    expect(mockSupervisor).toHaveBeenCalledWith(
      '/core/update',
      expect.objectContaining({ method: 'POST' }),
    );

    // 4b. Up-to-date check
    const upToDate = await adapter.update({ targetVersion: '2024.10.5' });
    expect(upToDate.status).toBe('up-to-date');

    // 5. Stop
    await adapter.stop();
    expect(mockClient.stop).toHaveBeenCalled();
    const stoppedStatus = await adapter.status();
    expect(stoppedStatus.state).toBe('stopped');
    expect(stoppedStatus.connected).toBe(false);
  });

  it('demonstrates polymorphic interchangeability: fake and adapter share the exact same consumer', async () => {
    // Consumer function accepting HaRuntime port
    async function orchestrateRuntime(runtime: HaRuntime) {
      const initialStatus = await runtime.status();
      const cfg = await runtime.configuration();
      const backupResult = await runtime.backup({ name: 'hub-archive' });
      await runtime.stop();
      const finalStatus = await runtime.status();

      return {
        initialConnected: initialStatus.connected,
        base: cfg.base,
        backupSlug: backupResult.slug,
        finalConnected: finalStatus.connected,
      };
    }

    // Run against Fake
    const fake = new FakeHaRuntime({
      backupSlug: 'fake-shared-slug',
    });
    const fakeResult = await orchestrateRuntime(fake);
    expect(fakeResult).toEqual({
      initialConnected: true,
      base: 'http://127.0.0.1:8123',
      backupSlug: 'fake-shared-slug',
      finalConnected: false,
    });

    // Run against Adapter
    let connected = true;
    const client: HaClientLike = {
      get connected() {
        return connected;
      },
      request: vi.fn(async () => ({})),
      stop: vi.fn(() => {
        connected = false;
      }),
    };
    const adapter = new HaRuntimeAdapter({
      client,
      config: baseConfig,
    });
    const adapterResult = await orchestrateRuntime(adapter);
    expect(adapterResult.initialConnected).toBe(true);
    expect(adapterResult.base).toBe('http://127.0.0.1:8123');
    expect(adapterResult.backupSlug).toMatch(/^core-backup-/);
    expect(adapterResult.finalConnected).toBe(false);
  });
});
