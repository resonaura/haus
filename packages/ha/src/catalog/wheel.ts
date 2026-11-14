/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import type { HaHomeKitModelMetadata, HaTranslationsIndex } from './translations.js';
import { computeTranslationsChecksum } from './translations.js';
import type { HaCatalogManifest } from './types.js';

export interface ParsedWheelCatalogData {
  readonly version: string;
  readonly manifests: Record<string, HaCatalogManifest>;
  readonly translationsIndex: HaTranslationsIndex;
}

export function parseManifestRecord(
  fallbackDomain: string,
  data: Record<string, unknown>,
): HaCatalogManifest {
  const domain = typeof data.domain === 'string' && data.domain ? data.domain : fallbackDomain;
  return {
    domain,
    name: typeof data.name === 'string' && data.name ? data.name : domain,
    integration_type: typeof data.integration_type === 'string' ? data.integration_type : undefined,
    supported_by: typeof data.supported_by === 'string' ? data.supported_by : undefined,
    iot_class: typeof data.iot_class === 'string' ? data.iot_class : undefined,
    config_flow: Boolean(data.config_flow),
    documentation: typeof data.documentation === 'string' ? data.documentation : undefined,
    requirements: Array.isArray(data.requirements) ? data.requirements.map(String) : [],
    dependencies: Array.isArray(data.dependencies) ? data.dependencies.map(String) : [],
    after_dependencies: Array.isArray(data.after_dependencies)
      ? data.after_dependencies.map(String)
      : undefined,
    codeowners: Array.isArray(data.codeowners) ? data.codeowners.map(String) : [],
    zeroconf: Array.isArray(data.zeroconf)
      ? (data.zeroconf as (string | Record<string, unknown>)[])
      : undefined,
    ssdp: Array.isArray(data.ssdp) ? (data.ssdp as Record<string, unknown>[]) : undefined,
    dhcp: Array.isArray(data.dhcp) ? (data.dhcp as Record<string, unknown>[]) : undefined,
    bluetooth: Array.isArray(data.bluetooth)
      ? (data.bluetooth as Record<string, unknown>[])
      : undefined,
    mqtt: Array.isArray(data.mqtt) ? data.mqtt.map(String) : undefined,
    usb: Array.isArray(data.usb) ? (data.usb as Record<string, unknown>[]) : undefined,
    homekit:
      typeof data.homekit === 'object' && data.homekit !== null
        ? (data.homekit as Record<string, unknown>)
        : undefined,
    single_config_entry: Boolean(data.single_config_entry),
  };
}

function parsePythonLiteralAssignment<T>(source: string, symbolName: string): T | null {
  const idx = source.indexOf(symbolName);
  if (idx < 0) return null;
  const eqIdx = source.indexOf('=', idx + symbolName.length);
  if (eqIdx < 0) return null;

  const afterEq = source.slice(eqIdx + 1);
  const startMatch = /[[{]/.exec(afterEq);
  if (!startMatch) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  let endPos = -1;
  const startIdx = startMatch.index;

  for (let i = startIdx; i < afterEq.length; i += 1) {
    const ch = afterEq[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '#') {
      const nl = afterEq.indexOf('\n', i);
      if (nl < 0) break;
      i = nl;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      depth += 1;
    } else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) {
        endPos = i + 1;
        break;
      }
    }
  }

  if (endPos < 0) return null;
  const rawBlock = afterEq.slice(startIdx, endPos);

  // Strip comments and convert Python literals outside strings cleanly without eval.
  let out = '';
  inString = false;
  escaped = false;
  for (let i = 0; i < rawBlock.length; i += 1) {
    const ch = rawBlock[i]!;
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '#') {
      const nl = rawBlock.indexOf('\n', i);
      if (nl < 0) break;
      i = nl;
      out += '\n';
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (rawBlock.startsWith('True', i) && !/\w/.test(rawBlock[i + 4] ?? '')) {
      out += 'true';
      i += 3;
      continue;
    }
    if (rawBlock.startsWith('False', i) && !/\w/.test(rawBlock[i + 5] ?? '')) {
      out += 'false';
      i += 4;
      continue;
    }
    if (rawBlock.startsWith('None', i) && !/\w/.test(rawBlock[i + 4] ?? '')) {
      out += 'null';
      i += 3;
      continue;
    }
    out += ch;
  }

  const normalized = out.replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(normalized) as T;
  } catch {
    return null;
  }
}

export function extractGeneratedMetadataFromPy(sources: {
  zeroconfPy?: string;
  configFlowsPy?: string;
  applicationCredentialsPy?: string;
}): {
  homekitModels: Record<string, HaHomeKitModelMetadata>;
  flowHandlers: string[];
  applicationCredentials: string[];
} {
  const homekitModels: Record<string, HaHomeKitModelMetadata> = {};
  if (sources.zeroconfPy) {
    const rawHk = parsePythonLiteralAssignment<
      Record<string, { always_discover?: boolean; domain?: string }>
    >(sources.zeroconfPy, 'HOMEKIT');
    if (rawHk) {
      for (const [model, meta] of Object.entries(rawHk)) {
        if (meta && typeof meta.domain === 'string') {
          homekitModels[model] = {
            domain: meta.domain,
            alwaysDiscover: Boolean(meta.always_discover),
          };
        }
      }
    }
  }

  const flowHandlerSet = new Set<string>();
  if (sources.configFlowsPy) {
    const rawFlows = parsePythonLiteralAssignment<Record<string, string[]>>(
      sources.configFlowsPy,
      'FLOWS',
    );
    if (rawFlows) {
      for (const list of Object.values(rawFlows)) {
        if (Array.isArray(list)) {
          for (const item of list) {
            if (typeof item === 'string' && item) flowHandlerSet.add(item);
          }
        }
      }
    }
  }

  const appCreds: string[] = [];
  if (sources.applicationCredentialsPy) {
    const rawCreds = parsePythonLiteralAssignment<string[]>(
      sources.applicationCredentialsPy,
      'APPLICATION_CREDENTIALS',
    );
    if (Array.isArray(rawCreds)) {
      for (const d of rawCreds) {
        if (typeof d === 'string' && d) appCreds.push(d);
      }
    }
  }

  return {
    homekitModels,
    flowHandlers: [...flowHandlerSet].sort(),
    applicationCredentials: [...new Set(appCreds)].sort(),
  };
}

interface ZipCentralEntry {
  readonly fileName: string;
  readonly compressionMethod: number;
  readonly compressedSize: number;
  readonly localHeaderOffset: number;
}

function readZipCentralEntries(
  buf: Buffer,
  filterFn: (name: string) => boolean,
): Map<string, Buffer> {
  // Locate End of Central Directory signature 0x06054b50 from end of archive.
  const minPos = Math.max(0, buf.length - 65_557);
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= minPos; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('Invalid wheel archive: ZIP end of central directory not found');
  }

  let cdOffset = buf.readUInt32LE(eocdOffset + 16);
  let totalEntries = buf.readUInt16LE(eocdOffset + 10);

  if (cdOffset === 0xffffffff || totalEntries === 0xffff) {
    const zip64Loc = eocdOffset - 20;
    if (zip64Loc >= 0 && buf.readUInt32LE(zip64Loc) === 0x07064b50) {
      const zip64EocdOffset = Number(buf.readBigUInt64LE(zip64Loc + 8));
      if (buf.readUInt32LE(zip64EocdOffset) === 0x06064b50) {
        totalEntries = Number(buf.readBigUInt64LE(zip64EocdOffset + 32));
        cdOffset = Number(buf.readBigUInt64LE(zip64EocdOffset + 48));
      }
    }
  }

  const selected: ZipCentralEntry[] = [];
  let cursor = cdOffset;
  for (let idx = 0; idx < totalEntries && cursor + 46 <= buf.length; idx += 1) {
    if (buf.readUInt32LE(cursor) !== 0x02014b50) break;
    const compressionMethod = buf.readUInt16LE(cursor + 10);
    let compressedSize = buf.readUInt32LE(cursor + 20);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    let localHeaderOffset = buf.readUInt32LE(cursor + 42);
    const fileName = buf.toString('utf8', cursor + 46, cursor + 46 + nameLen);

    if (compressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      // Parse ZIP64 extended information extra field if needed.
      let exPos = cursor + 46 + nameLen;
      const exEnd = exPos + extraLen;
      while (exPos + 4 <= exEnd) {
        const headerId = buf.readUInt16LE(exPos);
        const dataSize = buf.readUInt16LE(exPos + 2);
        if (headerId === 0x0001) {
          let fieldPos = exPos + 4;
          if (buf.readUInt32LE(cursor + 24) === 0xffffffff) fieldPos += 8;
          if (compressedSize === 0xffffffff && fieldPos + 8 <= exPos + 4 + dataSize) {
            compressedSize = Number(buf.readBigUInt64LE(fieldPos));
            fieldPos += 8;
          }
          if (localHeaderOffset === 0xffffffff && fieldPos + 8 <= exPos + 4 + dataSize) {
            localHeaderOffset = Number(buf.readBigUInt64LE(fieldPos));
          }
          break;
        }
        exPos += 4 + dataSize;
      }
    }

    if (filterFn(fileName)) {
      selected.push({ fileName, compressionMethod, compressedSize, localHeaderOffset });
    }
    cursor += 46 + nameLen + extraLen + commentLen;
  }

  const extracted = new Map<string, Buffer>();
  for (const entry of selected) {
    const lh = entry.localHeaderOffset;
    if (buf.readUInt32LE(lh) !== 0x04034b50) continue;
    const lhNameLen = buf.readUInt16LE(lh + 26);
    const lhExtraLen = buf.readUInt16LE(lh + 28);
    const dataStart = lh + 30 + lhNameLen + lhExtraLen;
    const compressed = buf.subarray(dataStart, dataStart + entry.compressedSize);
    if (entry.compressionMethod === 0) {
      extracted.set(entry.fileName, Buffer.from(compressed));
    } else if (entry.compressionMethod === 8) {
      extracted.set(entry.fileName, inflateRawSync(compressed));
    }
  }
  return extracted;
}

export function parseHomeAssistantWheel(
  wheelBuffer: Buffer,
  version: string,
): ParsedWheelCatalogData {
  const manifestRe = /^homeassistant\/components\/([^/]+)\/manifest\.json$/;
  const translationRe = /^homeassistant\/components\/([^/]+)\/translations\/en\.json$/;
  const specialPaths = new Set([
    'homeassistant/generated/zeroconf.py',
    'homeassistant/generated/config_flows.py',
    'homeassistant/generated/application_credentials.py',
  ]);

  const files = readZipCentralEntries(
    wheelBuffer,
    (name) => manifestRe.test(name) || translationRe.test(name) || specialPaths.has(name),
  );

  const manifests: Record<string, HaCatalogManifest> = {};
  const translations: Record<string, Record<string, unknown>> = {};
  const supportedBy: Record<string, string> = {};

  for (const [path, data] of files.entries()) {
    const mMatch = manifestRe.exec(path);
    if (mMatch) {
      try {
        const parsed = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
        const manifest = parseManifestRecord(mMatch[1]!, parsed);
        manifests[manifest.domain] = manifest;
        if (manifest.supported_by) {
          supportedBy[manifest.domain] = manifest.supported_by;
        }
      } catch {
        // Ignore malformed individual manifest entries.
      }
      continue;
    }

    const tMatch = translationRe.exec(path);
    if (tMatch) {
      try {
        const parsed = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
        translations[tMatch[1]!] = parsed;
      } catch {
        // Ignore malformed individual translation files.
      }
    }
  }

  for (const manifest of Object.values(manifests)) {
    const existing = translations[manifest.domain];
    if (!existing) {
      translations[manifest.domain] = { title: manifest.name };
    } else if (typeof existing.title !== 'string' || !existing.title) {
      translations[manifest.domain] = { ...existing, title: manifest.name };
    }
  }

  const generated = extractGeneratedMetadataFromPy({
    zeroconfPy: files.get('homeassistant/generated/zeroconf.py')?.toString('utf8'),
    configFlowsPy: files.get('homeassistant/generated/config_flows.py')?.toString('utf8'),
    applicationCredentialsPy: files
      .get('homeassistant/generated/application_credentials.py')
      ?.toString('utf8'),
  });

  // Ensure supported_by virtual domains are also advertised in flowHandlers alongside real ones.
  const allFlowHandlers = new Set<string>(generated.flowHandlers);
  for (const m of Object.values(manifests)) {
    if (m.config_flow) allFlowHandlers.add(m.domain);
    if (m.supported_by && allFlowHandlers.has(m.supported_by)) {
      allFlowHandlers.add(m.domain);
    }
  }

  const basePayload = {
    version,
    translations,
    supportedBy,
    homekitModels: generated.homekitModels,
    flowHandlers: [...allFlowHandlers].sort(),
    applicationCredentials: generated.applicationCredentials,
  };

  return {
    version,
    manifests,
    translationsIndex: {
      ...basePayload,
      sha256: computeTranslationsChecksum(basePayload),
      generatedAt: new Date().toISOString(),
    },
  };
}

export async function resolveWheelUrlFromPyPi(
  version: string | undefined,
  fetchFn: typeof fetch,
): Promise<{ version: string; wheelUrl: string } | null> {
  const url = version
    ? `https://pypi.org/pypi/homeassistant/${encodeURIComponent(version)}/json`
    : 'https://pypi.org/pypi/homeassistant/json';
  const res = await fetchFn(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const payload = (await res.json()) as {
    info?: { version?: string };
    urls?: readonly { packagetype?: string; url?: string; filename?: string }[];
  };
  const resolvedVersion = payload.info?.version ?? version;
  const wheel = payload.urls?.find(
    (u) =>
      u.packagetype === 'bdist_wheel' &&
      typeof u.url === 'string' &&
      (u.filename?.endsWith('-py3-none-any.whl') ?? u.url.endsWith('.whl')),
  );
  if (!resolvedVersion || !wheel?.url) return null;
  return { version: resolvedVersion, wheelUrl: wheel.url };
}

/**
 * Extracts `homeassistant/components/**` files from an HA wheel into a local
 * directory suitable for `componentsOverlayDir`, so runtime config flows match
 * the upgraded catalog version without modifying the base Python venv.
 */
export function extractComponentsOverlayFromWheel(
  wheelBuffer: Buffer,
  targetComponentsDir: string,
): number {
  const prefix = 'homeassistant/components/';
  const files = readZipCentralEntries(
    wheelBuffer,
    (name) => name.startsWith(prefix) && !name.endsWith('/'),
  );
  const rootResolved = resolve(targetComponentsDir);
  mkdirSync(rootResolved, { recursive: true });
  let count = 0;
  for (const [entryName, content] of files.entries()) {
    const rel = entryName.slice(prefix.length);
    if (!rel || rel.includes('..') || rel.startsWith('/')) continue;
    const dest = resolve(rootResolved, rel);
    if (!dest.startsWith(`${rootResolved}${sep}`)) continue;
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
    count += 1;
  }
  return count;
}
