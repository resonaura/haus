import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[] }));
const network = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./server-api', () => ({ serverRequest: network.request }));
vi.mock('react', () => ({
  useState(initial: unknown) {
    const index = hooks.cursor++;
    hooks.slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
    return [
      hooks.slots[index].value,
      (value: unknown) => {
        hooks.slots[index].value =
          typeof value === 'function' ? value(hooks.slots[index].value) : value;
      },
    ];
  },
  useRef(initial: unknown) {
    return (hooks.slots[hooks.cursor++] ??= { current: initial });
  },
  useCallback(callback: unknown, deps: unknown[]) {
    const index = hooks.cursor++;
    const old = hooks.slots[index];
    if (!old || old.deps.some((value: unknown, i: number) => value !== deps[i]))
      hooks.slots[index] = { callback, deps };
    return hooks.slots[index].callback;
  },
  useEffect(callback: () => (() => void) | undefined, deps: unknown[]) {
    const index = hooks.cursor++;
    const old = hooks.slots[index];
    if (old && old.deps.every((value: unknown, i: number) => value === deps[i])) return;
    const slot = { deps, cleanup: undefined as (() => void) | undefined };
    hooks.slots[index] = slot;
    hooks.effects.push(() => {
      old?.cleanup?.();
      slot.cleanup = callback();
    });
  },
}));
import { useServers } from './useServers';
function render(enabled: boolean) {
  hooks.cursor = 0;
  const value = useServers(false, enabled);
  for (const effect of hooks.effects.splice(0)) effect();
  return value;
}
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
beforeEach(() => {
  hooks.slots = [];
  hooks.effects = [];
  network.request.mockReset();
  vi.useFakeTimers();
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});
afterEach(() => {
  for (const slot of hooks.slots) slot?.cleanup?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('ignores a request from before close and refreshes immediately after it settles on reopen', async () => {
  let resolveOld!: (value: unknown) => void;
  const fresh = { servers: [], sampledAt: 200 };
  network.request.mockImplementation((_method: string, path: string) =>
    path === '/api/servers'
      ? network.request.mock.calls.filter(([, path]) => path === '/api/servers').length === 1
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve(fresh)
      : Promise.resolve({ backups: { items: [] } }),
  );
  render(true);
  render(false);
  render(true);
  expect(network.request.mock.calls.filter(([, path]) => path === '/api/servers')).toHaveLength(1);
  resolveOld({ servers: [], sampledAt: 100 });
  await settle();
  expect(network.request.mock.calls.filter(([, path]) => path === '/api/servers')).toHaveLength(2);
  expect(render(true).status).toEqual(fresh);
});
it('does not queue a fresh request when closed again before the stale request completes', async () => {
  let resolveOld!: (value: unknown) => void;
  network.request.mockImplementation((_method: string, path: string) =>
    path === '/api/servers'
      ? new Promise((resolve) => {
          resolveOld = resolve;
        })
      : Promise.resolve({}),
  );
  render(true);
  render(false);
  render(true);
  render(false);
  resolveOld({ servers: [], sampledAt: 100 });
  await settle();
  expect(network.request.mock.calls.filter(([, path]) => path === '/api/servers')).toHaveLength(1);
  expect(render(false).status).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});
