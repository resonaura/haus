/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export function createZipBuffer(files: Record<string, string>): Uint8Array<ArrayBuffer> {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const entries = Object.entries(files);

  for (const [rawName, content] of entries) {
    const nameBuf = Buffer.from(rawName, 'utf8');
    const dataBuf = Buffer.from(content, 'utf8');
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(dataBuf.length, 18);
    localHeader.writeUInt32LE(dataBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuf, dataBuf);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(dataBuf.length, 20);
    centralHeader.writeUInt32LE(dataBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + dataBuf.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt32LE(0, 4);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return new Uint8Array(Buffer.concat([...localParts, centralDir, eocd]));
}

export function buildComponentZip(params: {
  readonly domain: string;
  readonly version: string;
  readonly requirements?: readonly string[];
  readonly minHaVersion?: string;
  readonly extraFiles?: Record<string, string>;
}): Uint8Array<ArrayBuffer> {
  const manifest = {
    domain: params.domain,
    name: `Test ${params.domain}`,
    version: params.version,
    config_flow: true,
    requirements: params.requirements ?? [],
  };
  const files: Record<string, string> = {
    [`custom_components/${params.domain}/manifest.json`]: JSON.stringify(manifest, null, 2),
    [`custom_components/${params.domain}/__init__.py`]: `# version ${params.version}\n`,
    ...params.extraFiles,
  };
  if (params.minHaVersion) {
    files['hacs.json'] = JSON.stringify({
      name: `Test ${params.domain}`,
      homeassistant: params.minHaVersion,
    });
  }
  return createZipBuffer(files);
}
