import { describe, expect, it, vi } from 'vitest';
import {
  canonicalDashboardConfig,
  DashboardSaveError,
  syncDashboard,
  type DashboardRequest,
} from './dashboard-sync';

const desired = { title: 'My Home · Haus', views: [{ title: 'Home', sections: [] }] };

function transport(responses: unknown[]) {
  const mock = vi.fn(async (_message: Record<string, unknown>) => {
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  });
  return { mock, request: mock as DashboardRequest };
}

describe('separate Home Assistant dashboard sync', () => {
  it('creates and saves only the explicitly named storage dashboard', async () => {
    const { mock, request } = transport([[{ url_path: 'lovelace', mode: 'storage' }], {}, null]);
    expect(await syncDashboard(request, desired)).toEqual({ kind: 'created' });
    expect(mock.mock.calls.map(([message]) => message.type)).toEqual([
      'lovelace/dashboards/list',
      'lovelace/dashboards/create',
      'lovelace/config/save',
    ]);
    expect(mock.mock.calls[1][0]).toMatchObject({
      url_path: 'haus-home',
      mode: 'storage',
      title: 'Haus',
    });
    expect(mock.mock.calls[2][0]).toEqual({
      type: 'lovelace/config/save',
      url_path: 'haus-home',
      config: desired,
    });
    expect(
      mock.mock.calls
        .filter(([message]) => 'url_path' in message)
        .every(([message]) => message.url_path === 'haus-home'),
    ).toBe(true);
  });

  it.each([
    '',
    'lovelace',
    'overview',
    'default',
    'haus',
    '../haus-home',
    'haus-home/other',
    'Haus-Home',
    '-haus',
    'haus-',
  ])('refuses an unsafe or default dashboard path %s before any request', async (urlPath) => {
    const { mock, request } = transport([]);
    await expect(syncDashboard(request, desired, { urlPath })).rejects.toThrow(
      'separate dashboard',
    );
    expect(mock).not.toHaveBeenCalled();
  });

  it('refuses an existing dashboard without saved generation metadata, even if its title is Haus', async () => {
    const current = { title: 'Haus', views: [{ title: 'User view' }] };
    const { mock, request } = transport([
      [{ url_path: 'haus-home', mode: 'storage', title: 'Haus' }],
      current,
    ]);
    expect(await syncDashboard(request, desired)).toEqual({ kind: 'conflict', current });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('updates when the current config equals the last generated JSON regardless of object key order', async () => {
    const lastGenerated = {
      title: 'Previous',
      views: [{ title: 'Home', cards: [{ type: 'tile', entity: 'light.desk' }] }],
    };
    const current = {
      views: [{ cards: [{ entity: 'light.desk', type: 'tile' }], title: 'Home' }],
      title: 'Previous',
    };
    const { mock, request } = transport([
      [{ url_path: 'haus-home', mode: 'storage' }],
      current,
      null,
    ]);
    expect(await syncDashboard(request, desired, { lastGenerated })).toEqual({ kind: 'updated' });
    expect(mock.mock.calls[1][0]).toEqual({
      type: 'lovelace/config',
      url_path: 'haus-home',
      force: true,
    });
    expect(mock.mock.calls[2][0].type).toBe('lovelace/config/save');
  });

  it('returns the edited config as a conflict and sends no writes', async () => {
    const current = { ...desired, title: 'Edited by the user' };
    const { mock, request } = transport([[{ url_path: 'haus-home', mode: 'storage' }], current]);
    expect(await syncDashboard(request, desired, { lastGenerated: desired })).toEqual({
      kind: 'conflict',
      current,
    });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('never saves to YAML dashboards, even if they match the last generated config', async () => {
    const { mock, request } = transport([[{ url_path: 'haus-home', mode: 'yaml' }], desired]);
    expect(await syncDashboard(request, desired, { lastGenerated: desired })).toEqual({
      kind: 'conflict',
      current: desired,
    });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('preserves array order when checking for edits', async () => {
    const lastGenerated = { views: [{ title: 'One' }, { title: 'Two' }] };
    const current = { views: [...lastGenerated.views].reverse() };
    const { mock, request } = transport([[{ url_path: 'haus-home', mode: 'storage' }], current]);
    expect((await syncDashboard(request, desired, { lastGenerated })).kind).toBe('conflict');
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('stops when creation races with another client and is rejected', async () => {
    const { mock, request } = transport([[], new Error('URL already exists')]);
    await expect(syncDashboard(request, desired)).rejects.toThrow('URL already exists');
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('reports partial creation without deleting a dashboard when saving fails', async () => {
    const { mock, request } = transport([[], {}, new Error('Connection lost')]);
    const result = await syncDashboard(request, desired).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(DashboardSaveError);
    expect((result as DashboardSaveError).createdUrlPath).toBe('haus-home');
    expect(mock).toHaveBeenCalledTimes(3);
    expect(mock.mock.calls.some(([message]) => String(message.type).includes('delete'))).toBe(
      false,
    );
  });

  it('makes no writes after an unsupported list or unreadable config', async () => {
    const malformed = transport([{ dashboards: [] }]);
    await expect(syncDashboard(malformed.request, desired)).rejects.toThrow(
      'unsupported dashboard list',
    );
    expect(malformed.mock).toHaveBeenCalledTimes(1);
    const failedRead = transport([
      [{ url_path: 'haus-home', mode: 'storage' }],
      new Error('Read failed'),
    ]);
    await expect(
      syncDashboard(failedRead.request, desired, { lastGenerated: desired }),
    ).rejects.toThrow('Read failed');
    expect(failedRead.mock).toHaveBeenCalledTimes(2);
  });

  it('canonicalizes the same JSON that HA receives without mutating the preview', () => {
    const input = { views: [{ title: 'Home', optional: undefined }], title: 'Haus' };
    expect(canonicalDashboardConfig(input)).toEqual({ title: 'Haus', views: [{ title: 'Home' }] });
    expect(Object.keys(input)).toEqual(['views', 'title']);
    expect('optional' in input.views[0]).toBe(true);
  });
});
