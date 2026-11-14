/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LanProtocolProbe,
  listPrivateLanIpv4Interfaces,
} from '../apps/hub/src/commissioning/lan/probe.js';
import { scanUsbDevices } from '../apps/hub/src/commissioning/lan/usb.js';

type DiscoveryAdvertisementInput = Awaited<ReturnType<LanProtocolProbe['scan']>>[number];

const DEFAULT_HUB_URL = 'http://127.0.0.1:8790';
const DEFAULT_RELAY_PORT = 8791;
const SERVICE_TYPES_REFRESH_MS = 5 * 60_000;
const PERIODIC_SWEEP_MS = 90_000;
const WSL_BIND_REFRESH_MS = 15_000;
const QUEUE_FLUSH_DELAY_MS = 2_000;
const MAX_BODY_BYTES = 32 * 1024;
const FALLBACK_SERVICE_TYPES = [
  '_services._dns-sd._udp.local.',
  '_hap._tcp.local.',
  '_matter._tcp.local.',
  '_esphomelib._tcp.local.',
  '_hue._tcp.local.',
  '_googlecast._tcp.local.',
  '_airplay._tcp.local.',
];

function readSecret(envVar: string, fileEnvVar: string): string | undefined {
  const inline = process.env[envVar]?.trim();
  if (inline) return inline;
  const filePath = process.env[fileEnvVar]?.trim();
  if (!filePath || !existsSync(filePath)) return undefined;
  try {
    const content = readFileSync(filePath, 'utf8').trim();
    return content.length > 0 ? content : undefined;
  } catch {
    return undefined;
  }
}

function isAuthorizedToken(header: string | undefined, expected: string | undefined): boolean {
  if (!expected || !header) return false;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const presented = match?.[1]?.trim();
  if (!presented) return false;
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function listRelayBindHosts(): string[] {
  const explicit = process.env.HAUS_RELAY_HOSTS?.trim();
  if (explicit) {
    return Array.from(
      new Set(
        explicit
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );
  }
  const hosts = new Set<string>(['127.0.0.1']);
  for (const [ifaceName, entries] of Object.entries(networkInterfaces())) {
    const lower = ifaceName.toLowerCase();
    if (!lower.includes('vethernet') && !lower.includes('wsl')) continue;
    for (const info of entries ?? []) {
      if (info.family === 'IPv4' && !info.internal) {
        hosts.add(info.address);
      }
    }
  }
  return Array.from(hosts);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error('payload_too_large');
    }
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  const parsed: unknown = JSON.parse(text);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function advDedupeKey(adv: DiscoveryAdvertisementInput): string {
  const st = typeof adv.details?.serviceType === 'string' ? adv.details.serviceType : '';
  const usn = typeof adv.details?.usn === 'string' ? adv.details.usn : '';
  return `${adv.protocol}:${adv.host ?? ''}:${adv.port ?? ''}:${adv.mac ?? ''}:${adv.uuid ?? ''}:${adv.name ?? ''}:${st || usn}`;
}

export class LanRelayRunner {
  private readonly hubUrl: string;
  private readonly port: number;
  private readonly queue = new Map<string, DiscoveryAdvertisementInput>();
  private readonly servers = new Map<string, Server>();
  private readonly probe: LanProtocolProbe;
  private serviceTypes: string[] = [...FALLBACK_SERVICE_TYPES];
  private serviceTypeSet = new Set(FALLBACK_SERVICE_TYPES.map((t) => t.toLowerCase()));
  private ssdpTargets: string[] = ['ssdp:all', 'upnp:rootdevice'];
  private flushTimer?: NodeJS.Timeout;
  private refreshTimer?: NodeJS.Timeout;
  private sweepTimer?: NodeJS.Timeout;
  private bindTimer?: NodeJS.Timeout;
  private flushing = false;
  private stopped = false;

  constructor() {
    this.hubUrl = (process.env.HAUS_HUB_URL?.trim() || DEFAULT_HUB_URL).replace(/\/+$/, '');
    const parsedPort = Number.parseInt(process.env.HAUS_RELAY_PORT ?? '', 10);
    this.port =
      Number.isInteger(parsedPort) && parsedPort >= 0 && parsedPort <= 65535
        ? parsedPort
        : DEFAULT_RELAY_PORT;
    this.probe = new LanProtocolProbe({
      shouldFollowMdnsType: (st) => this.serviceTypeSet.has(st.toLowerCase()),
      onAdvertisement: (adv) => {
        this.enqueue(adv);
      },
      onWarn: (message) => {
        console.warn(`[lan-relay] ${message}`);
      },
    });
  }

  private getToken(): string | undefined {
    return readSecret('HAUS_RELAY_TOKEN', 'HAUS_RELAY_TOKEN_FILE');
  }

  private enqueue(adv: DiscoveryAdvertisementInput): void {
    if (this.stopped) return;
    this.queue.set(advDedupeKey(adv), adv);
    if (this.queue.size >= 50) {
      void this.flushQueue();
      return;
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = undefined;
        void this.flushQueue();
      }, QUEUE_FLUSH_DELAY_MS);
      this.flushTimer.unref();
    }
  }

  private async refreshServiceTypes(): Promise<void> {
    const token = this.getToken();
    if (!token) return;
    try {
      const res = await fetch(`${this.hubUrl}/api/commissioning/discoveries/service-types`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(4_000),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { serviceTypes?: unknown; ssdpTargets?: unknown };
      if (Array.isArray(data?.serviceTypes)) {
        const valid = data.serviceTypes.filter(
          (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
        );
        if (valid.length > 0) {
          this.serviceTypes = valid;
          this.serviceTypeSet = new Set(valid.map((item) => item.toLowerCase()));
        }
      }
      if (Array.isArray(data?.ssdpTargets)) {
        const validSsdp = data.ssdpTargets.filter(
          (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
        );
        if (validSsdp.length > 0) {
          this.ssdpTargets = validSsdp;
        }
      }
    } catch {
      // Hub may still be starting; keep fallback/cached service types.
    }
  }

  private async flushQueue(): Promise<void> {
    if (this.stopped || this.flushing || this.queue.size === 0) return;
    const token = this.getToken();
    if (!token) {
      this.queue.clear();
      return;
    }
    this.flushing = true;
    try {
      while (this.queue.size > 0 && !this.stopped) {
        const items = Array.from(this.queue.values()).slice(0, 200);
        for (const item of items) {
          this.queue.delete(advDedupeKey(item));
        }
        const res = await fetch(
          `${this.hubUrl}/api/commissioning/discoveries/announcements/batch`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ advertisements: items, matchedOnly: true }),
            signal: AbortSignal.timeout(5_000),
          },
        );
        if (!res.ok) {
          console.warn(`[lan-relay] Hub batch ingest returned HTTP ${res.status}`);
          break;
        }
        const summary = (await res.json()) as { matched?: number };
        if (typeof summary.matched === 'number' && summary.matched > 0) {
          console.log(
            `[lan-relay] Pushed ${items.length} advertisements (${summary.matched} matched) to Hub`,
          );
        }
      }
    } catch {
      // Hub may be restarting; passive/periodic sweeps will repopulate.
    } finally {
      this.flushing = false;
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;

    if (method === 'GET' && pathname === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        interfaces: listPrivateLanIpv4Interfaces(),
        bindHosts: Array.from(this.servers.keys()),
      });
      return;
    }

    if (method !== 'POST' || pathname !== '/scan') {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }

    const token = this.getToken();
    if (!token) {
      sendJson(res, 503, { error: 'relay_token_unconfigured' });
      return;
    }
    if (!isAuthorizedToken(req.headers.authorization, token)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }

    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      const code = String(err).includes('payload_too_large') ? 413 : 400;
      sendJson(res, code, { error: 'invalid_json_body' });
      return;
    }

    const timeoutMs =
      typeof body.timeoutMs === 'number' && Number.isFinite(body.timeoutMs)
        ? Math.max(300, Math.min(body.timeoutMs, 5_000))
        : 2_000;
    const requestedTypes = Array.isArray(body.serviceTypes)
      ? body.serviceTypes.filter(
          (item): item is string => typeof item === 'string' && item.trim().length > 0,
        )
      : undefined;
    const requestedSsdp = Array.isArray(body.ssdpTargets)
      ? body.ssdpTargets.filter(
          (item): item is string => typeof item === 'string' && item.trim().length > 0,
        )
      : undefined;
    if (requestedSsdp && requestedSsdp.length > 0) {
      this.ssdpTargets = requestedSsdp;
    }
    if (requestedTypes && requestedTypes.length > 0) {
      this.serviceTypes = requestedTypes;
      this.serviceTypeSet = new Set(requestedTypes.map((item) => item.toLowerCase()));
    } else if (this.serviceTypes.length <= FALLBACK_SERVICE_TYPES.length) {
      await this.refreshServiceTypes();
    }

    const [probeAdvs, usbAdvs] = await Promise.all([
      this.probe.scan({
        timeoutMs,
        serviceTypes:
          requestedTypes && requestedTypes.length > 0 ? requestedTypes : this.serviceTypes,
        ssdpTargets: requestedSsdp && requestedSsdp.length > 0 ? requestedSsdp : this.ssdpTargets,
        includeNeighbors: true,
      }),
      scanUsbDevices(),
    ]);
    const advertisements = [...probeAdvs, ...usbAdvs];
    sendJson(res, 200, {
      scannedAt: new Date().toISOString(),
      interfaceIps: listPrivateLanIpv4Interfaces(),
      advertisements,
    });
  }

  private async reconcileHttpListeners(): Promise<void> {
    const desired = new Set(listRelayBindHosts());
    for (const [host, srv] of this.servers.entries()) {
      if (desired.has(host)) continue;
      await new Promise<void>((resolve) => srv.close(() => resolve()));
      this.servers.delete(host);
    }
    for (const host of desired) {
      if (this.servers.has(host)) continue;
      const srv = createServer((req, res) => {
        void this.handleRequest(req, res).catch((err) => {
          if (!res.headersSent) sendJson(res, 500, { error: String(err) });
        });
      });
      await new Promise<void>((resolve) => {
        const onError = (err: Error) => {
          console.warn(`[lan-relay] Failed to listen on ${host}:${this.port}: ${err.message}`);
          srv.close(() => resolve());
        };
        srv.once('error', onError);
        srv.listen(this.port, host, () => {
          srv.off('error', onError);
          this.servers.set(host, srv);
          const address = srv.address();
          const listeningPort = typeof address === 'object' && address ? address.port : this.port;
          console.log(`[lan-relay] Listening on http://${host}:${listeningPort}`);
          resolve();
        });
      });
    }
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.probe.startListeners();
    await this.reconcileHttpListeners();
    await this.refreshServiceTypes();

    this.bindTimer = setInterval(() => {
      void this.reconcileHttpListeners().catch(() => undefined);
    }, WSL_BIND_REFRESH_MS);
    this.bindTimer.unref();

    this.refreshTimer = setInterval(() => {
      void this.refreshServiceTypes().catch(() => undefined);
    }, SERVICE_TYPES_REFRESH_MS);
    this.refreshTimer.unref();

    const runSweep = async () => {
      await this.refreshServiceTypes();
      const [, usbAdvs] = await Promise.all([
        this.probe.scan({
          timeoutMs: 2_000,
          serviceTypes: this.serviceTypes,
          ssdpTargets: this.ssdpTargets,
          includeNeighbors: true,
        }),
        scanUsbDevices(),
      ]);
      for (const adv of usbAdvs) {
        this.enqueue(adv);
      }
      await this.flushQueue();
    };

    setTimeout(() => {
      void runSweep().catch(() => undefined);
    }, 1_500).unref();

    this.sweepTimer = setInterval(() => {
      void runSweep().catch(() => undefined);
    }, PERIODIC_SWEEP_MS);
    this.sweepTimer.unref();
  }

  getBoundAddresses(): Array<{ host: string; port: number }> {
    const out: Array<{ host: string; port: number }> = [];
    for (const [host, srv] of this.servers.entries()) {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        out.push({ host, port: addr.port });
      }
    }
    return out;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of [this.flushTimer, this.refreshTimer, this.sweepTimer, this.bindTimer]) {
      if (timer) clearTimeout(timer);
    }
    this.flushTimer = undefined;
    this.refreshTimer = undefined;
    this.sweepTimer = undefined;
    this.bindTimer = undefined;
    await this.probe.stop();
    await Promise.all(
      Array.from(this.servers.values()).map(
        (srv) => new Promise<void>((resolve) => srv.close(() => resolve())),
      ),
    );
    this.servers.clear();
  }
}

const isEntrypoint =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  const runner = new LanRelayRunner();
  const shutdown = () => {
    void runner.stop().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await runner.start();
}
