import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ServerNvr } from './ServerNvr';
import type { HomeServer } from './types';

const server: HomeServer = {
  id: 'worker',
  name: 'Home server',
  kind: 'nvr',
  host: null,
  online: true,
  enabled: true,
  roles: ['storage'],
  streams: { active: 3, max: 4 },
  backupCopies: 2,
};
const render = (value: HomeServer, fresh = true) =>
  renderToStaticMarkup(
    createElement(ServerNvr, {
      server: value,
      fresh,
      admin: false,
      busy: false,
      onSaveLimit: async () => {},
    }),
  );

describe('optional NVR work on a home server', () => {
  it('uses assigned roles rather than mistaking remote capacity for assigned work', () => {
    const markup = render(server);
    expect(markup).toContain('Not assigned');
    expect(markup).not.toContain('Active streams');
    expect(markup).toContain('Recovery copies on this server');
    expect(markup).not.toContain('Activity assist</span>');
  });
  it('conceals live utilization when the connection is stale or paused', () => {
    const streaming = { ...server, roles: ['stream'] };
    expect(render(streaming)).toContain('3 / 4');
    expect(render(streaming, false)).not.toContain('3 / 4');
    expect(render({ ...streaming, enabled: false })).not.toContain('3 / 4');
  });
});
