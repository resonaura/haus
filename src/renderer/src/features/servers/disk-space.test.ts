import { expect, it } from 'vitest';
import { diskSpace } from './disk-space';
import type { ServerDisk } from './types';

const disk: ServerDisk = {
  id: 'disk',
  name: 'SSD',
  kind: 'disk',
  type: 'disk',
  physical: true,
  parentId: null,
  totalBytes: 1000,
  usedBytes: null,
  availableBytes: null,
  filesystem: null,
  mountpoint: null,
  scope: 'host',
};
const item = (id: string, fields: Partial<ServerDisk>): ServerDisk => ({
  ...disk,
  id,
  name: id,
  kind: 'volume',
  type: 'partition',
  physical: false,
  parentId: disk.id,
  ...fields,
});

it('shows a whole device layout before any mount point is selected and navigates real partitions', () => {
  const efi = item('efi', { totalBytes: 100 }),
    root = item('root', { totalBytes: 800 });
  const result = diskSpace(disk, [
    disk,
    efi,
    root,
    item('fs', {
      parentId: root.id,
      type: 'volume',
      totalBytes: 780,
      usedBytes: 600,
      availableBytes: 180,
    }),
  ]);
  expect(result.title).toBe('Partition layout');
  expect(result.segments.map((s) => [s.label, s.bytes, s.targetId])).toEqual([
    ['efi', 100, 'efi'],
    ['root', 800, 'root'],
    ['Other / unreported', 100, undefined],
  ]);
  expect(result.segments.some((s) => s.tone === 'available')).toBe(false);
});
it('uses the measured filesystem below a partition without summing its capacity twice', () => {
  const part = item('part', { totalBytes: 900 });
  const fs = item('fs', {
    type: 'volume',
    parentId: part.id,
    totalBytes: 800,
    usedBytes: 600,
    availableBytes: 150,
  });
  const result = diskSpace(part, [disk, part, fs]);
  expect(result.totalBytes).toBe(800);
  expect(result.segments.map((s) => s.bytes)).toEqual([600, 50, 150]);
  expect(result.note).toContain('Measured filesystem on this partition');
});
it('counts shared pool capacity once and uses volume allocations rather than repeated capacities', () => {
  const pool = item('pool', { type: 'container', totalBytes: 1000, availableBytes: 100 });
  const result = diskSpace(pool, [
    pool,
    item('system', { type: 'volume', parentId: pool.id, totalBytes: 1000, usedBytes: 150 }),
    item('data', { type: 'volume', parentId: pool.id, totalBytes: 1000, usedBytes: 600 }),
  ]);
  expect(result.segments.map((s) => s.bytes)).toEqual([150, 600, 100, 150]);
  expect(result.proportional).toBe(true);
});
it('does not claim that a multi-device mapped volume belongs entirely to each physical parent', () => {
  const mapped = item('raid', {
    type: 'container',
    parentIds: ['disk', 'second'],
    totalBytes: 1800,
  });
  const result = diskSpace(disk, [disk, mapped, { ...mapped }]);
  expect(result.segments[0].bytes).toBeNull();
  expect(result.segments[0].targetId).toBe('raid');
  expect(result.segments.filter((s) => s.targetId === 'raid')).toHaveLength(1);
  expect(result.segments.at(-1)?.tone).toBe('unknown');
});
it('preserves missing usage and rejects contradictory allocations instead of fabricating free space', () => {
  const unknown = diskSpace(item('unmounted', { filesystem: 'ext4' }), []);
  expect(unknown.segments.find((s) => s.id === 'used')?.bytes).toBeNull();
  expect(unknown.segments.find((s) => s.id === 'available')?.bytes).toBeNull();
  expect(unknown.segments.find((s) => s.id === 'other')?.tone).toBe('unknown');
  const inconsistent = diskSpace(disk, [disk, item('large', { totalBytes: 1200 })]);
  expect(inconsistent.proportional).toBe(false);
  expect(inconsistent.segments.some((s) => s.tone === 'available')).toBe(false);
});
