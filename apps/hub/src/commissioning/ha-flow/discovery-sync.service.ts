/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  Inject,
  Injectable,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  matchAllDiscoveryRules,
  type DiscoveredCandidate,
  type DiscoveryAdvertisementInput,
} from '@haus/core';
import type { MqttMessage } from '@haus/mqtt';
import { MqttService } from '../../mqtt/service.js';
import { mergeDiscoveryTxtDetails } from '../entry-helpers.js';
import { CommissioningService } from '../service.js';
import { HaFlowBridgeService } from './bridge.service.js';

const DISCOVERY_COOLDOWN_MS = 10 * 60_000;

function mqttTopicMatches(pattern: string, topic: string): boolean {
  if (pattern === topic || pattern === '#') return true;
  const pParts = pattern.split('/');
  const tParts = topic.split('/');
  for (let i = 0; i < pParts.length; i += 1) {
    const p = pParts[i];
    if (p === '#') return true;
    if (p !== '+' && p !== tParts[i]) return false;
  }
  return pParts.length === tParts.length;
}

function asStringRecord(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return { ...(raw as Record<string, unknown>) };
}

function buildProtocolDiscoveryInfo(
  protocol: string,
  input: DiscoveryAdvertisementInput,
  candidate: DiscoveredCandidate,
): Record<string, unknown> {
  const details = input.details ?? {};
  const primaryIp = input.addresses?.[0] ?? candidate.addresses[0] ?? input.host;
  if (protocol === 'zeroconf' || protocol === 'homekit') {
    const props = asStringRecord(details.properties ?? details.txt);
    for (const [k, v] of Object.entries(details)) {
      if (
        k !== 'txt' &&
        k !== 'properties' &&
        k !== 'serviceType' &&
        k !== 'type' &&
        k !== 'addresses' &&
        (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
      ) {
        if (!(k in props)) props[k] = String(v);
      }
    }
    const rawAddresses = Array.isArray(details.addresses)
      ? details.addresses.map(String)
      : input.addresses && input.addresses.length > 0
        ? [...input.addresses]
        : [...candidate.addresses];
    return {
      ipAddress: rawAddresses[0] ?? primaryIp,
      ipAddresses: rawAddresses,
      port:
        input.port ??
        candidate.port ??
        (typeof details.port === 'number' ? details.port : undefined),
      type:
        typeof details.serviceType === 'string'
          ? details.serviceType
          : typeof details.type === 'string'
            ? details.type
            : protocol === 'homekit'
              ? '_hap._tcp.local.'
              : '_http._tcp.local.',
      name: input.name ?? candidate.name ?? details.name ?? candidate.id,
      hostname:
        typeof details.hostname === 'string'
          ? details.hostname
          : typeof details.host === 'string'
            ? details.host
            : (input.host ?? primaryIp ?? input.name ?? candidate.name),
      properties: props,
    };
  }

  if (protocol === 'ssdp') {
    const location =
      typeof details.ssdpLocation === 'string'
        ? details.ssdpLocation
        : typeof details.location === 'string'
          ? details.location
          : primaryIp
            ? `http://${primaryIp}:${input.port ?? 80}/description.xml`
            : undefined;
    return {
      ssdpLocation: location,
      ssdpSt: details.ssdpSt ?? details.st ?? 'upnp:rootdevice',
      ssdpUsn: details.ssdpUsn ?? details.usn ?? input.uuid ?? candidate.id,
      ssdpNt: details.ssdpNt ?? details.nt,
      ssdpUdn: details.ssdpUdn ?? details.udn ?? input.uuid,
      ssdpExt: details.ssdpExt ?? details.ext,
      ssdpServer: details.ssdpServer ?? details.server,
      ssdpHeaders: details.ssdpHeaders ?? details.headers ?? {},
      ssdpAllLocations: details.ssdpAllLocations ?? (location ? [location] : []),
      upnp: details.upnp ?? details,
    };
  }

  if (protocol === 'dhcp') {
    return {
      ip: primaryIp ?? (typeof details.ip === 'string' ? details.ip : '0.0.0.0'),
      hostname: String(details.hostname ?? input.host ?? input.name ?? candidate.name ?? ''),
      macaddress: String(details.macaddress ?? details.mac ?? input.mac ?? candidate.id ?? ''),
    };
  }

  if (protocol === 'bluetooth') {
    return {
      address: String(details.address ?? input.mac ?? candidate.id ?? ''),
      name: String(details.localName ?? details.local_name ?? input.name ?? candidate.name ?? ''),
      rssi: typeof details.rssi === 'number' ? details.rssi : -60,
      manufacturerData: details.manufacturerData ?? details.manufacturer_data ?? {},
      serviceData: details.serviceData ?? details.service_data ?? {},
      serviceUuids: details.serviceUuids ?? details.service_uuids ?? [],
      txPower: details.txPower ?? details.tx_power,
      connectable: details.connectable !== false,
      source: typeof details.source === 'string' ? details.source : 'local',
    };
  }

  if (protocol === 'usb') {
    return {
      device: String(
        details.device ?? details.path ?? input.usb?.serialNumber ?? candidate.id ?? '/dev/ttyUSB0',
      ),
      vid: String(details.vid ?? input.usb?.vid ?? ''),
      pid: String(details.pid ?? input.usb?.pid ?? ''),
      serialNumber: details.serialNumber ?? details.serial_number ?? input.usb?.serialNumber,
      manufacturer: details.manufacturer ?? input.usb?.manufacturer,
      description: details.description ?? input.usb?.description ?? input.name ?? candidate.name,
    };
  }

  if (protocol === 'mqtt') {
    const topic = String(details.topic ?? input.mqttTopic ?? candidate.id ?? '');
    return {
      topic,
      payload: details.payload ?? '',
      qos: typeof details.qos === 'number' ? details.qos : 0,
      retain: Boolean(details.retain),
      subscribedTopic: details.subscribedTopic ?? details.subscribed_topic,
    };
  }

  return { ...details };
}

@Injectable()
export class HaFlowDiscoverySyncService implements OnModuleInit, OnModuleDestroy {
  private readonly triggeredKeys = new Map<string, number>();
  private readonly pendingTasks = new Set<Promise<void>>();
  private unsubscribeMqtt?: () => void;
  private destroyed = false;

  constructor(
    private readonly commissioning: CommissioningService,
    private readonly bridgeService: HaFlowBridgeService,
    @Optional()
    @Inject(MqttService)
    private readonly mqttService?: MqttService,
  ) {
    this.commissioning.setHaDiscoveryIngestedHook((candidate, input) => {
      if (this.destroyed || process.env.HAUS_DISABLE_HA_FLOW === '1') return;
      const task = this.syncCandidateToHa(candidate, input)
        .catch(() => undefined)
        .finally(() => {
          this.pendingTasks.delete(task);
        });
      this.pendingTasks.add(task);
    });
  }

  onModuleInit(): void {
    const broker = this.mqttService?.broker;
    if (!broker) return;
    const onMessage = (message: MqttMessage) => {
      if (this.destroyed || !message?.topic) return;
      const rules = this.commissioning.getMatcherRules();
      const hasMqttMatch = rules.some((r) =>
        r.mqtt?.some((pattern) => mqttTopicMatches(pattern, message.topic)),
      );
      if (!hasMqttMatch) return;
      const mqttTopic = message.topic.split('/').slice(0, 2).join('/') || message.topic;
      this.commissioning.ingestDiscovery({
        protocol: 'mqtt',
        mqttTopic: message.topic,
        host: mqttTopic,
        name: message.topic,
        details: {
          topic: message.topic,
          payload: message.payload,
          retain: message.retained === true,
        },
      });
    };
    broker.on('message', onMessage);
    this.unsubscribeMqtt = () => {
      broker.off('message', onMessage);
    };
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    this.unsubscribeMqtt?.();
    this.unsubscribeMqtt = undefined;
    await this.flush();
  }

  async flush(): Promise<void> {
    if (this.pendingTasks.size === 0) return;
    await Promise.allSettled(Array.from(this.pendingTasks));
  }

  clearCooldown(domain?: string): void {
    if (!domain) {
      this.triggeredKeys.clear();
      return;
    }
    const prefix = `${domain}:`;
    for (const key of Array.from(this.triggeredKeys.keys())) {
      if (key.startsWith(prefix)) this.triggeredKeys.delete(key);
    }
  }

  async syncCandidateToHa(
    candidate: DiscoveredCandidate,
    input: DiscoveryAdvertisementInput,
  ): Promise<void> {
    if (
      this.destroyed ||
      candidate.status === 'ignored' ||
      candidate.status === 'configured' ||
      !this.bridgeService.isStartRequested()
    ) {
      return;
    }
    const bridge = this.bridgeService.getBridge();
    if (!bridge) return;

    const details = mergeDiscoveryTxtDetails(input.protocol, input.details);
    const normalized: DiscoveryAdvertisementInput = { ...input, details };
    const matches = matchAllDiscoveryRules(this.commissioning.getMatcherRules(), normalized);
    if (matches.length === 0) return;

    const seenDomains = new Set<string>();
    const now = Date.now();
    for (const match of matches) {
      const { rule } = match;
      if (seenDomains.has(rule.domain) || rule.domain === 'tuya') continue;
      seenDomains.add(rule.domain);
      if (!bridge.supportsDomain(rule.domain)) continue;

      const dispatchProtocol = this.resolveHaDispatchProtocol(normalized, rule);
      const dedupeKey = `${rule.domain}:${dispatchProtocol}:${candidate.id}`;
      const last = this.triggeredKeys.get(dedupeKey);
      if (last && now - last < DISCOVERY_COOLDOWN_MS) continue;
      this.triggeredKeys.set(dedupeKey, now);

      const info = buildProtocolDiscoveryInfo(dispatchProtocol, normalized, candidate);
      await this.bridgeService
        .triggerDiscovery({
          domain: rule.domain,
          protocol: dispatchProtocol,
          info,
          discoveryKey: candidate.id,
        })
        .catch(() => undefined);
    }
  }

  private resolveHaDispatchProtocol(
    input: DiscoveryAdvertisementInput,
    rule: ReturnType<typeof matchAllDiscoveryRules>[number]['rule'],
  ): string {
    if (rule.domain === 'homekit_controller' || rule.domain === 'homekit') {
      return input.protocol === 'bluetooth' ? 'bluetooth' : 'zeroconf';
    }
    const rawServiceType = input.details?.serviceType ?? input.details?.type;
    const serviceType =
      typeof rawServiceType === 'string' ? rawServiceType.trim().toLowerCase() : '';
    const isHapAdvertisement =
      input.protocol === 'homekit' ||
      serviceType.startsWith('_hap._tcp') ||
      serviceType.startsWith('_hap._udp');
    if (isHapAdvertisement && rule.homekit?.models?.length) {
      return 'homekit';
    }
    return input.protocol === 'homekit' ? 'zeroconf' : input.protocol;
  }
}
