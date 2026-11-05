/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it, vi } from 'vitest';
import { SupervisorApps, type SupervisorPort } from '../src/apps.js';
import type { AppOperation } from '@haus/apps';

describe('SupervisorApps Driver Contract & Operations', () => {
  function createMockSupervisorPort(customAddons?: unknown[]) {
    const addons = customAddons ?? [
      {
        slug: 'test_camera',
        name: 'Camera',
        version: '1.2.3',
        state: 'started',
        description: 'Haus Camera Addon',
        update_available: true,
        version_latest: '1.3.0',
        options: { password: 'private-secret' },
        secrets: { token: 'super-secret' },
      },
      {
        slug: 'mosquitto_mqtt',
        name: 'Mosquitto Broker',
        version: '2.0.18',
        state: 'stopped',
        description: 'MQTT message broker',
        update_available: false,
      },
    ];

    const request = vi.fn(async (method: string, path: string) => {
      if (method === 'GET' && path === '/addons') {
        return { data: { addons } };
      }
      if (method === 'POST' && path.startsWith('/addons/')) {
        return { result: 'ok' };
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    return { request: request as never as SupervisorPort['request'], mockFn: request };
  }

  it('maps managed apps without exposing Supervisor response fields to the app model', async () => {
    const port = createMockSupervisorPort();
    const driver = new SupervisorApps('runtime', port);
    const apps = await driver.list();

    expect(apps[0]).toMatchObject({
      externalId: 'test_camera',
      name: 'Camera',
      version: '1.2.3',
      state: 'running',
      managed: true,
      actions: ['start', 'stop', 'restart'],
    });

    // Ensure secrets and internal options never leak
    const serialized = JSON.stringify(apps);
    expect(serialized).not.toContain('private-secret');
    expect(serialized).not.toContain('super-secret');

    await driver.execute('test_camera', 'stop');
    expect(port.mockFn).toHaveBeenLastCalledWith('POST', '/addons/test_camera/stop', undefined);

    await expect(driver.execute('../../host', 'restart')).rejects.toThrow('invalid_app_action');
  });

  it('declares explicit driver capabilities with lifecycle always true', () => {
    const port = createMockSupervisorPort();
    const driver = new SupervisorApps('supervisor-ha', port);

    expect(driver.id).toBe('supervisor-ha');
    expect(driver.capabilities).toEqual({
      lifecycle: true,
      install: false,
      remove: false,
      update: false,
      configure: false,
      logs: false,
      info: true,
    });
  });

  it('maps addon lifecycle states accurately', async () => {
    const port = createMockSupervisorPort([
      { slug: 'app_started', state: 'started' },
      { slug: 'app_stopped', state: 'stopped' },
      { slug: 'app_unknown', state: 'error' },
      { slug: 'app_empty' },
    ]);
    const driver = new SupervisorApps('supervisor-ha', port);

    const apps = await driver.list();
    expect(apps.find((a) => a.externalId === 'app_started')?.state).toBe('running');
    expect(apps.find((a) => a.externalId === 'app_stopped')?.state).toBe('stopped');
    expect(apps.find((a) => a.externalId === 'app_unknown')?.state).toBe('unknown');
    expect(apps.find((a) => a.externalId === 'app_empty')?.state).toBe('unknown');
  });

  it('handles response without nested data envelope', async () => {
    const port: SupervisorPort = {
      request: vi.fn(async () => ({
        addons: [{ slug: 'direct_slug', name: 'Direct', state: 'started' }],
      })),
    };
    const driver = new SupervisorApps('supervisor-ha', port);

    const apps = await driver.list();
    expect(apps).toHaveLength(1);
    expect(apps[0].externalId).toBe('direct_slug');
  });

  it('throws invalid_app_inventory when addons is not an array', async () => {
    const port: SupervisorPort = {
      request: vi.fn(async () => ({ invalid: true })),
    };
    const driver = new SupervisorApps('supervisor-ha', port);
    await expect(driver.list()).rejects.toThrow('invalid_app_inventory');
  });

  it('executes start/stop/restart on valid addons and rejects invalid or unknown', async () => {
    const port = createMockSupervisorPort();
    const driver = new SupervisorApps('supervisor-ha', port);

    await driver.execute('test_camera', 'start');
    expect(port.mockFn).toHaveBeenCalledWith('POST', '/addons/test_camera/start', undefined);

    await driver.execute('test_camera', 'restart');
    expect(port.mockFn).toHaveBeenCalledWith('POST', '/addons/test_camera/restart', undefined);

    // Unknown app rejection
    await expect(driver.execute('nonexistent_addon', 'stop')).rejects.toThrow('unknown_app');

    // Invalid slug formats / path injection
    await expect(driver.execute('invalid slug with spaces', 'start')).rejects.toThrow(
      'invalid_app_action',
    );
    await expect(driver.execute('', 'start')).rejects.toThrow('invalid_app_action');
  });

  it('inspects a known addon and returns detailed AppInfo including update metadata', async () => {
    const port = createMockSupervisorPort();
    const driver = new SupervisorApps('supervisor-ha', port);

    const result = await driver.inspect('test_camera');
    expect(result.status).toBe('ok');
    expect(result.data).toEqual({
      externalId: 'test_camera',
      name: 'Camera',
      version: '1.2.3',
      state: 'running',
      managed: true,
      description: 'Haus Camera Addon',
      updatable: true,
      updateVersion: '1.3.0',
    });
  });

  it('returns error when inspecting unknown or invalid addon slug', async () => {
    const port = createMockSupervisorPort();
    const driver = new SupervisorApps('supervisor-ha', port);

    const invalid = await driver.inspect('../invalid/slug');
    expect(invalid.status).toBe('error');
    expect(invalid.reason).toBe('invalid_app_id');

    const unknown = await driver.inspect('not_installed_slug');
    expect(unknown.status).toBe('error');
    expect(unknown.reason).toBe('unknown_app');
  });

  it('returns explicit unsupported for non-implemented extended operations', async () => {
    const port = createMockSupervisorPort();
    const driver = new SupervisorApps('supervisor-ha', port);

    const unsupportedOps: AppOperation[] = ['install', 'remove', 'update', 'configure', 'logs'];
    for (const op of unsupportedOps) {
      const result = await driver.operate(op, 'test_camera');
      expect(result.status).toBe('unsupported');
      expect(result.reason).toBe(`supervisor_driver_does_not_support_${op}`);
    }
  });
});
