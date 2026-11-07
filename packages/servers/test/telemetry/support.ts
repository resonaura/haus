/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
export const sample = (): Record<string, unknown> & {
  memory: Record<string, unknown>;
  docker: Record<string, unknown>;
  pm2: Record<string, unknown>;
} => ({
  sampledAt: new Date().toISOString(),
  scope: 'host',
  hostname: 'home',
  platform: 'linux',
  release: '6',
  arch: 'arm64',
  uptimeSeconds: 120,
  cpu: { model: 'CPU', logicalCores: 4, usage: 0.25, loadAverage: [1, 2, 3] },
  memory: { totalBytes: 1000, availableBytes: 300, usedBytes: 700 },
  swap: { supported: true, totalBytes: 100, usedBytes: 10 },
  disks: [],
  docker: { available: false },
  pm2: { available: false },
});

export function memoryDevice(size: number) {
  const raw = Buffer.alloc(32);
  raw[0] = 17;
  raw[1] = raw.length;
  raw.writeUInt16LE(size, 12);
  return raw;
}
