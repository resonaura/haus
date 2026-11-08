/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getSvgPath } from 'figma-squircle';
import sharp from 'sharp';

const output = new URL('../build/', import.meta.url);
await mkdir(output, { recursive: true });
const enclosure = getSvgPath({
  width: 1024,
  height: 1024,
  cornerRadius: 230,
  cornerSmoothing: 0.6,
});
await writeFile(
  new URL('../src/renderer/src/assets/brands/icon-mask.svg', import.meta.url),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path d="${enclosure}" fill="white"/></svg>`,
);
const flat = await sharp(
  fileURLToPath(new URL('../../../assets/app-icon/haus.png', import.meta.url)),
)
  .resize(1024, 1024, { fit: 'contain' })
  .png()
  .toBuffer();
const mac = await sharp(
  fileURLToPath(new URL('../../../assets/app-icon/haus-mac.png', import.meta.url)),
)
  .resize(1024, 1024, { fit: 'contain' })
  .png()
  .toBuffer();
await writeFile(new URL('icon.png', output), flat);
await writeFile(new URL('icon-mac.png', output), mac);
// These unreferenced vector previews depicted the former generated mark.
for (const name of ['icon.svg', 'icon-mac.svg']) {
  await unlink(new URL(name, output)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
const sizes = [16, 24, 32, 48, 64, 128, 256] as const;
const pngs = await Promise.all(
  sizes.map((size) => sharp(flat).resize(size, size).png().toBuffer()),
);
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (let i = 0; i < sizes.length; i++) {
  const size = sizes[i];
  const png = pngs[i];
  if (size === undefined || png === undefined) continue;
  const p = 6 + i * 16;
  const dim = size === 256 ? 0 : size;
  header[p] = dim;
  header[p + 1] = dim;
  header.writeUInt16LE(1, p + 4);
  header.writeUInt16LE(32, p + 6);
  header.writeUInt32LE(png.length, p + 8);
  header.writeUInt32LE(offset, p + 12);
  offset += png.length;
}
await writeFile(new URL('icon.ico', output), Buffer.concat([header, ...pngs]));
const icnsEntries: ReadonlyArray<readonly [string, number]> = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
  ['ic11', 32],
  ['ic12', 64],
  ['ic13', 256],
  ['ic14', 512],
];
const chunks = await Promise.all(
  icnsEntries.map(async ([type, size]) => {
    const bytes = await sharp(mac).resize(size, size).png().toBuffer();
    const head = Buffer.alloc(8);
    head.write(type);
    head.writeUInt32BE(bytes.length + 8, 4);
    return Buffer.concat([head, bytes]);
  }),
);
const icns = Buffer.alloc(8);
icns.write('icns');
icns.writeUInt32BE(8 + chunks.reduce((sum, item) => sum + item.length, 0), 4);
await writeFile(new URL('icon.icns', output), Buffer.concat([icns, ...chunks]));
console.log(
  'Generated Windows/Linux icons from haus.png and macOS icon variants from haus-mac.png.',
);
