import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[] }));
const network = vi.hoisted(() => ({ request: vi.fn() }));
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
const frame = (time: number) => {
  vi.setSystemTime(time);
  const current = [...frames.values()];
  frames.clear();
  for (const callback of current) callback(time);
};
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
  vi.setSystemTime(0);
  frames.clear();
  frameId = 0;
  vi.stubGlobal('performance', { now: () => Date.now() });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
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
it('publishes held observations once per second and skips missed ticks after returning from the background', async () => {
  const server = {
    id: 'fixture',
    online: true,
    host: {
      sampledAt: new Date(0).toISOString(),
      cpu: { usage: 0.2 },
      memory: { totalBytes: 100, usedBytes: 50 },
      swap: { supported: false },
    },
  };
  network.request.mockImplementation((_method: string, path: string) =>
    Promise.resolve(path === '/api/servers' ? { servers: [server], sampledAt: 0 } : {}),
  );
  render(true);
  await settle();
  expect(render(true).history.fixture).toHaveLength(1);
  frame(999);
  expect(render(true).history.fixture).toHaveLength(1);
  frame(1000);
  expect(render(true).history.fixture).toHaveLength(2);
  frame(1999);
  expect(render(true).history.fixture).toHaveLength(2);
  frame(2000);
  expect(render(true).history.fixture.at(-1)).toMatchObject({ time: 2000, cpu: 0.2, memory: 0.5 });
  (document as unknown as { visibilityState: string }).visibilityState = 'hidden';
  frame(2100);
  frame(65000);
  expect(render(true).history.fixture).toHaveLength(3);
  (document as unknown as { visibilityState: string }).visibilityState = 'visible';
  const listener = vi
    .mocked(document.addEventListener)
    .mock.calls.find(([type]) => type === 'visibilitychange')?.[1] as () => void;
  listener();
  frame(66000);
  const history = render(true).history.fixture;
  expect(history).toHaveLength(4);
  expect(history.at(-1)).toMatchObject({ time: 66000, cpu: null });
});
