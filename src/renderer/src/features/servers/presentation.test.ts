import { describe, expect, it } from 'vitest';
import {
  appendSample,
  allocatedSpace,
  bytes,
  diskDepth,
  diskOtherAllocated,
  GIB,
  orderDisks,
  quotaRange,
  ratio,
  resourceSample,
  serviceSampleIsFresh,
  statusIsFresh,
  telemetryIsFresh,
} from './presentation';
import type { HomeServer, ServerDisk } from './types';

const disk = (id: string, parentId: string | null = null): ServerDisk => ({
  id,
  parentId,
  name: id,
  kind: parentId ? 'volume' : 'disk',
  mountpoint: null,
  filesystem: null,
  totalBytes: GIB,
  usedBytes: 0,
  availableBytes: GIB,
  scope: 'host',
});
const server: HomeServer = {
  id: 'worker',
  name: 'Worker',
  kind: 'nvr',
  online: true,
  host: null,
  storage: { usedBytes: 10 * GIB, freeBytes: 990 * GIB },
  settings: { storageLimitBytes: null },
};
describe('server resource presentation', () => {
  it('keeps unknown and zero resource readings distinct', () => {
    expect(bytes(null)).toBe('Unavailable');
    expect(bytes(0)).toBe('0 B');
    expect(ratio(null, GIB)).toBeNull();
    expect(ratio(0, GIB)).toBe(0);
    expect(ratio(2 * GIB, GIB)).toBe(1);
    expect(ratio(GIB, 0)).toBeNull();
    expect(ratio(NaN, GIB)).toBeNull();
    expect(bytes(-1)).toBe('Unavailable');
  });
  it('preserves nested disk depth and terminates malformed parent cycles', () => {
    const physical = disk('ssd');
    const partition = disk('partition', 'ssd');
    const container = disk('apfs', 'partition');
    const volume = disk('home', 'apfs');
    const disks = [volume, container, partition, physical];
    expect(orderDisks(disks).map((item) => item.id)).toEqual(['ssd', 'partition', 'apfs', 'home']);
    expect(disks.map((item) => diskDepth(item, disks))).toEqual([3, 2, 1, 0]);
    expect(diskDepth(disk('one', 'two'), [disk('one', 'two'), disk('two', 'one')])).toBe(1);
  });
  it('does not label other APFS volume allocations as reserved space', () => {
    expect(
      diskOtherAllocated({
        ...disk('home'),
        totalBytes: 100 * GIB,
        usedBytes: 10 * GIB,
        availableBytes: 50 * GIB,
      }),
    ).toBe(40 * GIB);
    expect(diskOtherAllocated({ ...disk('physical'), usedBytes: null })).toBeNull();
  });
  it('does not replace unknown allocatable space with physical free space', () => {
    expect(
      allocatedSpace({
        ...server,
        storage: { usedBytes: 10, freeBytes: 100, availableBytes: null },
      }),
    ).toBeNull();
    expect(
      allocatedSpace({ ...server, storage: { usedBytes: 10, freeBytes: 100 } }),
    ).toBeUndefined();
    expect(
      allocatedSpace({ ...server, storage: { usedBytes: 10, freeBytes: 100, availableBytes: 0 } }),
    ).toBe(0);
  });
  it('expires cached status and immediately revokes freshness after a failed refresh', () => {
    expect(statusIsFresh(null, false, 100000)).toBe(false);
    expect(statusIsFresh(100000, false, 119999)).toBe(true);
    expect(statusIsFresh(100000, false, 120000)).toBe(false);
    expect(statusIsFresh(100000, true, 100001)).toBe(false);
  });
  it('expires per-service samples without pretending a missing managed-container stat is zero', () => {
    expect(serviceSampleIsFresh(null, 100000)).toBe(false);
    expect(serviceSampleIsFresh('invalid', 100000)).toBe(false);
    expect(serviceSampleIsFresh(new Date(70000).toISOString(), 100000)).toBe(false);
    expect(serviceSampleIsFresh(new Date(99999).toISOString(), 100000)).toBe(true);
    expect(serviceSampleIsFresh(undefined, 100000)).toBe(true);
  });
  it('does not report stale remote telemetry as a new sample just because the helper replied', () => {
    const host = { sampledAt: new Date(70000).toISOString() } as HomeServer['host'];
    expect(telemetryIsFresh({ ...server, host }, true, 100000)).toBe(false);
    expect(resourceSample({ ...server, host }, 100000)).toEqual({
      time: 100000,
      cpu: null,
      memory: null,
      swap: null,
    });
    expect(
      telemetryIsFresh(
        { ...server, host: { ...host!, sampledAt: new Date(100000).toISOString() } },
        false,
        100000,
      ),
    ).toBe(false);
  });
  it('keeps physical disks with their volumes without duplicate capacity rows', () => {
    const ordered = orderDisks([disk('root-volume', 'ssd'), disk('backup'), disk('ssd')]);
    expect(ordered.map((item) => item.id)).toEqual(['backup', 'ssd', 'root-volume']);
    expect(orderDisks([disk('one', 'two'), disk('two', 'one')]).map((item) => item.id)).toEqual([
      'one',
      'two',
    ]);
  });
  it('allows the full disk budget rather than an implicit 20 GB cap', () => {
    expect(quotaRange(server)).toBe(1000);
    expect(
      quotaRange({ ...server, storage: null, settings: { storageLimitBytes: 2000 * GIB } }),
    ).toBe(2000);
  });
  it('does not turn offline or unsupported measurements into healthy zero readings', () => {
    expect(resourceSample({ ...server, online: false }, 10)).toEqual({
      time: 10,
      cpu: null,
      memory: null,
      swap: null,
    });
  });
  it('bounds resource history by both age and count', () => {
    const sample = { time: 1, cpu: 0.1, memory: 0.5, swap: null };
    expect(appendSample([sample], { ...sample, time: 300001 })).toHaveLength(1);
    const history = Array.from({ length: 100 }, (_, index) => ({ ...sample, time: index + 1 }));
    const next = appendSample(history, { ...sample, time: 101 });
    expect(next).toHaveLength(60);
    expect(next.at(-1)?.time).toBe(101);
  });
});
