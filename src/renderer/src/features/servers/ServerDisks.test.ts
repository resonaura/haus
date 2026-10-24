import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ServerDisks } from './ServerDisks';
import { diskDisplayName } from './presentation';
import type { ServerDisk } from './types';

const partition: ServerDisk = {
  id: 'efi',
  name: 'EFI System Partition',
  type: 'partition',
  kind: 'volume',
  physical: false,
  partitionRole: 'efi',
  partitionNumber: 1,
  parentId: 'ssd',
  filesystem: 'FAT32',
  mountpoint: null,
  totalBytes: 100 * 1024 ** 2,
  usedBytes: 32 * 1024 ** 2,
  availableBytes: 68 * 1024 ** 2,
  readOnly: false,
  scope: 'host',
};
it('shows EFI purpose, measured FAT32 usage and absent drive letter without inventing a mount', () => {
  const html = renderToStaticMarkup(createElement(ServerDisks, { disks: [partition] }));
  expect(html).toContain('EFI System Partition');
  expect(html).toContain('FAT32');
  expect(html).toContain('32 MB');
  expect(html).toContain('68 MB');
  expect(html).toContain('No drive letter');
  expect(html).toContain('<dt>Partition</dt><dd>1</dd>');
  expect(html).not.toContain('Not mounted');
});
it('shows the HA reported device, role and all mount aliases without adding repeated volumes', () => {
  const html = renderToStaticMarkup(
    createElement(ServerDisks, {
      disks: [
        {
          ...partition,
          id: 'ha-overlay',
          name: 'hassos-overlay',
          partitionRole: 'overlay',
          filesystem: 'ext4',
          device: '/dev/mmcblk0p7',
          partitionNumber: 7,
          mountpoint: '/mnt/overlay',
          mountpoints: ['/mnt/overlay', '/etc/hostname'],
          usedBytes: null,
          availableBytes: null,
        },
      ],
    }),
  );
  expect(html).toContain('System overlay');
  expect(html).toContain('/dev/mmcblk0p7');
  expect(html).toContain('/mnt/overlay · /etc/hostname');
  expect(html).toContain('Unavailable');
  expect(html).not.toContain('0 B');
});
it('keeps an unmounted Ubuntu EFI partition distinct from a Windows volume without a drive letter', () => {
  const html = renderToStaticMarkup(
    createElement(ServerDisks, {
      disks: [{ ...partition, device: '/dev/sdc1', mountpoint: null }],
    }),
  );
  expect(html).toContain('Not mounted');
  expect(html).not.toContain('No drive letter');
  expect(html).toContain('Device access');
});
it('canonicalizes only the confirmed MSR partition while retaining unrelated user labels', () => {
  const reserved = {
    ...partition,
    name: 'Microsoft reserved partition',
    partitionRole: 'reserved' as const,
  };
  const html = renderToStaticMarkup(createElement(ServerDisks, { disks: [reserved] }));
  expect(html).toContain('Microsoft Reserved Partition');
  expect(html).not.toContain('Microsoft reserved partition');
  expect(diskDisplayName({ ...reserved, partitionRole: undefined })).toBe(
    'Microsoft reserved partition',
  );
  expect(diskDisplayName({ ...partition, name: 'My Data', partitionRole: 'data' })).toBe('My Data');
});
