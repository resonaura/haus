/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import {
  isHubDesktopRpcCommand,
  isLocalServerHostname as isLocalHostname,
  normalizeServerUrl,
  validateExternalUrl,
  validateHubDesktopRpcCommand,
  validatePreferences,
} from '@haus/core/hub';
import { isRecord } from '@haus/core/record';
import {
  validateManagement,
  validateRequest as validateHaRequest,
} from '@haus/ha/native/validation';

export {
  normalizeServerUrl,
  isLocalHostname,
  validateManagement,
  isRecord,
  validatePreferences,
  validateExternalUrl,
};

/** Validates Haus Hub desktop RPC commands via `@haus/core/hub` and HA commands via `@haus/ha`. */
export function validateRequest(input: unknown): Record<string, unknown> {
  if (isRecord(input) && typeof input.type === 'string' && isHubDesktopRpcCommand(input.type)) {
    return validateHubDesktopRpcCommand(input);
  }
  return validateHaRequest(input);
}
