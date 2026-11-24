/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { parseSetupCode, validateHomeKitPin, validateVerhoeff } from '../commissioning/code-parser.js';
import type { CommissioningProtocol, ParsedSetupCode } from '../commissioning/types.js';

export type SetupCodeDetectionKind =
  | 'matter-qr'
  | 'matter-manual'
  | 'homekit-uri'
  | 'homekit-pin'
  | 'improv'
  | 'vendor'
  | 'unsupported_proprietary'
  | 'incomplete'
  | 'ambiguous'
  | 'invalid';

export type SetupCodeBadgeTone = 'default' | 'primary' | 'secondary' | 'warning' | 'danger';

export interface DetectedSetupCode {
  readonly valid: boolean;
  readonly kind: SetupCodeDetectionKind;
  readonly protocol?: CommissioningProtocol;
  readonly label: string;
  readonly description: string;
  readonly badgeTone: SetupCodeBadgeTone;
  readonly parsed?: ParsedSetupCode;
  readonly error?: string;
  readonly honestLimitation?: string;
}

function invalidCode(
  label: string,
  description: string,
  protocol?: CommissioningProtocol,
  badgeTone: SetupCodeBadgeTone = 'danger',
): DetectedSetupCode {
  return {
    valid: false,
    kind: 'invalid',
    ...(protocol ? { protocol } : {}),
    label,
    description,
    badgeTone,
    error: description,
  };
}

export function detectSetupCodeFormat(input: string): DetectedSetupCode {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      valid: false,
      kind: 'incomplete',
      label: 'Setup code',
      description: 'Enter a Matter QR, HomeKit PIN, Improv, or vendor code.',
      badgeTone: 'default',
    };
  }

  if (/^aqara[:_-]proprietary/i.test(trimmed) || /^_aqara\./i.test(trimmed)) {
    return {
      valid: false,
      kind: 'unsupported_proprietary',
      label: 'Proprietary Aqara protocol',
      description:
        'This device uses a closed cloud or proprietary Zigbee hub protocol not supported for open local setup.',
      badgeTone: 'warning',
      honestLimitation:
        'Haus uses open, local-first protocols (Matter, Apple HomeKit, Improv, Zigbee). Put Aqara accessories in Matter or HomeKit pairing mode to pair locally.',
    };
  }

  if (/^MT:[A-Z0-9.-]+/i.test(trimmed)) {
    try {
      const parsed = parseSetupCode(trimmed);
      return {
        valid: true,
        kind: 'matter-qr',
        protocol: 'matter',
        label: 'Matter QR Code',
        description: `Matter device (discriminator ${parsed.matter?.discriminator.value ?? 'unknown'})`,
        badgeTone: 'primary',
        parsed,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid Matter QR payload format.';
      return invalidCode('Invalid Matter QR', msg, 'matter');
    }
  }

  if (/^X-HM:\/\/[A-Z0-9]+/i.test(trimmed)) {
    try {
      const parsed = parseSetupCode(trimmed);
      return {
        valid: true,
        kind: 'homekit-uri',
        protocol: 'homekit',
        label: 'Apple HomeKit Code',
        description: `HomeKit accessory (Setup ID: ${parsed.homekit?.setupId ?? 'unknown'})`,
        badgeTone: 'secondary',
        parsed,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid HomeKit setup URI.';
      return invalidCode('Invalid HomeKit URI', msg, 'homekit');
    }
  }

  if (/^improv:/i.test(trimmed)) {
    try {
      const parsed = parseSetupCode(trimmed);
      return {
        valid: true,
        kind: 'improv',
        protocol: 'improv',
        label: 'Improv Wi-Fi',
        description: 'Improv BLE or Serial provisioning',
        badgeTone: 'primary',
        parsed,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid Improv code.';
      return invalidCode('Invalid Improv Code', msg, 'improv');
    }
  }

  const vendorMatch = /^(shelly|esphome|tasmota)[:_-](.*)$/i.exec(trimmed);
  if (vendorMatch) {
    const vendorName = (vendorMatch[1] ?? '').toLowerCase();
    try {
      const parsed = parseSetupCode(`${vendorName}:${vendorMatch[2] ?? ''}`);
      return {
        valid: true,
        kind: 'vendor',
        protocol: 'vendor',
        label: `${parsed.vendor?.vendor.toUpperCase() ?? 'Vendor'} Setup`,
        description: `Local SoftAP/RPC provisioning for ${parsed.vendor?.vendor ?? 'vendor'} device`,
        badgeTone: 'secondary',
        parsed,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid vendor setup code.';
      return invalidCode('Invalid Vendor Code', msg, 'vendor');
    }
  }

  const pinDigits = trimmed.replaceAll('-', '');
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
        badgeTone: 'secondary',
        parsed,
      };
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'This PIN pattern is banned by Apple HomeKit security specifications.';
      return invalidCode('Weak HomeKit PIN', msg, 'homekit');
    }
  }

  if (/^\d+$/.test(trimmed)) {
    if (trimmed.length === 11 || trimmed.length === 21) {
      if (!validateVerhoeff(trimmed)) {
        return invalidCode(
          'Matter Checksum Failed',
          'The Verhoeff checksum digit does not match. Check the numbers on the device.',
          'matter',
        );
      }
      try {
        const parsed = parseSetupCode(trimmed);
        return {
          valid: true,
          kind: 'matter-manual',
          protocol: 'matter',
          label: 'Matter Manual Code',
          description: `${trimmed.length}-digit Matter pairing passcode (Verhoeff checksum verified)`,
          badgeTone: 'primary',
          parsed,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Invalid Matter manual code.';
        return invalidCode('Invalid Matter Code', msg, 'matter');
      }
    }

    if (trimmed.length < 8) {
      return {
        valid: false,
        kind: 'incomplete',
        label: 'Incomplete Code',
        description: `Entered ${trimmed.length} digits. HomeKit PIN requires 8 digits, Matter manual code requires 11 or 21 digits.`,
        badgeTone: 'default',
      };
    }

    if (trimmed.length > 8 && trimmed.length < 11) {
      return {
        valid: false,
        kind: 'incomplete',
        label: 'Incomplete Matter Code',
        description: `Entered ${trimmed.length} digits. Matter manual pairing code requires 11 digits.`,
        badgeTone: 'default',
      };
    }

    return {
      valid: false,
      kind: 'ambiguous',
      label: 'Ambiguous Numeric Code',
      description: `Entered ${trimmed.length} digits. Expected 8 digits for HomeKit, or 11/21 digits for Matter.`,
      badgeTone: 'warning',
    };
  }

  return {
    valid: false,
    kind: 'invalid',
    label: 'Unrecognized Code',
    description:
      'Enter an 8-digit HomeKit PIN (e.g. 482-91-635), Matter QR (MT:...), 11-digit Matter manual code, Improv, or vendor code.',
    badgeTone: 'default',
  };
}

export function computeCommissioningHint(error?: string): string | null {
  if (!error) return null;
  const lower = error.toLowerCase();
  if (lower.includes('deadline') || lower.includes('timeout')) {
    return 'The pairing window closed. Power cycle the device or press its setup button to re-enter pairing mode, then retry.';
  }
  if (lower.includes('pin') || lower.includes('code') || lower.includes('auth')) {
    return 'The device rejected the setup passcode. Verify the digits printed on the device label and try again.';
  }
  if (lower.includes('weak') || lower.includes('banned')) {
    return 'This setup PIN pattern is disallowed by the security specification. Use the unique factory PIN.';
  }
  if (lower.includes('network') || lower.includes('wifi') || lower.includes('ssid')) {
    return 'The device could not connect to Wi-Fi. Check the password and ensure the network supports 2.4 GHz.';
  }
  if (lower.includes('ble') || lower.includes('bluetooth') || lower.includes('radio')) {
    return 'Bluetooth communication was interrupted. Move the device closer to your computer or Hub and try again.';
  }
  if (lower.includes('candidate_not_found')) {
    return 'The selected device is no longer visible on the network. Check its power and retry discovery.';
  }
  return 'Review the error details and try pairing again.';
}
