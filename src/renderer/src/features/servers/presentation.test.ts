import { describe, expect, it } from 'vitest';
import {
  appendSample,
  bytes,
  GIB,
  orderDisks,
  quotaRange,
  ratio,
  resourceSample,
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
