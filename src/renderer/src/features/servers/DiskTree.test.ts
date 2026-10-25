import { expect, it } from 'vitest';
import { visibleDisks, diskTreeSubtitle } from './DiskTree';
import type { ServerDisk } from './types';
const item = (id: string, parentId: string | null): ServerDisk => ({
  id,
  name: id,
  kind: 'volume',
  parentId,
  mountpoint: null,
  filesystem: null,
  totalBytes: null,
  usedBytes: null,
  availableBytes: null,
  scope: 'host',
});
it('folds each branch independently and retains later roots and nested fold state after refresh', () => {
  const disks = [
    item('disk', null),
    item('part', 'disk'),
    item('fs', 'part'),
    item('usb', null),
    item('usb-data', 'usb'),
  ];
  expect(visibleDisks(disks, new Set(['disk'])).map((d) => d.id)).toEqual([
    'disk',
    'usb',
    'usb-data',
  ]);
  expect(
    visibleDisks(
      disks.map((d) => ({ ...d })),
      new Set(['part']),
    ).map((d) => d.id),
  ).toEqual(['disk', 'part', 'usb', 'usb-data']);
  expect(visibleDisks(disks, new Set(['disk', 'part', 'usb'])).map((d) => d.id)).toEqual([
    'disk',
    'usb',
  ]);
});
it('bounds malformed parent cycles without losing unrelated devices', () => {
  expect(
    visibleDisks([item('a', 'b'), item('b', 'a'), item('disk', null)], new Set()).map((d) => d.id),
  ).toEqual(['disk', 'a', 'b']);
});
it('avoids repeating canonical partition names as subtitles while retaining the exact formal title', () => {
  const reserved = {
    ...item('reserved', null),
    name: 'Microsoft reserved partition',
    type: 'partition' as const,
    partitionRole: 'reserved' as const,
    partitionNumber: 2,
  };
  expect(diskTreeSubtitle(reserved)).toBe('Partition 2');
  expect(
    diskTreeSubtitle({
      ...reserved,
      name: 'EFI system partition',
      partitionRole: 'efi',
      partitionNumber: 1,
      filesystem: 'vfat',
    }),
  ).toBe('Partition 1 · vfat');
});
