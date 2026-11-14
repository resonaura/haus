/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import { reverse as dnsReverse } from 'node:dns/promises';
import { networkInterfaces } from 'node:os';
import type { DiscoveryAdvertisementInput } from '@haus/core';
import { buildMdnsPtrQueryPackets, MdnsDiscoveryAssembler } from './dns.js';
import { buildDhcpNeighborAdvertisement, readLanArpNeighbors } from './neighbors.js';
import {
  buildSsdpAdvertisement,
  buildSsdpSearchPayload,
  parseSsdpHeaders,
  SsdpDescriptionCache,
} from './ssdp.js';

export const MDNS_MULTICAST_ADDR = '224.0.0.251';
export const MDNS_PORT = 5353;
export const SSDP_MULTICAST_ADDR = '239.255.255.250';
export const SSDP_PORT = 1900;

const DEFAULT_EXCLUDED_INTERFACES = ['vethernet', 'wsl', 'docker', 'veth', 'br-', 'vmware', 'vbox'];

export function listPrivateLanIpv4Interfaces(
  excludePatterns: readonly string[] = DEFAULT_EXCLUDED_INTERFACES,
): string[] {
  const ips = new Set<string>();
  const lowered = excludePatterns.map((p) => p.toLowerCase());
  for (const [ifaceName, list] of Object.entries(networkInterfaces())) {
    const cleanName = ifaceName.toLowerCase();
    if (lowered.some((pattern) => cleanName.includes(pattern))) continue;
    for (const info of list ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      if (info.address.startsWith('127.') || info.address.startsWith('169.254.')) continue;
      ips.add(info.address);
    }
  }
  return Array.from(ips);
}

function tryJoinMulticast(socket: Socket, group: string, localIps: readonly string[]): void {
  if (localIps.length === 0) {
    try {
      socket.addMembership(group);
    } catch {
      // Best-effort join when interfaces are restricted.
    }
    return;
  }
  for (const ip of localIps) {
    try {
      socket.addMembership(group, ip);
    } catch {
      // Ignore interface-specific multicast join errors (e.g. virtual bridges).
    }
  }
}

export async function resolveReverseDnsHostname(
  ip: string,
  timeoutMs = 350,
  reverseFn: (ip: string) => Promise<string[]> = dnsReverse,
): Promise<string | undefined> {
  try {
    const names = await Promise.race([
      reverseFn(ip),
      new Promise<string[]>((resolve) => {
        const timer = setTimeout(() => resolve([]), timeoutMs);
        timer.unref();
      }),
    ]);
    const raw = names[0]?.trim().replace(/\.+$/, '');
    return raw && raw !== ip ? raw : undefined;
  } catch {
    return undefined;
  }
}

export interface LanProtocolProbeOptions {
  readonly shouldFollowMdnsType?: (serviceType: string) => boolean;
  readonly onAdvertisement?: (adv: DiscoveryAdvertisementInput) => void;
  readonly onWarn?: (message: string) => void;
  readonly reverseLookup?: (ip: string) => Promise<string | undefined>;
}

export interface LanProtocolScanOptions {
  readonly serviceTypes?: readonly string[];
  readonly ssdpTargets?: readonly string[];
  readonly timeoutMs?: number;
  readonly includeNeighbors?: boolean;
  readonly resolveReverseDns?: boolean;
}

/**
 * Pure Node.js mDNS, SSDP, and ARP protocol probe shared between Hub runtime
 * and host-side LAN discovery relays.
 */
export class LanProtocolProbe {
  private readonly dnsAssembler = new MdnsDiscoveryAssembler();
  private readonly ssdpDescriptions = new SsdpDescriptionCache();
  private readonly pendingSsdpTasks = new Set<Promise<void>>();
  private readonly activeScanRecorders = new Set<(adv: DiscoveryAdvertisementInput) => void>();
  private mdnsSocket?: Socket;
  private mdnsQuerySocket?: Socket;
  private ssdpSocket?: Socket;
  private ssdpQuerySocket?: Socket;
  private localIps: string[] = [];
  private stopped = false;

  constructor(private readonly options: LanProtocolProbeOptions = {}) {}

  private handleRawSsdpMessage(msg: Buffer, rinfo: RemoteInfo): void {
    const task = this.handleSsdpDatagram(msg.toString('utf8'), rinfo.address)
      .then(() => undefined)
      .catch(() => undefined);
    this.pendingSsdpTasks.add(task);
    void task.finally(() => {
      this.pendingSsdpTasks.delete(task);
    });
  }

  async startListeners(): Promise<void> {
    this.stopped = false;
    this.localIps = listPrivateLanIpv4Interfaces();
    const onMdns = (msg: Buffer, rinfo: RemoteInfo) => {
      this.handleMdnsDatagram(msg, rinfo.address);
    };
    const onSsdp = (msg: Buffer, rinfo: RemoteInfo) => {
      this.handleRawSsdpMessage(msg, rinfo);
    };
    if (!this.mdnsSocket) {
      this.mdnsSocket = await this.openUdpSocket(MDNS_PORT, MDNS_MULTICAST_ADDR, onMdns);
    }
    if (!this.mdnsQuerySocket) {
      this.mdnsQuerySocket = await this.openUdpSocket(0, undefined, onMdns);
    }
    if (!this.ssdpSocket) {
      this.ssdpSocket = await this.openUdpSocket(SSDP_PORT, SSDP_MULTICAST_ADDR, onSsdp);
    }
    if (!this.ssdpQuerySocket) {
      this.ssdpQuerySocket = await this.openUdpSocket(0, undefined, onSsdp);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const closeOne = (sock?: Socket) =>
      sock
        ? new Promise<void>((resolve) => {
            try {
              sock.close(() => resolve());
            } catch {
              resolve();
            }
          })
        : Promise.resolve();
    await Promise.all([
      closeOne(this.mdnsSocket),
      closeOne(this.mdnsQuerySocket),
      closeOne(this.ssdpSocket),
      closeOne(this.ssdpQuerySocket),
    ]);
    this.mdnsSocket = undefined;
    this.mdnsQuerySocket = undefined;
    this.ssdpSocket = undefined;
    this.ssdpQuerySocket = undefined;
  }

  findHostnameForIp(ip: string): string | undefined {
    return this.dnsAssembler.findHostnameForIp(ip);
  }

  private emitAdvertisement(adv: DiscoveryAdvertisementInput): void {
    this.options.onAdvertisement?.(adv);
    for (const recorder of this.activeScanRecorders) {
      recorder(adv);
    }
  }

  handleMdnsDatagram(
    msg: Buffer,
    senderAddress?: string,
    emit = true,
  ): readonly DiscoveryAdvertisementInput[] {
    const { advertisements, newServiceTypes } = this.dnsAssembler.consumePacket(msg, senderAddress);
    if (newServiceTypes.length > 0 && this.mdnsSocket) {
      const follow = this.options.shouldFollowMdnsType;
      const interesting = follow ? newServiceTypes.filter(follow) : newServiceTypes;
      if (interesting.length > 0) {
        this.sendMdnsQueries(this.mdnsSocket, interesting, true);
      }
    }
    if (emit) {
      for (const adv of advertisements) {
        this.emitAdvertisement(adv);
      }
    }
    return advertisements;
  }

  async handleSsdpDatagram(
    raw: string,
    remoteAddress: string,
    emit = true,
  ): Promise<DiscoveryAdvertisementInput | undefined> {
    const headers = parseSsdpHeaders(raw);
    if (!headers || headers.nts === 'ssdp:byebye') return undefined;
    const description = headers.location
      ? await this.ssdpDescriptions.resolve(headers.location)
      : undefined;
    const adv = buildSsdpAdvertisement(headers, remoteAddress, description);
    if (!adv) return undefined;
    if (emit) {
      this.emitAdvertisement(adv);
    }
    return adv;
  }

  async scan(options: LanProtocolScanOptions = {}): Promise<DiscoveryAdvertisementInput[]> {
    if (this.stopped) return [];
    await this.startListeners();
    this.localIps = listPrivateLanIpv4Interfaces();

    const collected: DiscoveryAdvertisementInput[] = [];
    const seen = new Set<string>();
    const record = (adv: DiscoveryAdvertisementInput) => {
      const key = `${adv.protocol}:${adv.host ?? ''}:${adv.port ?? ''}:${adv.mac ?? ''}:${adv.name ?? ''}:${String(adv.details?.serviceType ?? adv.details?.usn ?? '')}`;
      if (seen.has(key)) return;
      seen.add(key);
      collected.push(adv);
    };

    const rawTimeout = options.timeoutMs ?? 1_800;
    const timeoutMs = Math.max(300, Math.min(rawTimeout, 5_000));
    const serviceTypes =
      options.serviceTypes && options.serviceTypes.length > 0
        ? options.serviceTypes
        : ['_services._dns-sd._udp.local.'];

    this.activeScanRecorders.add(record);

    try {
      if (this.mdnsSocket) {
        this.sendMdnsQueries(this.mdnsSocket, serviceTypes, false);
      }
      const mdnsQueryTarget = this.mdnsQuerySocket ?? this.mdnsSocket;
      if (mdnsQueryTarget) {
        this.sendMdnsQueries(mdnsQueryTarget, serviceTypes, true);
      }
      const ssdpQueryTarget = this.ssdpQuerySocket ?? this.ssdpSocket;
      if (ssdpQueryTarget) {
        this.sendSsdpSearch(ssdpQueryTarget, options.ssdpTargets);
      }

      const waitTimer = new Promise<void>((resolve) => {
        const t = setTimeout(resolve, timeoutMs);
        t.unref();
      });

      const neighborSweep =
        options.includeNeighbors !== false
          ? readLanArpNeighbors()
              .then(async (neighbors) => {
                const lookupFn =
                  this.options.reverseLookup ?? ((ip: string) => resolveReverseDnsHostname(ip));
                await Promise.all(
                  neighbors.map(async (entry) => {
                    let hostname = this.dnsAssembler.findHostnameForIp(entry.ip);
                    if (!hostname && options.resolveReverseDns !== false) {
                      hostname = await lookupFn(entry.ip);
                    }
                    this.emitAdvertisement(buildDhcpNeighborAdvertisement(entry, hostname));
                  }),
                );
              })
              .catch(() => undefined)
          : Promise.resolve();

      await Promise.allSettled([waitTimer, neighborSweep]);
      if (this.pendingSsdpTasks.size > 0) {
        await Promise.race([
          Promise.allSettled(this.pendingSsdpTasks),
          new Promise<void>((resolve) => {
            const t = setTimeout(resolve, 600);
            t.unref();
          }),
        ]);
      }
      return collected;
    } finally {
      this.activeScanRecorders.delete(record);
    }
  }

  private async openUdpSocket(
    port: number,
    multicastGroup: string | undefined,
    onMessage: (msg: Buffer, rinfo: RemoteInfo) => void,
  ): Promise<Socket | undefined> {
    const createBound = async (bindPort: number): Promise<Socket> => {
      const sock = createSocket({ type: 'udp4', reuseAddr: bindPort !== 0 });
      sock.on('error', () => {
        // Ignore transient network interface errors so caller never crashes on socket faults.
      });
      sock.on('message', (msg, rinfo) => {
        if (rinfo.address.startsWith('127.')) return;
        onMessage(msg, rinfo);
      });
      await new Promise<void>((resolve, reject) => {
        const onErr = (err: Error) => {
          sock.off('listening', onListen);
          reject(err);
        };
        const onListen = () => {
          sock.off('error', onErr);
          try {
            sock.setMulticastTTL(255);
            sock.setMulticastLoopback(false);
          } catch {
            // Optional socket flags.
          }
          if (multicastGroup) {
            tryJoinMulticast(sock, multicastGroup, this.localIps);
          }
          resolve();
        };
        sock.once('error', onErr);
        sock.once('listening', onListen);
        sock.bind(bindPort);
      });
      return sock;
    };

    try {
      return await createBound(port);
    } catch {
      try {
        return await createBound(0);
      } catch (err) {
        this.options.onWarn?.(
          `Could not open UDP discovery socket on port ${port}: ${String(err)}`,
        );
        return undefined;
      }
    }
  }

  private sendOnInterfaces(socket: Socket, packet: Buffer, port: number, group: string): void {
    const targets = this.localIps.length > 0 ? this.localIps : [''];
    for (const ifaceIp of targets) {
      try {
        if (ifaceIp) socket.setMulticastInterface(ifaceIp);
      } catch {
        // Best-effort interface selection.
      }
      try {
        socket.send(packet, 0, packet.length, port, group);
      } catch {
        // Ignore transient send errors when interface changes.
      }
    }
  }

  private sendMdnsQueries(socket: Socket, serviceTypes: readonly string[], unicast: boolean): void {
    const packets = buildMdnsPtrQueryPackets(serviceTypes, unicast);
    for (const pkt of packets) {
      this.sendOnInterfaces(socket, pkt, MDNS_PORT, MDNS_MULTICAST_ADDR);
    }
  }

  private sendSsdpSearch(socket: Socket, extraTargets?: readonly string[]): void {
    const targets = new Set<string>(['ssdp:all', 'upnp:rootdevice']);
    for (const raw of extraTargets ?? []) {
      const clean = raw.trim();
      if (clean && !clean.includes('*')) {
        targets.add(clean);
      }
    }
    for (const st of targets) {
      const payload = buildSsdpSearchPayload(st, 2);
      this.sendOnInterfaces(socket, payload, SSDP_PORT, SSDP_MULTICAST_ADDR);
    }
  }
}
