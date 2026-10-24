import { expect, it } from 'vitest';
import { storageMediaLabel } from './DiskIcon';
import type { ServerDisk } from './types';
const disk = { name: 'USB SSD Flash SD' } as ServerDisk;
it('describes only reported media and transport and leaves ambiguous USB solid state honest', () => {
  expect(storageMediaLabel(disk)).toBeUndefined();
  expect(storageMediaLabel({ ...disk, transport: 'usb' })).toBe('USB');
  expect(storageMediaLabel({ ...disk, transport: 'usb', mediaKind: 'hdd' })).toBe('USB · HDD');
  expect(storageMediaLabel({ ...disk, transport: 'usb', mediaKind: 'solid-state' })).toBe(
    'USB · Solid-state storage',
  );
  expect(storageMediaLabel({ ...disk, transport: 'sdio', mediaKind: 'sd' })).toBe('SDIO · SD card');
});
