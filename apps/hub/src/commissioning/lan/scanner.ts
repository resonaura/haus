/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { existsSync, readFileSync } from 'node:fs';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { DiscoveredCandidate, DiscoveryAdvertisementInput } from '@haus/core';
import { HomeKitControllerService } from '../../homekit/service.js';
import { MqttService } from '../../mqtt/service.js';
import {
  assessWslEnvironment,
  parseProcNetRouteDefaultGateway,
  type WslAssessmentOptions,
} from '../../runtime/wsl.js';
import { CommissioningService } from '../service.js';
import { LanProtocolProbe } from './probe.js';
import { scanUsbDevices } from './usb.js';

export { parseProcNetRouteDefaultGateway };

const PERIODIC_SCAN_INTERVAL_MS = 5 * 60_000;
const INITIAL_SCAN_DELAY_MS = 1_200;
const DEFAULT_RELAY_PORT = 8791;
const VALID_DISCOVERY_PROTOCOLS = new Set([
  'zeroconf',
  'ssdp',
  'dhcp',
  'mqtt',
  'homekit',
  'bluetooth',
  'usb',
]);

function readSecretFromFile(filePath: string | undefined): string | undefined {
  const cleanPath = filePath?.trim();
  if (!cleanPath) return undefined;
  try {
    if (!existsSync(cleanPath)) return undefined;
    const token = readFileSync(cleanPath, 'utf8').trim();
    return token.length > 0 ? token : undefined;
  } catch {
    return undefined;
  }
}

export interface LanRelayConfig {
  readonly url: string;
  readonly token?: string;
  readonly autoProbed?: boolean;
}

export function resolveRelayConfig(
  env: NodeJS.ProcessEnv = process.env,
  wslProbe?: WslAssessmentOptions,
): LanRelayConfig | undefined {
  const rawUrl = env.HAUS_LAN_RELAY_URL?.trim();
  if (rawUrl && ['none', 'off', 'false', '0'].includes(rawUrl.toLowerCase())) {
    return undefined;
  }

  let resolvedUrl: string | undefined;
  let autoProbed = false;
  if (!rawUrl) {
    const assessment = assessWslEnvironment({ env, ...wslProbe });
    if (assessment.isWsl && assessment.networkingMode === 'nat' && assessment.recommendedRelayUrl) {
      resolvedUrl = assessment.recommendedRelayUrl;
      autoProbed = true;
    } else {
      return undefined;
    }
  } else {
    const lowered = rawUrl.toLowerCase();
    if (lowered === 'auto' || lowered === 'wsl-gateway') {
      const routeFile = env.HAUS_PROC_ROUTE_FILE?.trim() || '/proc/net/route';
      const routeRaw = readSecretFromFile(routeFile);
      const gatewayIp = routeRaw ? parseProcNetRouteDefaultGateway(routeRaw) : undefined;
      if (gatewayIp) {
        const rawPort = Number.parseInt(env.HAUS_LAN_RELAY_PORT ?? '', 10);
        const port =
          Number.isInteger(rawPort) && rawPort > 0 && rawPort <= 65535
            ? rawPort
            : DEFAULT_RELAY_PORT;
        resolvedUrl = `http://${gatewayIp}:${port}`;
      }
    } else {
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          resolvedUrl = parsed.toString().replace(/\/+$/, '');
        }
      } catch {
        return undefined;
      }
    }
  }

  if (!resolvedUrl) return undefined;
  const token =
    env.HAUS_LAN_RELAY_TOKEN?.trim() ||
    readSecretFromFile(env.HAUS_LAN_RELAY_TOKEN_FILE) ||
    readSecretFromFile(env.HAUS_API_TOKEN_FILE);
  return { url: resolvedUrl, token, ...(autoProbed ? { autoProbed: true } : {}) };
}

function isValidAdvertisementInput(raw: unknown): raw is DiscoveryAdvertisementInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const protocol = (raw as { protocol?: unknown }).protocol;
  return typeof protocol === 'string' && VALID_DISCOVERY_PROTOCOLS.has(protocol);
}

@Injectable()
export class LanDiscoveryService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(LanDiscoveryService.name);
  private readonly probe: LanProtocolProbe;
  private mqttUnsubscribe?: () => void;
  private startupTimer?: NodeJS.Timeout;
  private periodicTimer?: NodeJS.Timeout;
  private inFlightScan?: Promise<readonly DiscoveredCandidate[]>;
  private stopped = false;
  private warnedAutoRelay = false;

  constructor(
    private readonly commissioning: CommissioningService,
    @Optional() @Inject(MqttService) private readonly mqttService?: MqttService,
    @Optional()
    @Inject(HomeKitControllerService)
    private readonly homekit?: HomeKitControllerService,
  ) {
    this.probe = new LanProtocolProbe({
      shouldFollowMdnsType: (serviceType) =>
        this.commissioning.matchesAdvertisement({
          protocol: 'zeroconf',
          details: { serviceType },
        }),
      onAdvertisement: (adv) => {
        this.ingestIfMatched(adv);
      },
      onWarn: (message) => {
        this.logger.warn(message);
      },
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.isAutoStartDisabled()) return;
    await this.commissioning.restorePersistedDiscoveryState();
    await this.startPassiveListeners();
    this.startupTimer = setTimeout(() => {
      void this.scan({ timeoutMs: 2_200 }).catch(() => undefined);
    }, INITIAL_SCAN_DELAY_MS);
    this.startupTimer.unref();
    this.periodicTimer = setInterval(() => {
      void this.scan({ timeoutMs: 1_800 }).catch(() => undefined);
    }, PERIODIC_SCAN_INTERVAL_MS);
    this.periodicTimer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = undefined;
    }
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = undefined;
    }
    this.mqttUnsubscribe?.();
    this.mqttUnsubscribe = undefined;
    await this.probe.stop();
  }

  private isAutoStartDisabled(): boolean {
    if (process.env.HAUS_DISABLE_LAN_DISCOVERY === 'true') return true;
    return Boolean(process.env.VITEST) || process.env.NODE_ENV === 'test';
  }

  async scan(options?: { readonly timeoutMs?: number }): Promise<readonly DiscoveredCandidate[]> {
    if (this.inFlightScan) return this.inFlightScan;
    const rawTimeout = options?.timeoutMs ?? 1_800;
    const timeoutMs = Math.max(300, Math.min(rawTimeout, 5_000));
    this.inFlightScan = this.executeScan(timeoutMs).finally(() => {
      this.inFlightScan = undefined;
    });
    return this.inFlightScan;
  }

  ingestIfMatched(input: DiscoveryAdvertisementInput): DiscoveredCandidate | undefined {
    if (!this.commissioning.matchesAdvertisement(input)) return undefined;
    return this.commissioning.ingestDiscovery(input);
  }

  handleMdnsDatagram(msg: Buffer, senderAddress?: string): readonly DiscoveredCandidate[] {
    const advertisements = this.probe.handleMdnsDatagram(msg, senderAddress, false);
    const ingested: DiscoveredCandidate[] = [];
    for (const adv of advertisements) {
      const candidate = this.ingestIfMatched(adv);
      if (candidate) ingested.push(candidate);
    }
    return ingested;
  }

  async handleSsdpDatagram(
    raw: string,
    remoteAddress: string,
  ): Promise<DiscoveredCandidate | undefined> {
    const adv = await this.probe.handleSsdpDatagram(raw, remoteAddress, false);
    if (!adv) return undefined;
    return this.ingestIfMatched(adv);
  }

  handleMqttMessage(topic: string, payload: string): DiscoveredCandidate | undefined {
    const lower = topic.toLowerCase();
    if (lower.startsWith('homeassistant/') || lower.startsWith('haus/')) return undefined;
    let parsed: Record<string, unknown> | undefined;
    if (payload.trim().startsWith('{')) {
      try {
        const json = JSON.parse(payload);
        if (json && typeof json === 'object' && !Array.isArray(json)) {
          parsed = json as Record<string, unknown>;
        }
      } catch {
        // Non-JSON payloads still match topic patterns cleanly.
      }
    }
    const host =
      typeof parsed?.ip === 'string'
        ? parsed.ip
        : typeof parsed?.host === 'string'
          ? parsed.host
          : undefined;
    const mac =
      typeof parsed?.mac === 'string'
        ? parsed.mac
        : typeof parsed?.macaddress === 'string'
          ? parsed.macaddress
          : undefined;
    const name =
      typeof parsed?.dn === 'string'
        ? parsed.dn
        : typeof parsed?.DeviceName === 'string'
          ? parsed.DeviceName
          : typeof parsed?.name === 'string'
            ? parsed.name
            : typeof parsed?.hn === 'string'
              ? parsed.hn
              : undefined;
    return this.ingestIfMatched({
      protocol: 'mqtt',
      mqttTopic: topic,
      host,
      mac,
      name,
      details: {
        ...parsed,
        topic,
      },
    });
  }

  collectCatalogZeroconfTypes(): string[] {
    const types = new Set<string>(['_services._dns-sd._udp.local.']);
    for (const rule of this.commissioning.getMatcherRules()) {
      for (const z of rule.zeroconf ?? []) {
        const raw = typeof z === 'string' ? z : z.type;
        if (!raw || raw.includes('*')) continue;
        const clean = raw.trim().toLowerCase();
        if (clean.startsWith('_')) {
          types.add(
            clean.endsWith('.')
              ? clean
              : clean.endsWith('.local')
                ? `${clean}.`
                : `${clean}.local.`,
          );
        }
      }
    }
    return Array.from(types);
  }

  collectCatalogSsdpTargets(): string[] {
    const targets = new Set<string>(['ssdp:all', 'upnp:rootdevice']);
    for (const rule of this.commissioning.getMatcherRules()) {
      for (const s of rule.ssdp ?? []) {
        for (const [key, value] of Object.entries(s)) {
          const lowerKey = key.toLowerCase();
          if (lowerKey !== 'st' && lowerKey !== 'nt') continue;
          if (typeof value !== 'string') continue;
          const clean = value.trim();
          if (clean && !clean.includes('*') && clean !== 'upnp:rootdevice') {
            targets.add(clean);
          }
        }
      }
    }
    return Array.from(targets);
  }

  private async startPassiveListeners(): Promise<void> {
    await this.probe.startListeners();
    if (!this.mqttUnsubscribe && this.mqttService?.broker) {
      const listener = (msg: { topic: string; payload: string }) => {
        this.handleMqttMessage(msg.topic, msg.payload);
      };
      this.mqttService.broker.on('message', listener);
      this.mqttUnsubscribe = () => {
        this.mqttService?.broker.off('message', listener);
      };
    }
  }

  private async fetchRelayScan(
    timeoutMs: number,
    serviceTypes: readonly string[],
    ssdpTargets: readonly string[],
  ): Promise<void> {
    const relay = resolveRelayConfig();
    if (!relay) return;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (relay.token) {
      headers.authorization = `Bearer ${relay.token}`;
    }
    try {
      const res = await fetch(`${relay.url}/scan`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ timeoutMs, serviceTypes, ssdpTargets }),
        signal: AbortSignal.timeout(Math.min(timeoutMs + 2_500, 8_000)),
      });
      if (!res.ok) {
        if (!relay.autoProbed || !this.warnedAutoRelay) {
          this.logger.warn(`LAN discovery relay ${relay.url} returned HTTP ${res.status}`);
          if (relay.autoProbed) this.warnedAutoRelay = true;
        }
        return;
      }
      this.warnedAutoRelay = false;
      const data = (await res.json()) as { advertisements?: unknown };
      if (!Array.isArray(data?.advertisements)) return;
      for (const item of data.advertisements) {
        if (isValidAdvertisementInput(item)) {
          this.ingestIfMatched(item);
        }
      }
    } catch (err) {
      if (relay.autoProbed) {
        if (!this.warnedAutoRelay) {
          this.warnedAutoRelay = true;
          this.logger.warn(
            `WSL2 NAT detected without a reachable Windows LAN relay (${relay.url}). Enable networkingMode=mirrored in .wslconfig or start scripts/lan-relay.ts on Windows to discover LAN devices.`,
          );
        }
      } else {
        this.logger.warn(`LAN discovery relay ${relay.url} unreachable: ${String(err)}`);
      }
    }
  }

  private async executeScan(timeoutMs: number): Promise<readonly DiscoveredCandidate[]> {
    if (this.stopped) {
      return this.commissioning.listDiscoveries({ status: 'discovered' });
    }
    await this.commissioning.restorePersistedDiscoveryState();
    await this.startPassiveListeners();

    const serviceTypes = this.collectCatalogZeroconfTypes();
    const ssdpTargets = this.collectCatalogSsdpTargets();
    const localProbe = this.probe.scan({
      timeoutMs,
      serviceTypes,
      ssdpTargets,
      includeNeighbors: true,
    });
    const relaySweep = this.fetchRelayScan(timeoutMs, serviceTypes, ssdpTargets);
    const usbSweep = scanUsbDevices()
      .then((items) => {
        for (const adv of items) {
          this.ingestIfMatched(adv);
        }
      })
      .catch(() => undefined);

    const homekitSweep =
      this.homekit && typeof this.homekit.discoverAccessories === 'function'
        ? this.homekit
            .discoverAccessories(Math.min(timeoutMs, 2_000))
            .then((items) => {
              for (const acc of items) {
                this.ingestIfMatched({
                  protocol: 'zeroconf',
                  name: acc.name,
                  host: acc.address,
                  addresses: acc.address ? [acc.address] : undefined,
                  port: acc.port,
                  mac: acc.id,
                  details: {
                    serviceType: '_hap._tcp.local.',
                    id: acc.id,
                    md: acc.model,
                    model: acc.model,
                    sf: acc.paired ? '0' : '1',
                    ci: String(acc.category),
                    paired: acc.paired,
                    pairingAvailable: !acc.paired,
                  },
                });
              }
            })
            .catch(() => undefined)
        : Promise.resolve();

    await Promise.allSettled([localProbe, relaySweep, homekitSweep, usbSweep]);
    await this.commissioning.reconcileConfigured();
    return this.commissioning.listDiscoveries({ status: 'discovered' });
  }
}
