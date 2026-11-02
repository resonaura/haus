import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDiscoveryTask, parseDiscoveredHomeAssistant } from './discovery';

afterEach(() => vi.useRealTimers());

describe('Home Assistant network discovery', () => {
  it('accepts local advertised URLs and correctly brackets IPv6 fallback addresses', () => {
    expect(
      parseDiscoveredHomeAssistant({
        host: 'homeassistant.local.',
        name: 'HA',
        port: 8123,
        txt: { location_name: 'Narnia', uuid: 'home-id', version: '2026.11.0' },
      }),
    ).toMatchObject({
      id: 'home-id',
      name: 'Narnia',
      host: 'homeassistant.local',
      port: 8123,
      url: 'http://homeassistant.local:8123',
      version: '2026.11.0',
    });

    expect(
      parseDiscoveredHomeAssistant({
        host: 'fd12::44',
        name: 'IPv6 HA',
        port: 8123,
        txt: {},
      })?.url,
    ).toBe('http://[fd12::44]:8123');
  });

  it('rejects landing pages, remote/malformed URLs and invalid ports', () => {
    const base = { host: 'ha.local', name: 'HA', port: 8123, txt: {} };
    expect(parseDiscoveredHomeAssistant({ ...base, txt: { landingpage: 'true' } })).toBeUndefined();
    expect(
      parseDiscoveredHomeAssistant({
        ...base,
        txt: { internal_url: 'https://attacker.example/login' },
      }),
    ).toBeUndefined();
    expect(parseDiscoveredHomeAssistant({ ...base, port: 70000 })).toBeUndefined();
    expect(
      parseDiscoveredHomeAssistant({ ...base, txt: { internal_url: 'http://ha.local/path' } }),
    ).toBeUndefined();
  });

  it('closes the multicast browser when canceled and retains manual discovery fallback', async () => {
    const stop = vi.fn();
    const controller = new AbortController();
    const browse = vi.fn((onService: (service: never) => void) => {
      onService({
        host: 'ha.local',
        name: 'HA',
        port: 8123,
        txt: { location_name: 'Home' },
      } as never);
      return stop;
    });
    const task = createDiscoveryTask(5000, controller.signal, browse);

    controller.abort();

    await expect(task.promise).resolves.toMatchObject([{ name: 'Home' }]);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('stops scanning at the bounded discovery deadline', async () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    const task = createDiscoveryTask(100, undefined, () => stop);
    await vi.advanceTimersByTimeAsync(100);
    await expect(task.promise).resolves.toEqual([]);
    expect(stop).toHaveBeenCalledOnce();
  });
});
