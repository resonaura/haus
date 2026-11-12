/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { parseSetupCode, validateHomeKitPin, validateVerhoeff } from '@haus/core';
import type { DetectedProtocol } from './types.js';

/**
 * Detects protocol and format of a setup code in real time as the user types or pastes.
 * Provides honest guidance for unsupported proprietary formats rather than fake success.
 */
export function detectSetupCode(input: string): DetectedProtocol {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      valid: false,
      kind: 'incomplete',
      label: 'Setup code',
      description: 'Enter a Matter QR, HomeKit PIN, Improv, or vendor code.',
      badgeVariant: 'default',
    };
  }

  // 1. Check for proprietary Aqara cloud or proprietary ecosystems
  if (/^aqara[:_-]proprietary/i.test(trimmed) || /^_aqara\./i.test(trimmed)) {
    return {
      valid: false,
      kind: 'unsupported_proprietary',
      label: 'Proprietary Aqara protocol',
      description:
        'This device uses a closed cloud or proprietary Zigbee hub protocol not supported for open local setup.',
      badgeVariant: 'warning',
      honestLimitation:
        'Haus uses open, local-first protocols (Matter, Apple HomeKit, Improv, Zigbee). For Aqara accessories, put the device in Matter pairing mode (look for the Matter QR code) or Apple HomeKit mode.',
    };
  }

  // 2. Matter QR payload (starts with MT:)
  if (/^MT:[A-Z0-9.-]+/i.test(trimmed)) {
    try {
      const parsed = parseSetupCode(trimmed);
      return {
        valid: true,
        kind: 'matter-qr',
        protocol: 'matter',
        label: 'Matter QR Code',
        description: `Matter device (discriminator ${parsed.matter?.discriminator ?? 'unknown'})`,
        badgeVariant: 'primary',
        parsed,
      };
    } catch (err) {
      return {
        valid: false,
        kind: 'invalid',
        protocol: 'matter',
        label: 'Invalid Matter QR',
        description: err instanceof Error ? err.message : 'Invalid Matter QR payload format.',
        badgeVariant: 'danger',
        error: err instanceof Error ? err.message : 'Invalid Matter QR payload',
      };
    }
  }

  // 3. HomeKit setup URI (starts with X-HM://)
  if (/^X-HM:\/\/[A-Z0-9]+/i.test(trimmed)) {
    try {
      const parsed = parseSetupCode(trimmed);
      return {
        valid: true,
        kind: 'homekit-uri',
        protocol: 'homekit',
        label: 'Apple HomeKit Code',
        description: `HomeKit accessory (Setup ID: ${parsed.homekit?.setupId ?? 'unknown'})`,
        badgeVariant: 'secondary',
        parsed,
      };
    } catch (err) {
      return {
        valid: false,
        kind: 'invalid',
        protocol: 'homekit',
        label: 'Invalid HomeKit URI',
        description: err instanceof Error ? err.message : 'Invalid HomeKit setup URI.',
        badgeVariant: 'danger',
        error: err instanceof Error ? err.message : 'Invalid HomeKit URI',
      };
    }
  }

  // 4. Improv prefix
  if (/^improv:/i.test(trimmed)) {
    try {
      const parsed = parseSetupCode(trimmed);
      return {
        valid: true,
        kind: 'improv',
        protocol: 'improv',
        label: 'Improv Wi-Fi',
        description: 'Improv BLE or Serial provisioning',
        badgeVariant: 'primary',
        parsed,
      };
    } catch (err) {
      return {
        valid: false,
        kind: 'invalid',
        protocol: 'improv',
        label: 'Invalid Improv Code',
        description: err instanceof Error ? err.message : 'Invalid Improv code.',
        badgeVariant: 'danger',
        error: err instanceof Error ? err.message : 'Invalid Improv code',
      };
    }
  }

  // 5. Vendor prefixes: shelly:*, esphome:*, tasmota:* (also supports dash/underscore separator)
  const vendorMatch = /^(shelly|esphome|tasmota)[:_-](.*)$/i.exec(trimmed);
  if (vendorMatch) {
    const vName = vendorMatch[1]!.toLowerCase();
    const normalized = `${vName}:${vendorMatch[2] ?? ''}`;
    try {
      const parsed = parseSetupCode(normalized);
      return {
        valid: true,
        kind: 'vendor',
        protocol: 'vendor',
        label: `${parsed.vendor?.vendor.toUpperCase() ?? 'Vendor'} Setup`,
        description: `Local SoftAP/RPC provisioning for ${parsed.vendor?.vendor ?? 'vendor'} device`,
        badgeVariant: 'secondary',
        parsed,
      };
    } catch (err) {
      return {
        valid: false,
        kind: 'invalid',
        protocol: 'vendor',
        label: 'Invalid Vendor Code',
        description: err instanceof Error ? err.message : 'Invalid vendor setup code.',
        badgeVariant: 'danger',
        error: err instanceof Error ? err.message : 'Invalid vendor code',
      };
    }
  }

  // 6. HomeKit 8-digit PIN format: XXX-XX-XXX or 8 continuous digits
  const pinDigits = trimmed.replace(/-/g, '');
  if (/^\d{3}-\d{2}-\d{3}$/.test(trimmed) || (pinDigits.length === 8 && /^\d+$/.test(pinDigits))) {
    const formattedPin =
      pinDigits.length === 8
        ? `${pinDigits.slice(0, 3)}-${pinDigits.slice(3, 5)}-${pinDigits.slice(5, 8)}`
        : trimmed;
    try {
      validateHomeKitPin(formattedPin);
      const parsed = parseSetupCode(formattedPin);
      return {
        valid: true,
        kind: 'homekit-pin',
        protocol: 'homekit',
        label: 'HomeKit Setup PIN',
        description: '8-digit HomeKit pairing PIN',
        badgeVariant: 'secondary',
        parsed,
      };
    } catch (err) {
      return {
        valid: false,
        kind: 'invalid',
        protocol: 'homekit',
        label: 'Weak HomeKit PIN',
        description:
          err instanceof Error
            ? err.message
            : 'This PIN pattern is banned by Apple HomeKit security specifications.',
        badgeVariant: 'danger',
        error: err instanceof Error ? err.message : 'Weak PIN rejected',
      };
    }
  }

  // 7. Matter manual code: 11 or 21 continuous numeric digits
  if (/^\d+$/.test(trimmed)) {
    if (trimmed.length === 11 || trimmed.length === 21) {
      if (validateVerhoeff(trimmed)) {
        try {
          const parsed = parseSetupCode(trimmed);
          return {
            valid: true,
            kind: 'matter-manual',
            protocol: 'matter',
            label: 'Matter Manual Code',
            description: `${trimmed.length}-digit Matter pairing passcode (Verhoeff checksum verified)`,
            badgeVariant: 'primary',
            parsed,
          };
        } catch (err) {
          return {
            valid: false,
            kind: 'invalid',
            protocol: 'matter',
            label: 'Invalid Matter Code',
            description: err instanceof Error ? err.message : 'Invalid Matter manual code.',
            badgeVariant: 'danger',
            error: err instanceof Error ? err.message : 'Invalid Matter code',
          };
        }
      }
      return {
        valid: false,
        kind: 'invalid',
        protocol: 'matter',
        label: 'Matter Checksum Failed',
        description: 'The Verhoeff checksum digit does not match. Check the numbers on the device.',
        badgeVariant: 'danger',
        error: 'Verhoeff checksum failure',
      };
    }

    if (trimmed.length < 8) {
      return {
        valid: false,
        kind: 'incomplete',
        label: 'Incomplete Code',
        description: `Entered ${trimmed.length} digits. HomeKit PIN requires 8 digits, Matter manual code requires 11 or 21 digits.`,
        badgeVariant: 'default',
      };
    }

    if (trimmed.length > 8 && trimmed.length < 11) {
      return {
        valid: false,
        kind: 'incomplete',
        label: 'Incomplete Matter Code',
        description: `Entered ${trimmed.length} digits. Matter manual pairing code requires 11 digits.`,
        badgeVariant: 'default',
      };
    }

    return {
      valid: false,
      kind: 'ambiguous',
      label: 'Ambiguous Numeric Code',
      description: `Entered ${trimmed.length} digits. Expected 8 digits for HomeKit, or 11/21 digits for Matter.`,
      badgeVariant: 'warning',
    };
  }

  return {
    valid: false,
    kind: 'invalid',
    label: 'Unrecognized Code',
    description:
      'Enter an 8-digit HomeKit PIN (e.g. 123-45-679), Matter QR (MT:...), 11-digit Matter manual code, Improv, or vendor code.',
    badgeVariant: 'default',
  };
}
