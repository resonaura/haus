/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { DiscoveryAdvertisementInput } from '@haus/core';

const execFileAsync = promisify(execFile);

export interface ArpNeighborEntry {
  readonly ip: string;
  readonly mac: string;
  readonly interfaceName: string;
}

function isValidLanIp(ip: string): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  return true;
}

function normalizeDiscoveredMac(raw: string): string | undefined {
  const normalized = raw.trim().replaceAll('-', ':').toLowerCase();
  if (!/^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/.test(normalized)) return undefined;
  if (normalized === '00:00:00:00:00:00' || normalized === 'ff:ff:ff:ff:ff:ff') {
    return undefined;
  }
  const firstOctet = Number.parseInt(normalized.slice(0, 2), 16);
  // Skip multicast and locally administered random MAC addresses (mobile privacy MACs).
  if ((firstOctet & 0x01) !== 0 || (firstOctet & 0x02) !== 0) return undefined;
  return normalized;
}

export function parseProcNetArp(raw: string): ArpNeighborEntry[] {
  const lines = raw.split(/\r?\n/).slice(1);
  const entries: ArpNeighborEntry[] = [];
  for (const line of lines) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 6) continue;
    const [ip, , flags, rawMac, , iface] = cols;
    if (!ip || !rawMac || !iface || flags === '0x0') continue;
    if (!isValidLanIp(ip)) continue;
    const mac = normalizeDiscoveredMac(rawMac);
    if (!mac) continue;
    entries.push({ ip, mac, interfaceName: iface });
  }
  return entries;
}

export function parseWindowsArpOutput(raw: string): ArpNeighborEntry[] {
  const entries: ArpNeighborEntry[] = [];
  let currentIface = 'windows-lan';
  for (const line of raw.split(/\r?\n/)) {
    const ifaceMatch = /^Interface:\s+(\d+\.\d+\.\d+\.\d+)/i.exec(line.trim());
    if (ifaceMatch?.[1]) {
      currentIface = `eth-${ifaceMatch[1]}`;
      continue;
    }
    const rowMatch = /^\s*(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f-]{17})\s+(\S+)/i.exec(line);
    if (!rowMatch) continue;
    const [, ip, rawMac, entryType] = rowMatch;
    if (!ip || !rawMac || entryType?.toLowerCase() !== 'dynamic') continue;
    if (!isValidLanIp(ip)) continue;
    const mac = normalizeDiscoveredMac(rawMac);
    if (!mac) continue;
    entries.push({ ip, mac, interfaceName: currentIface });
  }
  return entries;
}

export function parseMacArpOutput(raw: string): ArpNeighborEntry[] {
  const entries: ArpNeighborEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const match = /\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-f:]+)\s+on\s+(\S+)/i.exec(line);
    if (!match) continue;
    const [, ip, rawMac, iface] = match;
    if (!ip || !rawMac || !iface || rawMac === '(incomplete)') continue;
    if (!isValidLanIp(ip)) continue;
    const padded = rawMac
      .split(':')
      .map((part) => (part.length === 1 ? `0${part}` : part))
      .join(':');
    const mac = normalizeDiscoveredMac(padded);
    if (!mac) continue;
    entries.push({ ip, mac, interfaceName: iface });
  }
  return entries;
}

export async function readLanArpNeighbors(arpFile?: string): Promise<ArpNeighborEntry[]> {
  if (arpFile && arpFile !== '/proc/net/arp') {
    try {
      return parseProcNetArp(await readFile(arpFile, 'utf8'));
    } catch {
      return [];
    }
  }
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('arp', ['-a'], { timeout: 3_000 });
      return parseWindowsArpOutput(stdout);
    } catch {
      return [];
    }
  }
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('arp', ['-an'], { timeout: 3_000 });
      return parseMacArpOutput(stdout);
    } catch {
      return [];
    }
  }
  try {
    const content = await readFile(arpFile ?? '/proc/net/arp', 'utf8');
    return parseProcNetArp(content);
  } catch {
    return [];
  }
}

export function buildDhcpNeighborAdvertisement(
  entry: ArpNeighborEntry,
  hostname?: string,
): DiscoveryAdvertisementInput {
  const cleanHost = hostname?.replace(/\.local\.?$/i, '');
  return {
    protocol: 'dhcp',
    mac: entry.mac,
    host: entry.ip,
    addresses: [entry.ip],
    name: cleanHost ?? entry.ip,
    details: {
      macaddress: entry.mac.replaceAll(':', '').toLowerCase(),
      ip: entry.ip,
      ...(cleanHost ? { hostname: cleanHost } : {}),
    },
  };
}
