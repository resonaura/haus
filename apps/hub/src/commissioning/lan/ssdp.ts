/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { DiscoveryAdvertisementInput } from '@haus/core';

export interface SsdpHeaders {
  readonly st?: string;
  readonly nt?: string;
  readonly nts?: string;
  readonly usn?: string;
  readonly location?: string;
  readonly server?: string;
  readonly rawHeaders?: Readonly<Record<string, string>>;
}

export interface UpnpDeviceDescription {
  readonly deviceType?: string;
  readonly friendlyName?: string;
  readonly manufacturer?: string;
  readonly manufacturerURL?: string;
  readonly modelName?: string;
  readonly modelDescription?: string;
  readonly modelNumber?: string;
  readonly modelURL?: string;
  readonly presentationURL?: string;
  readonly serialNumber?: string;
  readonly upc?: string;
  readonly udn?: string;
  readonly extraTags?: Readonly<Record<string, string>>;
  readonly subDevices?: readonly UpnpDeviceDescription[];
}

const MAX_XML_BYTES = 128 * 1024;
const LOCATION_TIMEOUT_MS = 1_800;

export function buildSsdpSearchPayload(searchTarget = 'ssdp:all', mx = 2): Buffer {
  return Buffer.from(
    [
      'M-SEARCH * HTTP/1.1',
      'HOST: 239.255.255.250:1900',
      'MAN: "ssdp:discover"',
      `MX: ${mx}`,
      `ST: ${searchTarget}`,
      '',
      '',
    ].join('\r\n'),
    'utf8',
  );
}

export function parseSsdpHeaders(raw: string): SsdpHeaders | null {
  const lines = raw.split(/\r?\n/);
  if (lines.length === 0) return null;
  const first = lines[0]?.trim().toUpperCase() ?? '';
  if (!first.startsWith('HTTP/1.1 200') && !first.startsWith('NOTIFY ')) {
    return null;
  }
  const map: Record<string, string> = {};
  const rawHeaders: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const rawKey = line.slice(0, colon).trim();
    const key = rawKey.toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (value) {
      map[key] = value;
      rawHeaders[rawKey] = value;
    }
  }
  return {
    st: map.st,
    nt: map.nt,
    nts: map.nts?.toLowerCase(),
    usn: map.usn,
    location: map.location,
    server: map.server,
    rawHeaders,
  };
}

export function isPrivateLanHttpUrl(
  rawUrl: string,
): { url: URL; host: string; port: number } | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:') return null;
  const host = parsed.hostname;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = m.slice(1).map((n) => Number.parseInt(n, 10));
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return null;
  const [a, b, c, d] = octets;
  const isMetadata = a === 169 && b === 254 && c === 169 && d === 254;
  const isPrivate =
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254 && !isMetadata);
  if (!isPrivate) return null;
  const port = parsed.port ? Number.parseInt(parsed.port, 10) : 80;
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return null;
  return { url: parsed, host, port };
}

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .trim();
}

function extractXmlTag(block: string, tagName: string): string | undefined {
  const re = new RegExp(`<${tagName}\\b[^>]*>([^<]+)</${tagName}>`, 'i');
  const match = re.exec(block);
  return match?.[1] ? decodeXmlEntities(match[1]) : undefined;
}

function extractAllLeafTags(block: string): Record<string, string> {
  const tags: Record<string, string> = {};
  const re = /<([a-zA-Z_][\w.-]*)(?:\s[^>]*)?>([^<]+)<\/\1>/g;
  for (const match of block.matchAll(re)) {
    const name = match[1]?.trim();
    const val = match[2] ? decodeXmlEntities(match[2]) : '';
    if (name && val && !(name in tags)) {
      tags[name] = val;
    }
  }
  return tags;
}

function parseSingleDeviceBlock(block: string): UpnpDeviceDescription {
  const extraTags = extractAllLeafTags(block);
  return {
    deviceType: extractXmlTag(block, 'deviceType'),
    friendlyName: extractXmlTag(block, 'friendlyName'),
    manufacturer: extractXmlTag(block, 'manufacturer'),
    manufacturerURL: extractXmlTag(block, 'manufacturerURL'),
    modelName: extractXmlTag(block, 'modelName'),
    modelDescription: extractXmlTag(block, 'modelDescription'),
    modelNumber: extractXmlTag(block, 'modelNumber'),
    modelURL: extractXmlTag(block, 'modelURL'),
    presentationURL: extractXmlTag(block, 'presentationURL'),
    serialNumber: extractXmlTag(block, 'serialNumber'),
    upc: extractXmlTag(block, 'UPC'),
    udn: extractXmlTag(block, 'UDN'),
    ...(Object.keys(extraTags).length > 0 ? { extraTags } : {}),
  };
}

export function parseUpnpDeviceXml(xml: string): UpnpDeviceDescription {
  const deviceListMatch = /<deviceList\b[^>]*>([\s\S]*?)<\/deviceList>/i.exec(xml);
  const subDevices: UpnpDeviceDescription[] = [];
  if (deviceListMatch?.[1]) {
    const cleanedList = deviceListMatch[1]
      .replace(/<serviceList\b[\s\S]*?<\/serviceList>/gi, '')
      .replace(/<iconList\b[\s\S]*?<\/iconList>/gi, '');
    for (const m of cleanedList.matchAll(/<device\b[^>]*>([\s\S]*?)<\/device>/gi)) {
      if (m[1]) subDevices.push(parseSingleDeviceBlock(m[1]));
    }
  }

  const withoutNested = xml
    .replace(/<serviceList\b[\s\S]*?<\/serviceList>/gi, '')
    .replace(/<iconList\b[\s\S]*?<\/iconList>/gi, '')
    .replace(/<deviceList\b[\s\S]*?<\/deviceList>/gi, '');
  const deviceBlockMatch = /<device\b[^>]*>([\s\S]*?)<\/device>/i.exec(withoutNested);
  const block = deviceBlockMatch?.[1] ?? withoutNested;
  const primary = parseSingleDeviceBlock(block);
  return subDevices.length > 0 ? { ...primary, subDevices } : primary;
}

export class SsdpDescriptionCache {
  private readonly cache = new Map<string, { info: UpnpDeviceDescription; expiresAt: number }>();
  private readonly pending = new Map<string, Promise<UpnpDeviceDescription | undefined>>();

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async resolve(location: string): Promise<UpnpDeviceDescription | undefined> {
    const safe = isPrivateLanHttpUrl(location);
    if (!safe) return undefined;

    const now = Date.now();
    const cached = this.cache.get(location);
    if (cached && cached.expiresAt > now) {
      return cached.info;
    }

    const active = this.pending.get(location);
    if (active) return active;

    const task = this.fetchXml(safe.url.toString())
      .then((info) => {
        if (info) {
          if (this.cache.size >= 300) this.cache.clear();
          this.cache.set(location, { info, expiresAt: Date.now() + 5 * 60_000 });
        }
        return info;
      })
      .finally(() => {
        this.pending.delete(location);
      });

    this.pending.set(location, task);
    return task;
  }

  private async fetchXml(url: string): Promise<UpnpDeviceDescription | undefined> {
    try {
      const res = await this.fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(LOCATION_TIMEOUT_MS),
        headers: { Accept: 'text/xml, application/xml' },
      });
      if (!res.ok) return undefined;
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len > MAX_XML_BYTES) return undefined;
      const text = await res.text();
      if (!text || Buffer.byteLength(text, 'utf8') > MAX_XML_BYTES) return undefined;
      return parseUpnpDeviceXml(text);
    } catch {
      return undefined;
    }
  }
}

export function buildSsdpAdvertisement(
  headers: SsdpHeaders,
  remoteAddress: string,
  description?: UpnpDeviceDescription,
): DiscoveryAdvertisementInput | null {
  if (headers.nts === 'ssdp:byebye') return null;
  const safeLocation = headers.location ? isPrivateLanHttpUrl(headers.location) : null;
  const host = safeLocation?.host ?? remoteAddress;
  const port = safeLocation?.port;
  const uuid = description?.udn ?? headers.usn;
  const name =
    description?.friendlyName ??
    description?.modelName ??
    headers.server ??
    description?.manufacturer;

  const upnpFields: Record<string, unknown> = {
    ...description?.extraTags,
    ...(description?.deviceType ? { deviceType: description.deviceType } : {}),
    ...(description?.friendlyName ? { friendlyName: description.friendlyName } : {}),
    ...(description?.manufacturer ? { manufacturer: description.manufacturer } : {}),
    ...(description?.manufacturerURL ? { manufacturerURL: description.manufacturerURL } : {}),
    ...(description?.modelName ? { modelName: description.modelName } : {}),
    ...(description?.modelDescription ? { modelDescription: description.modelDescription } : {}),
    ...(description?.modelNumber ? { modelNumber: description.modelNumber } : {}),
    ...(description?.modelURL ? { modelURL: description.modelURL } : {}),
    ...(description?.presentationURL ? { presentationURL: description.presentationURL } : {}),
    ...(description?.serialNumber ? { serialNumber: description.serialNumber } : {}),
    ...(description?.upc ? { UPC: description.upc } : {}),
    ...(description?.udn ? { UDN: description.udn, udn: description.udn } : {}),
    ...(description?.subDevices ? { subDevices: description.subDevices } : {}),
  };

  return {
    protocol: 'ssdp',
    name,
    host,
    addresses: [host],
    port,
    uuid,
    details: {
      ...(headers.rawHeaders ? { ssdpHeaders: headers.rawHeaders } : {}),
      ...(Object.keys(upnpFields).length > 0 ? { upnp: upnpFields, ...upnpFields } : {}),
      ...(headers.st ? { st: headers.st } : {}),
      ...(headers.nt ? { nt: headers.nt } : {}),
      ...(headers.usn ? { usn: headers.usn } : {}),
      ...(headers.location ? { location: headers.location } : {}),
      ...(headers.server ? { server: headers.server } : {}),
    },
  };
}
