import { writeFile, mkdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { getSvgPath } from 'figma-squircle';
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
const flat = await sharp(fileURLToPath(new URL('../assets/app-icon/haus.png', import.meta.url)))
  .resize(1024, 1024, { fit: 'contain' })
  .png()
  .toBuffer();
const mac = await sharp(fileURLToPath(new URL('../assets/app-icon/haus-mac.png', import.meta.url)))
  .resize(1024, 1024, { fit: 'contain' })
  .png()
  .toBuffer();
await writeFile(new URL('icon.png', output), flat);
await writeFile(new URL('icon-mac.png', output), mac);
// These unreferenced vector previews depicted the former generated mark.
for (const name of ['icon.svg', 'icon-mac.svg']) {
  await unlink(new URL(name, output)).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = await Promise.all(
  sizes.map((size) => sharp(flat).resize(size, size).png().toBuffer()),
);
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (let i = 0; i < sizes.length; i++) {
  const p = 6 + i * 16;
  header[p] = sizes[i] === 256 ? 0 : sizes[i];
  header[p + 1] = header[p];
  header.writeUInt16LE(1, p + 4);
  header.writeUInt16LE(32, p + 6);
  header.writeUInt32LE(pngs[i].length, p + 8);
  header.writeUInt32LE(offset, p + 12);
  offset += pngs[i].length;
}
await writeFile(new URL('icon.ico', output), Buffer.concat([header, ...pngs]));
const chunks = await Promise.all(
  [
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
  ].map(async ([type, size]) => {
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
