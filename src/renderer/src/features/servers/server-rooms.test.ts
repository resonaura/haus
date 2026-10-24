import { describe, expect, it } from 'vitest';
import { groupServersByRoom, namedServer } from './server-rooms';
import type { HomeServer } from './types';

const server: HomeServer = {
  id: 'node-a',
  kind: 'nvr',
  name: 'Home media server',
  online: true,
  host: null,
};
describe('server room presentation', () => {
  it('uses synchronized device identity while preserving telemetry and the original server response', () => {
    const next = namedServer(server, { 'node-a': { name: ' Miku ', areaId: 'narnia' } });
    expect(next.name).toBe('Miku');
    expect(next.online).toBe(true);
    expect(server.name).toBe('Home media server');
  });
  it('groups servers in their actual rooms and keeps a missing room in Unassigned', () => {
    const groups = groupServersByRoom(
      [
        server,
        { ...server, id: 'node-b' },
        { ...server, id: 'home-assistant', kind: 'home-assistant', name: 'Home Assistant' },
      ],
      [{ id: 'narnia', name: 'Narnia' }],
      {
        'node-a': { areaId: 'narnia', name: 'Miku' },
        'node-b': { areaId: 'removed' },
        'home-assistant': { areaId: 'narnia' },
      },
    );
    expect(groups.map((group) => [group.name, group.servers.map((item) => item.name)])).toEqual([
      ['Narnia', ['Miku', 'Home Assistant']],
      ['Unassigned', ['Home media server']],
    ]);
  });
  it('does not invent room assignments or device names without preferences', () => {
    expect(groupServersByRoom([server])).toEqual([
      { id: '', name: 'Unassigned', servers: [server] },
    ]);
    expect(namedServer(server, { 'node-a': { name: ' ' } })).toBe(server);
  });
});
