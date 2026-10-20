import { expect, it } from 'vitest';
import { validateManagement, validateRequest } from './validation';
it('permits exact community reads and explicit repository lifecycle operations', () => {
  for (const message of [
    { type: 'hacs/info' },
    { type: 'hacs/repositories/list' },
    { type: 'hacs/repository/info', repository_id: '12345' },
    { type: 'hacs/repository/download', repository: '12345', version: 'v2.0.5' },
    { type: 'hacs/repository/beta', repository: '12345', show_beta: true },
    { type: 'hacs/repositories/add', repository: 'owner/project', category: 'integration' },
    { type: 'hacs/critical/acknowledge', repository: 'owner/project' },
  ])
    expect(validateRequest(message)).toEqual(message);
});
it('rejects arbitrary community commands, remote targets, injected fields and malformed versions', () => {
  for (const message of [
    { type: 'hacs/execute', command: 'shell' },
    { type: 'hacs/repository/download', repository: '../../anything' },
    { type: 'hacs/repository/remove', repository: '12345', token: 'secret' },
    {
      type: 'hacs/repositories/add',
      repository: 'https://evil.example/project',
      category: 'integration',
    },
    { type: 'hacs/repository/beta', repository: '12345', show_beta: 'true' },
    { type: 'hacs/repository/download', repository: '12345', version: 'v1\u0000bad' },
  ])
    expect(() => validateRequest(message)).toThrow();
});
it('constrains camera previews and native repair flows to their exact paths', () => {
  expect(
    validateManagement({
      method: 'POST',
      path: 'repairs/issues/fix',
      data: { handler: 'fixture', issue_id: 'authentication' },
    }),
  ).toBeTruthy();
  expect(
    validateManagement({ method: 'DELETE', path: 'repairs/issues/fix/owned-flow' }),
  ).toBeTruthy();
  for (const path of ['repairs/issues/fix', 'repairs/issues/fix/../other', 'repairs/issues/delete'])
    expect(() => validateManagement({ method: 'DELETE', path })).toThrow();
  expect(
    validateRequest({ type: 'generic_camera/start_preview', flow_id: 'fixture_123' }),
  ).toBeTruthy();
  expect(() =>
    validateRequest({ type: 'generic_camera/start_preview', flow_id: '../../other' }),
  ).toThrow();
  expect(() =>
    validateRequest({
      type: 'generic_camera/start_preview',
      flow_id: 'fixture',
      user_input: { url: 'unexpected' },
    }),
  ).toThrow();
});
