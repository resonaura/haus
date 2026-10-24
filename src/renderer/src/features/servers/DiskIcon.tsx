import { CardSim, Columns3, Database, Disc3, HardDrive, Layers, Usb } from 'lucide-react';
import type { ServerDisk } from './types';

export function storageMediaLabel(disk: ServerDisk) {
  const kind = disk.mediaKind
    ? {
        hdd: 'HDD',
        ssd: 'SSD',
        'solid-state': 'Solid-state storage',
        flash: 'Flash drive',
        sd: 'SD card',
        mmc: 'MMC storage',
        optical: 'Optical media',
      }[disk.mediaKind]
    : undefined;
  const bus = disk.transport
    ? {
        usb: 'USB',
        sata: 'SATA',
        ata: 'ATA',
        nvme: 'NVMe',
        sas: 'SAS',
        scsi: 'SCSI',
        mmc: 'MMC',
        sdio: 'SDIO',
        sd: 'SD',
        thunderbolt: 'Thunderbolt',
        'apple-fabric': 'Apple Fabric',
        ieee1394: 'FireWire',
        fc: 'Fibre Channel',
        fcoe: 'FCoE',
      }[disk.transport]
    : undefined;
  return [bus, kind].filter(Boolean).join(' · ') || undefined;
}
export function DiskIcon({ disk, size = 20 }: { disk: ServerDisk; size?: number }) {
  const Icon =
    disk.type === 'partition'
      ? Columns3
      : disk.type === 'container'
        ? Layers
        : disk.type === 'volume' || (disk.kind === 'volume' && !disk.type)
          ? Database
          : disk.mediaKind === 'sd' || disk.mediaKind === 'mmc'
            ? CardSim
            : disk.mediaKind === 'optical'
              ? Disc3
              : disk.mediaKind === 'flash' || (!disk.mediaKind && disk.transport === 'usb')
                ? Usb
                : HardDrive;
  return <Icon size={size} aria-hidden="true" />;
}
