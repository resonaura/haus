import { expect, it, vi } from 'vitest';
import { HausClient, type HelperPort } from '../src/helper-client.js';
const serverId = '11111111-1111-4111-8111-111111111111';
it('confirms storage settings with the real read protocol and rejects stale confirmations', async () => {
  const calls = vi
    .fn()
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ servers: [{ id: serverId, settings: { storageLimitBytes: null } }] });
  const port: HelperPort = { request: calls };
  const client = new HausClient(port);
  await client.setStorageLimit(serverId, null);
  expect(calls.mock.calls).toEqual([
    [
      {
        method: 'PATCH',
        path: `/api/cluster/nodes/${serverId}`,
        data: { storageLimitBytes: null },
      },
    ],
    [{ method: 'GET', path: '/api/servers' }],
  ]);
  calls.mockResolvedValueOnce({}).mockResolvedValueOnce({ servers: [] });
  await expect(client.setStorageLimit(serverId, 100)).rejects.toThrow('storage-limit-unconfirmed');
});
it('uses the native allowlist before transport and discards responses after session disposal', async () => {
  let complete!: (value: unknown) => void;
  const request = vi.fn().mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const client = new HausClient({ request });
  await expect(
    client.request({ method: 'POST', path: '/api/shell', data: { command: 'anything' } }),
  ).rejects.toThrow('unavailable');
  await expect(client.setStorageLimit(serverId, -1)).rejects.toThrow('unavailable');
  expect(request).not.toHaveBeenCalled();
  const pending = client.servers();
  const discarded = expect(pending).rejects.toThrow('session-changed');
  client.dispose();
  complete({ servers: [] });
  await discarded;
  await expect(client.cluster()).rejects.toThrow('session-changed');
  expect(request).toHaveBeenCalledOnce();
});
