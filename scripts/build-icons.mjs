import { writeFile, mkdir } from 'node:fs/promises';
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
const symbol =
  'M258 463 484 268Q512 244 540 268L766 463Q786 481 769 503Q754 521 735 506L716 490V738Q716 766 686 766H584Q558 766 558 739V589H466V739Q466 766 440 766H338Q308 766 308 738V490L289 506Q270 521 255 503Q238 481 258 463Z';
const artwork = () =>
  `<defs><linearGradient id="background" x1="0" y1="0" x2="0.6" y2="1"><stop stop-color="#222222"/><stop offset=".48" stop-color="#0d0d0d"/><stop offset="1" stop-color="#030303"/></linearGradient><linearGradient id="glass" x1=".15" y1="0" x2=".85" y2="1"><stop stop-color="#ffffff"/><stop offset=".35" stop-color="#e8e8e8"/><stop offset=".55" stop-color="#999999"/><stop offset=".78" stop-color="#e1e1e1"/><stop offset="1" stop-color="#ffffff"/></linearGradient><linearGradient id="edge" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffffff" stop-opacity=".65"/><stop offset=".45" stop-color="#ffffff" stop-opacity=".03"/><stop offset="1" stop-color="#ffffff" stop-opacity=".24"/></linearGradient><filter id="shadow" x="-30%" y="-30%" width="160%" height="170%"><feGaussianBlur stdDeviation="18"/></filter><filter id="symbol-shadow"><feDropShadow dx="0" dy="12" stdDeviation="12" flood-color="#000000" flood-opacity=".65"/></filter></defs>`;
function svg(mac) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${artwork()}<g ${mac ? 'transform="translate(96 96) scale(.8125)" ' : ''}>${mac ? `<path d="${enclosure}" transform="translate(0 18)" fill="#000000" opacity=".4" filter="url(#shadow)"/>` : ''}<path d="${enclosure}" fill="url(#background)"/><path d="${enclosure}" fill="none" stroke="url(#edge)" stroke-width="2"/><path d="${symbol}" fill="url(#glass)" stroke="url(#edge)" stroke-width="3" filter="url(#symbol-shadow)"/><path d="M276 477 499 285Q512 274 525 285L748 477M325 503V737Q325 750 341 750" fill="none" stroke="#ffffff" stroke-opacity=".6" stroke-width="3" stroke-linecap="round"/></g></svg>`;
}
const flat = Buffer.from(svg(false)),
  mac = Buffer.from(svg(true));
await writeFile(new URL('icon.svg', output), flat);
await writeFile(new URL('icon-mac.svg', output), mac);
await sharp(flat).png().toFile(new URL('icon.png', output).pathname);
await sharp(mac).png().toFile(new URL('icon-mac.png', output).pathname);
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
  'Generated desktop icons: macOS enclosure with padding/shadow; Windows/Linux without outer padding/shadow.',
);
