/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { DiscoveryAdvertisementInput } from '@haus/core';

export interface ParsedMdnsSrv {
  readonly priority: number;
  readonly weight: number;
  readonly port: number;
  readonly target: string;
}

export interface ParsedMdnsRecord {
  readonly name: string;
  readonly type: number;
  readonly ttl: number;
  readonly ptrTarget?: string;
  readonly srv?: ParsedMdnsSrv;
  readonly txt?: Readonly<Record<string, string>>;
  readonly address?: string;
}

interface ServiceEntry {
  serviceType: string;
  instanceFqdn: string;
  instanceName: string;
  hostTarget?: string;
  port?: number;
  resolvedAddresses: Set<string>;
  fallbackAddresses: Set<string>;
  txt: Record<string, string>;
  ttl: number;
  updatedAt: number;
}

const DNS_TYPE_A = 1;
const DNS_TYPE_PTR = 12;
const DNS_TYPE_TXT = 16;
const DNS_TYPE_SRV = 33;

export function encodeDnsName(name: string): Buffer {
  const parts = name.replace(/\.+$/, '').split('.').filter(Boolean);
  const buffers: Buffer[] = [];
  for (const part of parts) {
    const label = Buffer.from(part, 'utf8');
    if (label.length === 0 || label.length > 63) continue;
    buffers.push(Buffer.from([label.length]), label);
  }
  buffers.push(Buffer.from([0]));
  return Buffer.concat(buffers);
}

export function buildMdnsPtrQueryPackets(
  serviceTypes: readonly string[],
  unicast = false,
  maxBytes = 1200,
): Buffer[] {
  const unique = Array.from(
    new Set(
      serviceTypes
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .map((s) => (s.endsWith('.') ? s : `${s}.`)),
    ),
  );
  if (unique.length === 0) return [];

  const packets: Buffer[] = [];
  let batch: Buffer[] = [];
  let batchSize = 12;

  const flush = () => {
    if (batch.length === 0) return;
    const header = Buffer.alloc(12);
    header.writeUInt16BE(0, 0);
    header.writeUInt16BE(0, 2);
    header.writeUInt16BE(batch.length, 4);
    packets.push(Buffer.concat([header, ...batch]));
    batch = [];
    batchSize = 12;
  };

  for (const name of unique) {
    const qname = encodeDnsName(name);
    const tail = Buffer.alloc(4);
    tail.writeUInt16BE(DNS_TYPE_PTR, 0);
    tail.writeUInt16BE(unicast ? 0x8001 : 0x0001, 2);
    const q = Buffer.concat([qname, tail]);
    if (batch.length > 0 && batchSize + q.length > maxBytes) {
      flush();
    }
    batch.push(q);
    batchSize += q.length;
  }
  flush();
  return packets;
}

export function readDnsName(buf: Buffer, offset: number): { name: string; nextOffset: number } {
  const labels: string[] = [];
  let pos = offset;
  let nextOffset = -1;
  let jumps = 0;

  while (pos < buf.length && jumps < 32) {
    const len = buf[pos] ?? 0;
    if (len === 0) {
      pos += 1;
      if (nextOffset === -1) nextOffset = pos;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (pos + 1 >= buf.length) break;
      const ptr = ((len & 0x3f) << 8) | (buf[pos + 1] ?? 0);
      if (nextOffset === -1) nextOffset = pos + 2;
      if (ptr >= buf.length) break;
      pos = ptr;
      jumps += 1;
      continue;
    }
    if ((len & 0xc0) !== 0) break;
    pos += 1;
    if (pos + len > buf.length) break;
    labels.push(buf.subarray(pos, pos + len).toString('utf8'));
    pos += len;
  }

  return {
    name: labels.join('.'),
    nextOffset: nextOffset === -1 ? pos : nextOffset,
  };
}

function decodeTxtRdata(rdata: Buffer): Record<string, string> {
  const txt: Record<string, string> = {};
  let idx = 0;
  while (idx < rdata.length) {
    const len = rdata[idx] ?? 0;
    idx += 1;
    if (len === 0 || idx + len > rdata.length) break;
    const raw = rdata.subarray(idx, idx + len).toString('utf8');
    idx += len;
    const eq = raw.indexOf('=');
    if (eq > 0) {
      txt[raw.slice(0, eq).trim()] = raw.slice(eq + 1).trim();
    } else if (raw.trim()) {
      txt[raw.trim()] = 'true';
    }
  }
  return txt;
}

export function parseMdnsPacket(buf: Buffer): ParsedMdnsRecord[] {
  if (buf.length < 12) return [];
  const qdCount = buf.readUInt16BE(4);
  const anCount = buf.readUInt16BE(6);
  const nsCount = buf.readUInt16BE(8);
  const arCount = buf.readUInt16BE(10);

  let offset = 12;
  for (let i = 0; i < qdCount && offset < buf.length; i++) {
    const { nextOffset } = readDnsName(buf, offset);
    if (nextOffset <= offset || nextOffset + 4 > buf.length) return [];
    offset = nextOffset + 4;
  }

  const totalRr = Math.min(anCount + nsCount + arCount, 128);
  const records: ParsedMdnsRecord[] = [];
  for (let i = 0; i < totalRr && offset + 10 <= buf.length; i++) {
    const { name, nextOffset } = readDnsName(buf, offset);
    offset = nextOffset;
    if (offset + 10 > buf.length) break;
    const type = buf.readUInt16BE(offset);
    const ttl = buf.readUInt32BE(offset + 4);
    const rdLength = buf.readUInt16BE(offset + 8);
    const rdataOffset = offset + 10;
    if (rdataOffset + rdLength > buf.length) break;
    const rdata = buf.subarray(rdataOffset, rdataOffset + rdLength);

    if (type === DNS_TYPE_PTR) {
      const { name: ptrTarget } = readDnsName(buf, rdataOffset);
      if (ptrTarget) records.push({ name, type, ttl, ptrTarget });
    } else if (type === DNS_TYPE_SRV && rdata.length >= 6) {
      const { name: target } = readDnsName(buf, rdataOffset + 6);
      records.push({
        name,
        type,
        ttl,
        srv: {
          priority: rdata.readUInt16BE(0),
          weight: rdata.readUInt16BE(2),
          port: rdata.readUInt16BE(4),
          target,
        },
      });
    } else if (type === DNS_TYPE_TXT) {
      records.push({ name, type, ttl, txt: decodeTxtRdata(rdata) });
    } else if (type === DNS_TYPE_A && rdata.length === 4) {
      const address = `${rdata[0]}.${rdata[1]}.${rdata[2]}.${rdata[3]}`;
      records.push({ name, type, ttl, address });
    }

    offset = rdataOffset + rdLength;
  }
  return records;
}

function splitServiceFqdn(fqdn: string): { instanceName: string; serviceType: string } | null {
  const clean = fqdn.replace(/\.+$/, '');
  const match = /^(.+?)\.(_[^.]+\._(?:tcp|udp)\.local)$/i.exec(clean);
  if (!match) return null;
  return {
    instanceName: match[1],
    serviceType: `${match[2].toLowerCase()}.`,
  };
}

export class MdnsDiscoveryAssembler {
  private readonly hostIps = new Map<string, { ips: Set<string>; updatedAt: number }>();
  private readonly services = new Map<string, ServiceEntry>();
  private readonly discoveredServiceTypes = new Set<string>();

  consumePacket(
    packet: Buffer,
    senderAddress?: string,
  ): {
    readonly advertisements: DiscoveryAdvertisementInput[];
    readonly newServiceTypes: string[];
  } {
    const records = parseMdnsPacket(packet);
    if (records.length === 0) return { advertisements: [], newServiceTypes: [] };

    const now = Date.now();
    const touched = new Set<string>();
    const newServiceTypes: string[] = [];

    for (const rec of records) {
      if (rec.address && !rec.address.startsWith('127.')) {
        const hostKey = rec.name.replace(/\.+$/, '').toLowerCase();
        const existing = this.hostIps.get(hostKey) ?? { ips: new Set<string>(), updatedAt: now };
        existing.ips.add(rec.address);
        existing.updatedAt = now;
        this.hostIps.set(hostKey, existing);
      }
    }

    for (const rec of records) {
      if (rec.ptrTarget) {
        const normName = rec.name.replace(/\.+$/, '').toLowerCase();
        if (normName === '_services._dns-sd._udp.local') {
          const st = `${rec.ptrTarget.replace(/\.+$/, '').toLowerCase()}.`;
          if (!this.discoveredServiceTypes.has(st)) {
            this.discoveredServiceTypes.add(st);
            newServiceTypes.push(st);
          }
          continue;
        }
        const split = splitServiceFqdn(rec.ptrTarget);
        if (split) {
          const entry = this.getOrCreateService(
            split.serviceType,
            rec.ptrTarget,
            split.instanceName,
            now,
          );
          if (rec.ttl > 0) entry.ttl = Math.max(rec.ttl, 60);
          touched.add(entry.instanceFqdn.toLowerCase());
        }
      }

      if (rec.srv) {
        const split = splitServiceFqdn(rec.name);
        if (split) {
          const entry = this.getOrCreateService(
            split.serviceType,
            rec.name,
            split.instanceName,
            now,
          );
          entry.port = rec.srv.port;
          entry.hostTarget = rec.srv.target.replace(/\.+$/, '').toLowerCase();
          if (rec.ttl > 0) entry.ttl = Math.max(rec.ttl, 60);
          const resolved = this.hostIps.get(entry.hostTarget);
          if (resolved) {
            for (const ip of resolved.ips) entry.resolvedAddresses.add(ip);
          } else if (
            entry.resolvedAddresses.size === 0 &&
            senderAddress &&
            !senderAddress.startsWith('127.')
          ) {
            entry.fallbackAddresses.add(senderAddress);
          }
          touched.add(entry.instanceFqdn.toLowerCase());
        }
      }

      if (rec.txt) {
        const split = splitServiceFqdn(rec.name);
        if (split) {
          const entry = this.getOrCreateService(
            split.serviceType,
            rec.name,
            split.instanceName,
            now,
          );
          Object.assign(entry.txt, rec.txt);
          if (entry.hostTarget) {
            const resolved = this.hostIps.get(entry.hostTarget);
            if (resolved) {
              for (const ip of resolved.ips) entry.resolvedAddresses.add(ip);
            }
          }
          touched.add(entry.instanceFqdn.toLowerCase());
        }
      }

      if (rec.address) {
        const hostKey = rec.name.replace(/\.+$/, '').toLowerCase();
        for (const entry of this.services.values()) {
          if (entry.hostTarget === hostKey) {
            entry.resolvedAddresses.add(rec.address);
            touched.add(entry.instanceFqdn.toLowerCase());
          }
        }
      }
    }

    const advertisements: DiscoveryAdvertisementInput[] = [];
    for (const key of touched) {
      const entry = this.services.get(key);
      if (!entry) continue;
      if (entry.port === undefined && entry.resolvedAddresses.size === 0) continue;
      const hasResolved = entry.resolvedAddresses.size > 0;
      const addresses = hasResolved
        ? Array.from(entry.resolvedAddresses)
        : Array.from(entry.fallbackAddresses);
      if (addresses.length === 0) continue;
      const macCandidate =
        entry.txt.mac ?? entry.txt.macaddress ?? entry.txt.MAC ?? entry.txt.id ?? undefined;
      advertisements.push({
        protocol: 'zeroconf',
        name: entry.instanceName,
        host: addresses[0],
        addresses,
        port: entry.port,
        mac: macCandidate,
        ttlMs: Math.max(entry.ttl * 1000, 120_000),
        details: {
          ...entry.txt,
          serviceType: entry.serviceType,
          hostname: entry.hostTarget,
          instanceFqdn: entry.instanceFqdn,
          addressSource: hasResolved ? 'resolved' : 'fallback',
          rawTxt: { ...entry.txt },
        },
      });
    }

    this.prune(now);
    return { advertisements, newServiceTypes };
  }

  getHostAddresses(hostOrName: string): readonly string[] {
    const clean = hostOrName.replace(/\.+$/, '').toLowerCase();
    const record = this.hostIps.get(clean);
    return record ? Array.from(record.ips) : [];
  }

  findHostnameForIp(ip: string): string | undefined {
    for (const [host, entry] of this.hostIps.entries()) {
      if (entry.ips.has(ip)) return host;
    }
    return undefined;
  }

  private getOrCreateService(
    serviceType: string,
    fqdn: string,
    instanceName: string,
    now: number,
  ): ServiceEntry {
    const key = fqdn.replace(/\.+$/, '').toLowerCase();
    const existing = this.services.get(key);
    if (existing) {
      existing.updatedAt = now;
      return existing;
    }
    const created: ServiceEntry = {
      serviceType,
      instanceFqdn: fqdn.replace(/\.+$/, ''),
      instanceName,
      resolvedAddresses: new Set<string>(),
      fallbackAddresses: new Set<string>(),
      txt: {},
      ttl: 120,
      updatedAt: now,
    };
    this.services.set(key, created);
    return created;
  }

  private prune(now: number): void {
    if (this.services.size <= 500 && this.hostIps.size <= 500) return;
    const cutoff = now - 15 * 60_000;
    for (const [key, entry] of this.services.entries()) {
      if (entry.updatedAt < cutoff) this.services.delete(key);
    }
    for (const [key, entry] of this.hostIps.entries()) {
      if (entry.updatedAt < cutoff) this.hostIps.delete(key);
    }
  }
}
