import { expect, it } from 'vitest';
import { validateServiceOperation } from './helper-service-validation';

const path = '/api/cluster/nodes/98406f80-75ca-4c91-9633-23cc2f32a200';
const sshServerId = 'ssh:98406f80-75ca-4c91-9633-23cc2f32a100';
it('permits a scoped monitoring association without exposing generic host commands or credentials', () => {
  expect(
    validateServiceOperation('POST', '/api/cluster/nodes', {
      name: 'Fixture',
      url: 'https://fixture.local',
      key: 'x'.repeat(32),
      roles: [],
      allowHttp: false,
      sshServerId,
    }),
  ).toBe(true);
  expect(validateServiceOperation('PATCH', path, { sshServerId })).toBe(true);
  expect(validateServiceOperation('PATCH', path, { sshServerId: null })).toBe(true);
  for (const input of ['home-assistant', 'ssh:' + '-'.repeat(36), { id: sshServerId }])
    expect(validateServiceOperation('PATCH', path, { sshServerId: input })).toBe(false);
  expect(validateServiceOperation('PATCH', '/api/servers/home-assistant', { sshServerId })).toBe(
    false,
  );
  expect(validateServiceOperation('PATCH', path, { sshServerId, password: 'private' })).toBe(false);
  expect(validateServiceOperation('PATCH', path, { sshServerId, command: 'install' })).toBe(false);
  expect(validateServiceOperation('PATCH', path, { sshServerId, storageLimitBytes: null })).toBe(
    false,
  );
});
