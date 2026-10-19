import { it, expect } from 'vitest';
import { PreferenceSync, type SharedDocument } from './preference-sync';
it('an idle device adopts remote fields without overwriting them', async () => {
  let local = { favorites: ['old'], roomIcons: {} };
  const writes: unknown[] = [];
  const sync = new PreferenceSync({
    local: () => local,
    apply: (patch) => {
      local = { ...local, ...patch };
    },
    read: async () => ({
      revision: '1',
      value: { favorites: ['new'], roomIcons: { bedroom: 'bed' } },
      updatedAt: 1,
    }),
    write: async (revision, patch) => {
      writes.push(patch);
      return { revision: '2', value: patch, updatedAt: 2 };
    },
    status: () => {},
  });
  await sync.sync();
  expect(local.favorites).toEqual(['new']);
  expect(writes).toHaveLength(0);
});
it('rebases separate field edits after compare-and-swap conflicts', async () => {
  let local: Record<string, unknown> = { favorites: [], roomIcons: {} };
  let remote: SharedDocument = { revision: '1', value: { ...local }, updatedAt: 1 };
  let calls = 0;
  const sync = new PreferenceSync({
    local: () => local,
    apply: (p) => {
      local = { ...local, ...p };
    },
    read: async () => remote,
    write: async (base, patch) => {
      calls++;
      if (calls === 1) {
        remote = {
          revision: '2',
          value: { favorites: [], roomIcons: { bedroom: 'moon' } },
          updatedAt: 2,
        };
        return { ...remote, conflict: true };
      }
      remote = { revision: '3', value: { ...remote.value, ...patch }, updatedAt: 3 };
      return remote;
    },
    status: () => {},
  });
  local = { ...local, favorites: ['lamp'] };
  sync.changed();
  await sync.sync();
  expect(remote.value).toEqual({ favorites: ['lamp'], roomIcons: { bedroom: 'moon' } });
  expect(calls).toBe(2);
});
it('ignores responses after disconnecting or switching homes', async () => {
  let resolve!: (doc: SharedDocument) => void;
  let applied = false,
    wrote = false;
  const sync = new PreferenceSync({
    local: () => ({}),
    apply: () => {
      applied = true;
    },
    read: () =>
      new Promise((r) => {
        resolve = r;
      }),
    write: async () => {
      wrote = true;
      return { revision: '1', value: {}, updatedAt: 1 };
    },
    status: () => {},
  });
  const pending = sync.sync();
  sync.stop();
  resolve({ revision: '1', value: { favorites: ['private'] }, updatedAt: 1 });
  await pending;
  expect(applied).toBe(false);
  expect(wrote).toBe(false);
});
it('preserves offline edits against the last acknowledged home document', async () => {
  const baseline = { favorites: ['before'], roomIcons: {} };
  let local: Record<string, unknown> = { favorites: ['offline'], roomIcons: {} };
  let remote: SharedDocument = {
    revision: '2',
    value: { favorites: ['before'], roomIcons: { narnia: 'moon' } },
    updatedAt: 2,
  };
  const sync = new PreferenceSync(
    {
      local: () => local,
      apply: (patch) => {
        local = { ...local, ...patch };
      },
      read: async () => remote,
      write: async (_base, patch) => {
        remote = { revision: '3', value: { ...remote.value, ...patch }, updatedAt: 3 };
        return remote;
      },
      status: () => {},
    },
    baseline,
  );
  await sync.sync();
  expect(remote.value).toEqual({ favorites: ['offline'], roomIcons: { narnia: 'moon' } });
});
