/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { ThreadDataset } from './types.js';

export function validateThreadDataset(input: unknown): {
  valid: boolean;
  dataset?: ThreadDataset;
  errors: string[];
} {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') {
    return { valid: false, errors: ['Dataset must be an object'] };
  }

  const raw = input as Record<string, unknown>;

  if (
    typeof raw.networkName !== 'string' ||
    raw.networkName.trim().length === 0 ||
    raw.networkName.length > 16
  ) {
    errors.push('networkName must be a string between 1 and 16 characters');
  }

  if (
    typeof raw.channel !== 'number' ||
    raw.channel < 11 ||
    raw.channel > 26 ||
    !Number.isInteger(raw.channel)
  ) {
    errors.push('channel must be an integer between 11 and 26');
  }

  if (
    typeof raw.panId !== 'number' ||
    raw.panId < 0 ||
    raw.panId > 0xffff ||
    !Number.isInteger(raw.panId)
  ) {
    errors.push('panId must be a 16-bit unsigned integer (0x0000 - 0xFFFF)');
  }

  if (typeof raw.extendedPanId !== 'string' || !/^[a-fA-F0-9]{16}$/.test(raw.extendedPanId)) {
    errors.push('extendedPanId must be a 16-character hex string');
  }

  if (typeof raw.networkKey !== 'string' || !/^[a-fA-F0-9]{32}$/.test(raw.networkKey)) {
    errors.push('networkKey must be a 32-character hex string (128-bit key)');
  }

  if (
    typeof raw.meshLocalPrefix !== 'string' ||
    !/^fd[0-9a-fA-F]{2}:[0-9a-fA-F]{0,4}:[0-9a-fA-F]{0,4}::\/64$/.test(raw.meshLocalPrefix)
  ) {
    errors.push(
      'meshLocalPrefix must be a valid unique-local IPv6 /64 prefix (e.g. "fd00:7d03:7d03::/64")',
    );
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    dataset: input as ThreadDataset,
    errors: [],
  };
}

/**
 * Generates a random, secure default Thread operational dataset.
 */
export function generateDefaultThreadDataset(networkName = 'Haus-Thread'): ThreadDataset {
  const randomHex = (len: number) => {
    let result = '';
    const chars = '0123456789abcdef';
    for (let i = 0; i < len; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const randomPanId = Math.floor(Math.random() * 0xfffe) + 1;
  const prefixPart1 = randomHex(4);
  const prefixPart2 = randomHex(4);

  return {
    networkName: networkName.slice(0, 16),
    channel: 15,
    panId: randomPanId,
    extendedPanId: randomHex(16),
    networkKey: randomHex(32),
    meshLocalPrefix: `fd${randomHex(2)}:${prefixPart1}:${prefixPart2}::/64`,
  };
}
