/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export function requireGpuiBun(): void {
  const [major, minor] = (process.versions.bun ?? '').split('.').map(Number);
  if (!(major > 1 || (major === 1 && minor >= 4))) {
    throw new Error('Haus GPUIX requires Bun 1.4 or later for native addon cleanup.');
  }
}
