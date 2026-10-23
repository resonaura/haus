import { describe, expect, it, vi } from 'vitest';
import { confirmStorageLimit, saveThenRefresh, serverRequest } from './server-api';
import { serverErrorMessage } from './server-errors';
import type { ServersStatus } from './types';

const snapshot = (limit: number | null): ServersStatus => ({
  sampledAt: 100000,
  servers: [
    {
      id: 'worker',
      kind: 'nvr',
      name: 'Worker',
      online: true,
      host: null,
      settings: { storageLimitBytes: limit },
    },
  ],
});
describe('confirmed server settings saves', () => {
  it('keeps the older-helper update guidance through the native request and banner layers', async () => {
    vi.stubGlobal('window', {
      hausNative: {
        helper: vi
          .fn()
          .mockRejectedValue(
            new Error("Error invoking remote method 'haus:helper': Error: not found"),
          ),
      },
    });
    try {
      const reason = await serverRequest('GET', '/api/servers').catch((error) => error);
      expect(serverErrorMessage(reason)).toBe(
        'Update the Haus helper in Home Assistant to use server management, then refresh this page.',
      );
      await expect(
        serverRequest('PATCH', '/api/cluster/nodes/worker', { enabled: false }),
      ).rejects.toThrow('This server is no longer available.');
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('waits for the refreshed policy after a successful write before reporting success', async () => {
    let resolve!: (value: ServersStatus) => void;
    const refreshed = new Promise<ServersStatus>((done) => {
      resolve = done;
    });
    const onSaved = vi.fn();
    const action = vi.fn().mockResolvedValue({ accepted: true });
    const result = saveThenRefresh(
      action,
      () => refreshed,
      (status) => confirmStorageLimit(status, 'worker', null),
    ).then(onSaved);
    await vi.waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(onSaved).not.toHaveBeenCalled();
    resolve(snapshot(null));
    await result;
    expect(onSaved).toHaveBeenCalledOnce();
  });
  it('keeps an acknowledged write unconfirmed when its refresh fails', async () => {
    const saved = vi.fn();
    const action = vi.fn().mockResolvedValue({ accepted: true });
    const request = saveThenRefresh(action, () =>
      Promise.reject(new Error('connection lost')),
    ).then(saved);
    await expect(request).rejects.toThrow('connection lost');
    expect(action).toHaveBeenCalledOnce();
    expect(saved).not.toHaveBeenCalled();
  });
  it('does not confirm an old policy or a removed server after refresh', async () => {
    await expect(
      saveThenRefresh(
        async () => {},
        async () => snapshot(200),
        (status) => confirmStorageLimit(status, 'worker', 120),
      ),
    ).rejects.toThrow('has not been confirmed');
    expect(() => confirmStorageLimit({ servers: [], sampledAt: 100000 }, 'worker', null)).toThrow(
      'has not been confirmed',
    );
  });
  it('never fetches a policy confirmation when the write itself failed', async () => {
    const refresh = vi.fn();
    await expect(
      saveThenRefresh(() => Promise.reject(new Error('not authorized')), refresh),
    ).rejects.toThrow('not authorized');
    expect(refresh).not.toHaveBeenCalled();
  });
});
