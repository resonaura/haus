/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import { evaluatePlatformCapabilities } from '../../src/commissioning/index.js';

describe('Platform Capability and Permission Matrix (P20.9)', () => {
  describe('Expo Go vs Custom Native Builds', () => {
    it('rejects native BLE and marks onboarding unsupported when running in Expo Go', () => {
      const iosExpoGo = evaluatePlatformCapabilities({
        os: 'ios',
        isExpoGo: true,
      });
      expect(iosExpoGo.isExpoGo).toBe(true);
      expect(iosExpoGo.transportMode).toBe('unsupported');
      expect(iosExpoGo.capabilities.ble_scan).toBe(false);
      expect(iosExpoGo.capabilities.ble_connect).toBe(false);
      expect(iosExpoGo.manualFallbackRequired).toBe(true);
      expect(iosExpoGo.recommendedAction).toContain('custom native build');

      const androidExpoGo = evaluatePlatformCapabilities({
        os: 'android',
        isExpoGo: true,
      });
      expect(androidExpoGo.isExpoGo).toBe(true);
      expect(androidExpoGo.transportMode).toBe('unsupported');
      expect(androidExpoGo.manualFallbackRequired).toBe(true);
    });
  });

  describe('macOS CoreBluetooth & Permissions', () => {
    it('evaluates macOS with granted Bluetooth and Location', () => {
      const caps = evaluatePlatformCapabilities({
        os: 'macos',
        osVersion: '14.4',
        grantedPermissions: {
          bluetooth: true,
          location: true,
        },
      });
      expect(caps.transportMode).toBe('corebluetooth');
      expect(caps.capabilities.ble_scan).toBe(true);
      expect(caps.capabilities.ble_connect).toBe(true);
      expect(caps.capabilities.wifi_info).toBe(true);
      expect(caps.capabilities.thread_credentials).toBe(true);
      expect(caps.manualFallbackRequired).toBe(false);
    });

    it('requires prompt and flags manual fallback when Bluetooth is not granted', () => {
      const caps = evaluatePlatformCapabilities({
        os: 'macos',
        grantedPermissions: {
          bluetooth: false,
        },
      });
      expect(caps.capabilities.ble_scan).toBe(false);
      expect(caps.capabilities.ble_connect).toBe(false);
      expect(caps.permissions.bluetooth.status).toBe('prompt_required');
      expect(caps.manualFallbackRequired).toBe(true);
      expect(caps.limitations.some((l) => l.includes('Bluetooth access denied'))).toBe(true);
    });
  });

  describe('Windows WinRT vs WSL2 Isolation', () => {
    it('evaluates native Windows WinRT without saved passphrase extraction', () => {
      const caps = evaluatePlatformCapabilities({
        os: 'windows',
        osVersion: '10.0.22631',
        isWsl: false,
      });
      expect(caps.transportMode).toBe('winrt');
      expect(caps.capabilities.ble_scan).toBe(true);
      expect(caps.capabilities.ble_connect).toBe(true);
      expect(caps.capabilities.wifi_info).toBe(false);
      expect(caps.capabilities.thread_credentials).toBe(false);
      expect(caps.limitations.some((l) => l.includes('Thread network keychain extraction'))).toBe(
        true,
      );
    });

    it('measures WSL2 isolation: does not infer Bluetooth availability from physical host', () => {
      const caps = evaluatePlatformCapabilities({
        os: 'windows',
        isWsl: true,
        hasUsbipdBridge: false,
        hasVhciDevice: false,
      });
      expect(caps.isWsl).toBe(true);
      expect(caps.transportMode).toBe('remote_radio_rpc');
      expect(caps.capabilities.ble_scan).toBe(false);
      expect(caps.capabilities.ble_connect).toBe(false);
      expect(caps.manualFallbackRequired).toBe(true);
      expect(caps.permissions.bluetooth.status).toBe('unsupported');
      expect(caps.limitations.some((l) => l.includes('WSL2 environment cannot access'))).toBe(true);
      expect(caps.permissions.bluetooth.remediation).toContain('usbipd');
    });

    it('recognizes explicit usbipd-win bridge in WSL2', () => {
      const caps = evaluatePlatformCapabilities({
        os: 'windows',
        isWsl: true,
        hasUsbipdBridge: true,
      });
      expect(caps.transportMode).toBe('native_dbus');
      expect(caps.capabilities.ble_scan).toBe(true);
      expect(caps.capabilities.ble_connect).toBe(true);
      expect(caps.permissions.raw_hci.status).toBe('granted');
    });
  });

  describe('Linux Container Least-Privilege & Multicast', () => {
    it('grants native_dbus when /run/dbus/system_bus_socket is bind-mounted under least privilege', () => {
      const caps = evaluatePlatformCapabilities({
        os: 'linux',
        isContainer: true,
        hasDbusSocket: true,
      });
      expect(caps.transportMode).toBe('native_dbus');
      expect(caps.capabilities.ble_scan).toBe(true);
      expect(caps.capabilities.ble_connect).toBe(true);
      expect(caps.permissions.dbus_system.status).toBe('granted');
    });

    it('denies container Bluetooth when D-Bus socket is missing (refuses broad host access assumption)', () => {
      const caps = evaluatePlatformCapabilities({
        os: 'linux',
        isContainer: true,
        hasDbusSocket: false,
        hasRawHciCapability: false,
      });
      expect(caps.transportMode).toBe('remote_radio_rpc');
      expect(caps.capabilities.ble_scan).toBe(false);
      expect(caps.capabilities.ble_connect).toBe(false);
      expect(caps.manualFallbackRequired).toBe(true);
      expect(caps.permissions.dbus_system.status).toBe('denied');
      expect(caps.permissions.dbus_system.remediation).toContain('system_bus_socket');
    });

    it('detects disabled IPv6 multicast loop and restricts mDNS/Matter discovery', () => {
      const caps = evaluatePlatformCapabilities({
        os: 'linux',
        hasMulticastLoop: false,
      });
      expect(caps.capabilities.mdns_multicast).toBe(false);
      expect(caps.limitations.some((l) => l.includes('IPv6 multicast loop is disabled'))).toBe(
        true,
      );
    });
  });

  describe('iOS Entitlements & Local Network', () => {
    it('evaluates iOS custom native build with CoreBluetooth and ThreadNetwork', () => {
      const caps = evaluatePlatformCapabilities({
        os: 'ios',
        isExpoGo: false,
        grantedPermissions: {
          bluetooth: true,
          local_network: true,
        },
      });
      expect(caps.transportMode).toBe('corebluetooth');
      expect(caps.capabilities.ble_scan).toBe(true);
      expect(caps.capabilities.ble_connect).toBe(true);
      expect(caps.capabilities.thread_credentials).toBe(true);
      expect(caps.capabilities.wifi_info).toBe(false);
    });
  });

  describe('Android Version-Specific Permissions & Scan Filtering', () => {
    it('evaluates Android 12+ (API 31+) requiring BLUETOOTH_SCAN without location', () => {
      const caps = evaluatePlatformCapabilities({
        os: 'android',
        androidApiLevel: 33,
        grantedPermissions: {
          bluetooth: true,
          location: false,
        },
      });
      expect(caps.transportMode).toBe('android_bluetooth');
      expect(caps.capabilities.ble_scan).toBe(true);
      expect(caps.capabilities.ble_connect).toBe(true);
      expect(caps.capabilities.thread_credentials).toBe(true);
      expect(caps.manualFallbackRequired).toBe(false);
    });

    it('evaluates Android <= 11 (API 30) requiring fine location for BLE scanning', () => {
      const withoutLoc = evaluatePlatformCapabilities({
        os: 'android',
        androidApiLevel: 30,
        grantedPermissions: {
          bluetooth: true,
          location: false,
        },
      });
      expect(withoutLoc.capabilities.ble_scan).toBe(false);
      expect(withoutLoc.permissions.location.status).toBe('prompt_required');
      expect(withoutLoc.manualFallbackRequired).toBe(true);

      const withLoc = evaluatePlatformCapabilities({
        os: 'android',
        androidApiLevel: 30,
        grantedPermissions: {
          bluetooth: true,
          location: true,
        },
      });
      expect(withLoc.capabilities.ble_scan).toBe(true);
      expect(withLoc.manualFallbackRequired).toBe(false);
    });
  });
});
