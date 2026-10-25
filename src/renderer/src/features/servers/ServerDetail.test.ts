import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ServerDetail } from './ServerDetail';
import type { HomeServer } from './types';

const server: HomeServer = {
  id: 'home-assistant',
  kind: 'home-assistant',
  name: 'Home Assistant',
  online: true,
  host: {
    sampledAt: new Date(100000).toISOString(),
    scope: 'host',
    hostname: null,
    platform: null,
    release: null,
    arch: null,
    uptimeSeconds: null,
    cpu: { model: 'Host CPU', logicalCores: null, usage: null, loadAverage: [null, 0.25] },
    memory: { totalBytes: null, usedBytes: null, availableBytes: null },
    swap: { supported: false, totalBytes: null, usedBytes: null },
    disks: [
      {
        id: 'disk',
        name: 'Data',
        kind: 'disk',
        physical: null,
        parentIds: [],
        parentId: null,
        mountpoint: null,
        filesystem: null,
        totalBytes: null,
        usedBytes: null,
        availableBytes: null,
        scope: 'host',
      },
    ],
    docker: { available: false, source: 'unavailable', containers: [] },
    pm2: { available: false, source: 'unavailable', processes: [] },
  },
  settings: { storageLimitBytes: null },
};
const render = (fresh: boolean) =>
  renderToStaticMarkup(
    createElement(ServerDetail, {
      server,
      history: [],
      admin: true,
      busy: false,
      fresh,
      now: 100000,
      onSaveLimit: async () => {},
      onToggle: () => {},
      onRemove: () => {},
    }),
  );
describe('nullable and last-known server detail', () => {
  it('renders a real partially unavailable host response without crashing or displaying null facts', () => {
    const markup = render(true);
    expect(markup).toContain('Core count unavailable');
    expect(markup).toContain('Load average 0.25');
    expect(markup).not.toContain('null logical cores');
    expect(markup).not.toContain('null · null');
    expect(markup).toContain('Disk');
    expect(markup).not.toContain('NaN');
    expect(markup).not.toContain('Physical disk');
    expect(markup).toContain('aria-label="Disks and volumes"');
  });
  it('labels cached details and disables storage mutation after the status connection is lost', () => {
    const markup = render(false);
    expect(markup).toContain('Last known status');
    expect(markup).toContain('Resource information is last known');
    expect(markup).toContain('Last sampled');
    expect(markup).not.toContain('>Connected<');
    expect(markup).not.toContain('Load average 0.25');
    expect(markup).toMatch(/<button[^>]*(?:disabled|aria-disabled="true")[^>]*>[^]*?Unlimited/);
  });
});
