import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { hostOperatingSystem, hostMetricsScope } from './host-system';
import { ServerGraphics } from './ServerGraphics';
import type { ServerHost } from './types';

it('shows actual Windows identity while preserving the explicit WSL resource scope', () => {
  const host = {
    platform: 'linux',
    release: '6.18.54.1-microsoft-standard-WSL2',
    osName: 'Ubuntu',
    metricsScope: 'wsl',
    operatingSystem: {
      name: 'Microsoft Windows 10 Pro',
      version: '10.0.19045',
      architecture: '64-bit',
    },
  } as ServerHost;
  expect(hostOperatingSystem(host)).toBe('Microsoft Windows 10 Pro · 10.0.19045 · 64-bit');
  expect(hostMetricsScope(host)).toBe('WSL resources');
  expect(
    hostOperatingSystem({
      ...host,
      operatingSystem: undefined,
      osName: 'Microsoft Windows 10 Pro · 10.0.19045',
    }),
  ).toBe('Microsoft Windows 10 Pro · 10.0.19045');
  expect(hostOperatingSystem({ ...host, operatingSystem: undefined })).not.toContain('6.18.54');
  expect(
    hostOperatingSystem({ platform: 'linux', osName: 'Ubuntu 24.04.4 LTS' } as ServerHost),
  ).toBe('Ubuntu 24.04.4 LTS');
});
it('renders every reported graphics adapter without inventing memory or integrated/discrete classification', () => {
  const host = {
    gpus: {
      available: true,
      source: 'windows-cim',
      adapters: [
        { id: 'a', name: 'Adapter A', vendor: 'AMD', driver: '1', kind: null, memoryBytes: null },
        {
          id: 'b',
          name: 'Adapter B',
          vendor: 'NVIDIA',
          driver: '2',
          kind: 'discrete',
          memoryBytes: 8 * 1024 ** 3,
        },
      ],
    },
  } as ServerHost;
  const html = renderToStaticMarkup(createElement(ServerGraphics, { host, fresh: true }));
  expect(html).toContain('Adapter A');
  expect(html).toContain('Adapter B');
  expect(html).toContain('Discrete');
  expect(html).toContain('8 GB dedicated memory');
  expect(html).not.toContain('Integrated');
  expect(html).not.toContain('0 B');
  expect(
    renderToStaticMarkup(
      createElement(ServerGraphics, {
        host: { ...host, gpus: { available: false, source: 'unavailable', adapters: [] } },
        fresh: true,
      }),
    ),
  ).toBe('');
});
