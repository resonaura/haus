import { expect, it } from 'vitest';
import type { ServerSshServer } from '../../../../shared/terminal';
import { mergeServerConnections, serverHasNvr, serverManagementId } from './server-connections';
import { telemetryIsFresh } from './presentation';
import type { HomeServer } from './types';

const id = 'ssh:98406f80-75ca-4c91-9633-23cc2f32a100';
const profile: ServerSshServer = {
  serverId: id,
  host: 'fixture.local',
  port: 22,
  username: 'operator',
  environment: 'native',
  auth: 'agent',
  hasPassword: false,
  online: true,
};
const managed: HomeServer = {
  id: '98406f80-75ca-4c91-9633-23cc2f32a200',
  kind: 'nvr',
  name: 'Fixture server',
  online: true,
  host: null,
  roles: [],
  sshServerId: id,
};

it('joins monitoring and SSH into one shared device while retaining the management endpoint identity', () => {
  const [server] = mergeServerConnections([managed], [profile]);
  expect(mergeServerConnections([managed], [profile])).toHaveLength(1);
  expect(server).toMatchObject({
    id,
    kind: 'ssh',
    managedId: managed.id,
    monitoringOnline: true,
    online: true,
  });
  expect(serverManagementId(server)).toBe(managed.id);
  expect(serverHasNvr(server)).toBe(false);
});

it('keeps the same shared device identity on a desktop that has no saved SSH credentials', () => {
  const [server] = mergeServerConnections([managed], []);
  expect(server).toMatchObject({ id, managedId: managed.id, kind: 'nvr' });
  expect(serverHasNvr(server)).toBe(false);
});

it('does not create duplicate cards from terminal credentials saved for an existing managed server', () => {
  expect(mergeServerConnections([managed], [{ ...profile, serverId: managed.id }])).toHaveLength(1);
  const ordinary = { ...managed, sshServerId: undefined };
  expect(mergeServerConnections([ordinary], [{ ...profile, serverId: ordinary.id }])).toEqual([
    ordinary,
  ]);
});

it('retains SSH availability but immediately marks helper telemetry stale when monitoring disconnects', () => {
  const host = { sampledAt: new Date(10000).toISOString() } as HomeServer['host'];
  const [server] = mergeServerConnections([{ ...managed, host, online: false }], [profile]);
  expect(server.online).toBe(true);
  expect(server.monitoringOnline).toBe(false);
  expect(telemetryIsFresh(server, true, 10000)).toBe(false);
});

it('preserves configured NVR duties after attaching SSH and supports plain SSH without telemetry', () => {
  const [server] = mergeServerConnections([{ ...managed, roles: ['stream'] }], [profile]);
  expect(serverHasNvr(server)).toBe(true);
  const [ssh] = mergeServerConnections([], [{ ...profile, host: '2001:db8::1' }]);
  expect(ssh.host).toBeNull();
  expect(ssh.url).toBe('ssh://[2001:db8::1]:22');
  expect(serverHasNvr(ssh)).toBe(false);
});
