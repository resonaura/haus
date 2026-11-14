/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { DiscoveryAdvertisementInput } from '@haus/core';

const execFileAsync = promisify(execFile);

const LINUX_ROOT_HUB_VID = '1D6B';

export interface UsbDeviceInfo {
  readonly device: string;
  readonly vid: string;
  readonly pid: string;
  readonly serialNumber?: string;
  readonly manufacturer?: string;
  readonly description?: string;
}

export function normalizeUsbHexId(raw: string | number | undefined): string | undefined {
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw < 0 || raw > 0xffff) return undefined;
    return raw.toString(16).toUpperCase().padStart(4, '0');
  }
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('0x')) {
    const parsed = Number.parseInt(trimmed.slice(2), 16);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 0xffff) return undefined;
    return parsed.toString(16).toUpperCase().padStart(4, '0');
  }
  if (/^[0-9a-f]{1,4}$/.test(trimmed) && /[a-f]/.test(trimmed)) {
    return trimmed.toUpperCase().padStart(4, '0');
  }
  if (/^[0-9]{1,5}$/.test(trimmed) && trimmed.length !== 4) {
    const asDec = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(asDec) && asDec >= 0 && asDec <= 0xffff) {
      return asDec.toString(16).toUpperCase().padStart(4, '0');
    }
  }
  if (/^[0-9a-f]{4}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  return undefined;
}

function isVirtualRootHub(vid: string, description?: string, manufacturer?: string): boolean {
  if (vid === LINUX_ROOT_HUB_VID) return true;
  const desc = description?.toLowerCase() ?? '';
  const mfg = manufacturer?.toLowerCase() ?? '';
  return desc.includes('root hub') && (mfg.includes('linux') || !mfg);
}

export interface LinuxSysfsUsbFields {
  readonly idVendor?: string;
  readonly idProduct?: string;
  readonly serial?: string;
  readonly manufacturer?: string;
  readonly product?: string;
  readonly devicePath?: string;
}

export function parseLinuxSysfsUsbDevice(fields: LinuxSysfsUsbFields): UsbDeviceInfo | null {
  const vid = normalizeUsbHexId(fields.idVendor);
  const pid = normalizeUsbHexId(fields.idProduct);
  if (!vid || !pid) return null;
  const manufacturer = fields.manufacturer?.trim() || undefined;
  const description = fields.product?.trim() || undefined;
  if (isVirtualRootHub(vid, description, manufacturer)) return null;
  const serialNumber = fields.serial?.trim() || undefined;
  const device = fields.devicePath?.trim() || `/dev/bus/usb/${vid}:${pid}`;
  return {
    device,
    vid,
    pid,
    ...(serialNumber ? { serialNumber } : {}),
    ...(manufacturer ? { manufacturer } : {}),
    ...(description ? { description } : {}),
  };
}

function parseIoregScalar(block: string, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const re = new RegExp(`"${key}"\\s*=\\s*(?:"([^"]*)"|(0x[0-9a-fA-F]+|\\d+))`);
    const match = re.exec(block);
    const val = match?.[1] ?? match?.[2];
    if (val !== undefined && val.trim().length > 0) return val.trim();
  }
  return undefined;
}

export function parseMacIoregUsbOutput(raw: string): UsbDeviceInfo[] {
  const results: UsbDeviceInfo[] = [];
  const seen = new Set<string>();
  const blocks = raw.split(/\+-o\s+/);

  for (const block of blocks) {
    if (!block.includes('"idVendor"') || !block.includes('"idProduct"')) continue;
    const rawVid = parseIoregScalar(block, ['idVendor']);
    const rawPid = parseIoregScalar(block, ['idProduct']);
    const vid = normalizeUsbHexId(
      rawVid && /^\d+$/.test(rawVid) ? Number.parseInt(rawVid, 10) : rawVid,
    );
    const pid = normalizeUsbHexId(
      rawPid && /^\d+$/.test(rawPid) ? Number.parseInt(rawPid, 10) : rawPid,
    );
    if (!vid || !pid) continue;

    const manufacturer = parseIoregScalar(block, ['USB Vendor Name', 'kUSBVendorString']);
    const description = parseIoregScalar(block, ['USB Product Name', 'kUSBProductString']);
    if (isVirtualRootHub(vid, description, manufacturer)) continue;

    const serialNumber = parseIoregScalar(block, ['USB Serial Number', 'kUSBSerialNumberString']);
    const locationId = parseIoregScalar(block, ['locationID']);
    const device =
      parseIoregScalar(block, ['IODialinDevice', 'IOCalloutDevice']) ??
      `usb://${vid}:${pid}/${serialNumber ?? locationId ?? results.length}`;

    const dedupeKey = `${vid}:${pid}:${serialNumber ?? device}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    results.push({
      device,
      vid,
      pid,
      ...(serialNumber ? { serialNumber } : {}),
      ...(manufacturer ? { manufacturer } : {}),
      ...(description ? { description } : {}),
    });
  }
  return results;
}

export function buildUsbAdvertisement(info: UsbDeviceInfo): DiscoveryAdvertisementInput {
  const name =
    [info.manufacturer, info.description].filter(Boolean).join(' ').trim() ||
    `${info.vid}:${info.pid}`;
  return {
    protocol: 'usb',
    name,
    uuid: `usb:${info.vid}:${info.pid}:${info.serialNumber ?? info.device}`,
    usb: {
      vid: info.vid,
      pid: info.pid,
      ...(info.serialNumber ? { serialNumber: info.serialNumber } : {}),
      ...(info.manufacturer ? { manufacturer: info.manufacturer } : {}),
      ...(info.description ? { description: info.description } : {}),
    },
    details: {
      device: info.device,
      vid: info.vid,
      pid: info.pid,
      ...(info.serialNumber ? { serialNumber: info.serialNumber } : {}),
      ...(info.manufacturer ? { manufacturer: info.manufacturer } : {}),
      ...(info.description ? { description: info.description } : {}),
    },
  };
}

async function readOptionalTrimmed(path: string): Promise<string | undefined> {
  try {
    const content = await readFile(path, 'utf8');
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

async function resolveLinuxTtyPath(deviceDir: string): Promise<string | undefined> {
  try {
    const entries = await readdir(deviceDir);
    for (const entry of entries) {
      if (entry.startsWith('tty')) {
        return `/dev/${entry}`;
      }
      const subTty = join(deviceDir, entry, 'tty');
      if (existsSync(subTty)) {
        const subEntries = await readdir(subTty);
        if (subEntries[0]) return `/dev/${subEntries[0]}`;
      }
    }
  } catch {
    // Ignore sysfs read errors on disappearing USB nodes.
  }
  return undefined;
}

export async function scanLinuxSysfsUsb(
  sysfsRoot = '/sys/bus/usb/devices',
): Promise<UsbDeviceInfo[]> {
  if (!existsSync(sysfsRoot)) return [];
  let entries: string[];
  try {
    entries = await readdir(sysfsRoot);
  } catch {
    return [];
  }

  const devices: UsbDeviceInfo[] = [];
  for (const name of entries) {
    if (name.includes(':')) continue;
    const dir = join(sysfsRoot, name);
    const [idVendor, idProduct, serial, manufacturer, product, ttyPath] = await Promise.all([
      readOptionalTrimmed(join(dir, 'idVendor')),
      readOptionalTrimmed(join(dir, 'idProduct')),
      readOptionalTrimmed(join(dir, 'serial')),
      readOptionalTrimmed(join(dir, 'manufacturer')),
      readOptionalTrimmed(join(dir, 'product')),
      resolveLinuxTtyPath(dir),
    ]);
    const parsed = parseLinuxSysfsUsbDevice({
      idVendor,
      idProduct,
      serial,
      manufacturer,
      product,
      devicePath: ttyPath ?? `/dev/bus/usb/${name}`,
    });
    if (parsed) devices.push(parsed);
  }
  return devices;
}

export async function scanUsbDevices(): Promise<DiscoveryAdvertisementInput[]> {
  try {
    let devices: UsbDeviceInfo[] = [];
    if (process.platform === 'linux') {
      devices = await scanLinuxSysfsUsb();
    } else if (process.platform === 'darwin') {
      const { stdout } = await execFileAsync('ioreg', ['-p', 'IOUSB', '-l', '-w', '0'], {
        timeout: 2_500,
        maxBuffer: 2 * 1024 * 1024,
      });
      devices = parseMacIoregUsbOutput(stdout);
    }
    return devices.map(buildUsbAdvertisement);
  } catch {
    return [];
  }
}
