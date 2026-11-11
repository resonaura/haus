/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { createHash } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { HomeKitCategory } from '../types.js';
import type { DiscoveredHomeKitAccessory } from '../client.js';

export interface DiscoveredHomeKitWithHash extends DiscoveredHomeKitAccessory {
  readonly setupHash?: string;
}

function encodeDnsName(name: string): Buffer {
  const parts = name.replace(/\.$/, '').split('.').filter(Boolean);
  const buffers: Buffer[] = [];
  for (const part of parts) {
    const b = Buffer.from(part, 'utf8');
    buffers.push(Buffer.from([b.length]), b);
  }
  buffers.push(Buffer.from([0]));
  return Buffer.concat(buffers);
}

function buildDnsQuery(
  questions: ReadonlyArray<{ name: string; type: number; unicast?: boolean }>,
): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0); // ID
  header.writeUInt16BE(0, 2); // Flags
  header.writeUInt16BE(questions.length, 4); // QDCOUNT
  const qBuffers: Buffer[] = [header];
  for (const q of questions) {
    const qname = encodeDnsName(q.name);
    const tail = Buffer.alloc(4);
    tail.writeUInt16BE(q.type, 0);
    tail.writeUInt16BE(q.unicast ? 0x8001 : 0x0001, 2);
    qBuffers.push(qname, tail);
  }
  return Buffer.concat(qBuffers);
}

function readDnsName(buf: Buffer, offset: number): { name: string; nextOffset: number } {
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
      pos = ptr;
      jumps += 1;
      continue;
    }
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

interface ParsedMdnsRecord {
  name: string;
  type: number;
  rdata: Buffer;
  rdataOffset: number;
}

function parseDnsPacket(buf: Buffer): ParsedMdnsRecord[] {
  if (buf.length < 12) return [];
  const qdCount = buf.readUInt16BE(4);
  const anCount = buf.readUInt16BE(6);
  const nsCount = buf.readUInt16BE(8);
  const arCount = buf.readUInt16BE(10);

  let offset = 12;
  for (let i = 0; i < qdCount && offset < buf.length; i++) {
    const { nextOffset } = readDnsName(buf, offset);
    offset = nextOffset + 4;
  }

  const totalRr = anCount + nsCount + arCount;
  const records: ParsedMdnsRecord[] = [];
  for (let i = 0; i < totalRr && offset + 10 <= buf.length; i++) {
    const { name, nextOffset } = readDnsName(buf, offset);
    offset = nextOffset;
    if (offset + 10 > buf.length) break;
    const type = buf.readUInt16BE(offset);
    const rdLength = buf.readUInt16BE(offset + 8);
    const rdataOffset = offset + 10;
    if (rdataOffset + rdLength > buf.length) break;
    records.push({
      name,
      type,
      rdata: buf.subarray(rdataOffset, rdataOffset + rdLength),
      rdataOffset,
    });
    offset = rdataOffset + rdLength;
  }
  return records;
}

function collectCandidateSubnetPrefixes(): string[] {
  const prefixes = new Set<string>();
  const addIp = (ip?: string) => {
    if (!ip) return;
    const m = ip.match(/^(\d+\.\d+\.\d+)\.\d+$/);
    if (m && !m[1].startsWith('127.') && !m[1].startsWith('172.17.')) {
      prefixes.add(m[1]);
    }
  };

  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal) {
        addIp(info.address);
      }
    }
  }

  for (const envVar of [
    process.env.HAUS_HUB_URL,
    process.env.HAUS_MATTER_URL,
    process.env.HAUS_TUYA_URL,
    process.env.HAUS_AQARA_OUTDOOR_RTSP,
  ]) {
    if (!envVar) continue;
    const m = envVar.match(/(\d+\.\d+\.\d+\.\d+)/);
    if (m) addIp(m[1]);
  }

  // If 192.168.4 or 192.168.5 is present, include both adjacent /24s (common dual-subnet mesh layout)
  if (prefixes.has('192.168.4') || prefixes.has('192.168.5')) {
    prefixes.add('192.168.4');
    prefixes.add('192.168.5');
  }

  return Array.from(prefixes);
}

export function computeHomeKitSetupHash(setupId: string, accessoryId: string): string {
  return createHash('sha512')
    .update(setupId.toUpperCase() + accessoryId.toUpperCase())
    .digest()
    .subarray(0, 4)
    .toString('base64');
}

/**
 * Performs both multicast (224.0.0.251:5353) and unicast UDP-5353 DNS-SD queries
 * so `_hap._tcp.local` accessories are discovered reliably even inside Docker/WSL2
 * or across Wi-Fi mesh subnets that drop multicast mDNS.
 */
export async function sweepHomeKitMdns(timeoutMs = 2200): Promise<DiscoveredHomeKitWithHash[]> {
  return new Promise((resolve) => {
    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    const partials = new Map<
      string,
      {
        instanceName?: string;
        address: string;
        port?: number;
        txt: Record<string, string>;
      }
    >();

    const ptrQuery = buildDnsQuery([
      { name: '_hap._tcp.local', type: 12, unicast: true },
      { name: '_hap._tcp.local', type: 12, unicast: false },
    ]);

    socket.on('message', (msg, rinfo) => {
      if (!/^\d+\.\d+\.\d+\.\d+$/.test(rinfo.address) || rinfo.address.startsWith('127.')) {
        return;
      }
      const records = parseDnsPacket(msg);
      let newlySeenInstance: string | undefined;

      for (const rec of records) {
        if (rec.type === 12 && rec.name.toLowerCase() === '_hap._tcp.local') {
          const { name: ptrTarget } = readDnsName(msg, rec.rdataOffset);
          if (ptrTarget) {
            const key = `${rinfo.address}:${ptrTarget}`;
            if (!partials.has(key)) {
              partials.set(key, {
                instanceName: ptrTarget.replace(/\._hap\._tcp\.local$/i, ''),
                address: rinfo.address,
                txt: {},
              });
              newlySeenInstance = ptrTarget;
            }
          }
        }
      }

      for (const rec of records) {
        if (!rec.name.toLowerCase().endsWith('._hap._tcp.local')) continue;
        const instanceName = rec.name.replace(/\._hap\._tcp\.local$/i, '');
        const key = `${rinfo.address}:${rec.name}`;
        let entry = partials.get(key);
        if (!entry) {
          entry = { instanceName, address: rinfo.address, txt: {} };
          partials.set(key, entry);
        }

        if (rec.type === 33 && rec.rdata.length >= 6) {
          // SRV
          entry.port = rec.rdata.readUInt16BE(4);
        } else if (rec.type === 16) {
          // TXT
          let pos = 0;
          while (pos < rec.rdata.length) {
            const len = rec.rdata[pos] ?? 0;
            pos += 1;
            if (pos + len > rec.rdata.length) break;
            const kv = rec.rdata.subarray(pos, pos + len).toString('utf8');
            pos += len;
            const eq = kv.indexOf('=');
            if (eq > 0) {
              entry.txt[kv.slice(0, eq).toLowerCase()] = kv.slice(eq + 1);
            }
          }
        }
      }

      if (newlySeenInstance) {
        const followUp = buildDnsQuery([
          { name: newlySeenInstance, type: 255, unicast: true },
          { name: newlySeenInstance, type: 33, unicast: true },
          { name: newlySeenInstance, type: 16, unicast: true },
        ]);
        socket.send(followUp, 5353, rinfo.address);
      }
    });

    socket.on('error', () => {
      // ignore socket errors
    });

    socket.bind(0, () => {
      socket.send(ptrQuery, 5353, '224.0.0.251');
      const prefixes = collectCandidateSubnetPrefixes();
      for (const prefix of prefixes) {
        for (let host = 1; host <= 254; host++) {
          socket.send(ptrQuery, 5353, `${prefix}.${host}`);
        }
      }
    });

    setTimeout(() => {
      try {
        socket.close();
      } catch {
        // ignore
      }
      const results = new Map<string, DiscoveredHomeKitWithHash>();
      for (const p of partials.values()) {
        const id = (p.txt.id ?? '').toUpperCase();
        if (!id || !p.port) continue;
        const sf = parseInt(p.txt.sf ?? '1', 10);
        const ci = parseInt(p.txt.ci ?? '1', 10);
        const cNum = parseInt(p.txt['c#'] ?? '1', 10);
        results.set(id, {
          id,
          name: p.instanceName || p.txt.md || id,
          model: p.txt.md,
          address: p.address,
          port: p.port,
          category: (Number.isFinite(ci) ? ci : HomeKitCategory.OTHER) as HomeKitCategory,
          paired: sf === 0,
          configNumber: Number.isFinite(cNum) ? cNum : 1,
          setupHash: p.txt.sh,
        });
      }
      resolve(Array.from(results.values()));
    }, timeoutMs);
  });
}
