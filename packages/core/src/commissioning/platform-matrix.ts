/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export type PlatformOperatingSystem = 'macos' | 'windows' | 'linux' | 'ios' | 'android';

export type RadioCapabilityKind =
  | 'ble_scan'
  | 'ble_connect'
  | 'ble_advertise'
  | 'mdns_multicast'
  | 'wifi_info'
  | 'thread_credentials';

export type PlatformPermissionKind =
  | 'bluetooth'
  | 'location'
  | 'local_network'
  | 'wifi'
  | 'raw_hci'
  | 'dbus_system';

export type PermissionEvaluationStatus =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'prompt_required'
  | 'unsupported';

export interface PermissionEvaluationResult {
  readonly status: PermissionEvaluationStatus;
  readonly rationale?: string;
  readonly remediation?: string;
}

export interface PlatformEnvironmentInput {
  readonly os: PlatformOperatingSystem;
  readonly osVersion?: string;
  readonly isContainer?: boolean;
  readonly isWsl?: boolean;
  readonly isExpoGo?: boolean;
  readonly hasDbusSocket?: boolean;
  readonly hasVhciDevice?: boolean;
  readonly hasUsbipdBridge?: boolean;
  readonly grantedPermissions?: Partial<Record<PlatformPermissionKind, boolean>>;
  readonly hasRawHciCapability?: boolean;
  readonly hasMulticastLoop?: boolean;
  readonly androidApiLevel?: number;
}

export interface PlatformRadioCapabilities {
  readonly os: PlatformOperatingSystem;
  readonly osVersion?: string;
  readonly isContainer: boolean;
  readonly isWsl: boolean;
  readonly isExpoGo: boolean;
  readonly transportMode:
    | 'native_dbus'
    | 'winrt'
    | 'corebluetooth'
    | 'android_bluetooth'
    | 'remote_radio_rpc'
    | 'unsupported';
  readonly capabilities: Readonly<Record<RadioCapabilityKind, boolean>>;
  readonly permissions: Readonly<Record<PlatformPermissionKind, PermissionEvaluationResult>>;
  readonly limitations: readonly string[];
  readonly manualFallbackRequired: boolean;
  readonly recommendedAction: string;
}

/**
 * Evaluates platform capabilities, OS permissions, container boundaries, and radio access.
 * Invariant: Never assume one successful OS proves all five platforms.
 * Invariant: Windows/WSL2 Bluetooth availability must be measured, never inferred from physical host.
 * Invariant: Linux containers must use least privilege (D-Bus bind-mount), not broad --privileged access.
 * Invariant: Expo Go is distinguished from custom native builds and cannot run native BLE modules.
 */
export function evaluatePlatformCapabilities(
  input: PlatformEnvironmentInput,
): PlatformRadioCapabilities {
  const limitations: string[] = [];
  const permissions: Record<PlatformPermissionKind, PermissionEvaluationResult> = {
    bluetooth: { status: 'unsupported' },
    location: { status: 'unsupported' },
    local_network: { status: 'unsupported' },
    wifi: { status: 'unsupported' },
    raw_hci: { status: 'unsupported' },
    dbus_system: { status: 'unsupported' },
  };

  const isContainer = Boolean(input.isContainer);
  const isWsl = Boolean(input.isWsl);
  const isExpoGo = Boolean(input.isExpoGo);

  let transportMode: PlatformRadioCapabilities['transportMode'] = 'unsupported';
  let bleScan = false;
  let bleConnect = false;
  let bleAdvertise = false;
  let mdnsMulticast = input.hasMulticastLoop !== false;
  let wifiInfo = false;
  let threadCreds = false;

  // 1. Mobile Expo Go boundary
  if (isExpoGo) {
    limitations.push(
      'Expo Go does not support custom native BLE modules or background scan filters; custom native build required',
    );
    return {
      os: input.os,
      osVersion: input.osVersion,
      isContainer,
      isWsl,
      isExpoGo: true,
      transportMode: 'unsupported',
      capabilities: {
        ble_scan: false,
        ble_connect: false,
        ble_advertise: false,
        mdns_multicast: mdnsMulticast,
        wifi_info: false,
        thread_credentials: false,
      },
      permissions,
      limitations,
      manualFallbackRequired: true,
      recommendedAction:
        'Create a custom native build via npx expo prebuild or run onboarding via Desktop remote radio agent',
    };
  }

  switch (input.os) {
    case 'macos': {
      transportMode = 'corebluetooth';
      const btGranted = input.grantedPermissions?.bluetooth !== false;
      permissions.bluetooth = btGranted
        ? { status: 'granted' }
        : {
            status: 'prompt_required',
            rationale: 'CoreBluetooth requires NSBluetoothAlwaysUsageDescription permission',
            remediation: 'Grant Bluetooth permission in System Settings -> Privacy & Security -> Bluetooth',
          };
      const locGranted = input.grantedPermissions?.location === true;
      permissions.location = locGranted
        ? { status: 'granted' }
        : {
            status: 'prompt_required',
            rationale: 'Current Wi-Fi SSID prefill on macOS 14+ requires Location Services permission',
            remediation: 'Enable Location Services to allow automatic SSID detection',
          };
      permissions.local_network = { status: 'granted' };
      permissions.wifi = { status: locGranted ? 'granted' : 'restricted' };

      bleScan = btGranted;
      bleConnect = btGranted;
      bleAdvertise = btGranted;
      wifiInfo = locGranted;
      threadCreds = true; // Supported via macOS CoreBluetooth / ThreadNetwork keychain

      if (!btGranted) {
        limitations.push('Bluetooth access denied or not yet prompted on macOS');
      }
      break;
    }

    case 'windows': {
      if (isWsl) {
        // Windows Subsystem for Linux (WSL2) measured isolation
        const hasBridge = Boolean(input.hasUsbipdBridge || input.hasVhciDevice);
        if (hasBridge) {
          transportMode = 'native_dbus';
          bleScan = true;
          bleConnect = true;
          permissions.raw_hci = { status: 'granted' };
          limitations.push('WSL2 using attached USBIP Bluetooth bridge (experimental)');
        } else {
          transportMode = 'remote_radio_rpc';
          bleScan = false;
          bleConnect = false;
          limitations.push(
            'WSL2 environment cannot access Windows host Bluetooth directly without usbipd-win attach; use desktop radio agent or manual IP fallback',
          );
        }
        permissions.bluetooth = {
          status: hasBridge ? 'granted' : 'unsupported',
          rationale: 'WSL2 kernel lacks virtualized Bluetooth controller',
          remediation: 'Run usbipd wsl attach --busid <id> from elevated Windows PowerShell, or run native Windows Desktop app',
        };
      } else {
        // Native Windows 10/11 WinRT
        transportMode = 'winrt';
        const btGranted = input.grantedPermissions?.bluetooth !== false;
        permissions.bluetooth = btGranted
          ? { status: 'granted' }
          : {
              status: 'prompt_required',
              rationale: 'Windows Bluetooth capability required in package manifest',
            };
        bleScan = btGranted;
        bleConnect = btGranted;
        wifiInfo = false; // Windows blocks cleartext passphrase extraction
        threadCreds = false; // Windows has no system ThreadNetwork API
        limitations.push('Windows does not support system Thread network keychain extraction; manual dataset entry required');
      }
      break;
    }

    case 'linux': {
      if (isContainer) {
        // Container least-privilege evaluation: D-Bus socket check
        const hasDbus = Boolean(input.hasDbusSocket);
        if (hasDbus) {
          transportMode = 'native_dbus';
          permissions.dbus_system = { status: 'granted' };
          permissions.bluetooth = { status: 'granted' };
          bleScan = true;
          bleConnect = true;
        } else if (input.hasRawHciCapability) {
          transportMode = 'native_dbus';
          permissions.raw_hci = { status: 'granted' };
          bleScan = true;
          bleConnect = true;
          limitations.push('Container using raw HCI capabilities; bind-mounting /run/dbus/system_bus_socket is preferred for least privilege');
        } else {
          transportMode = 'remote_radio_rpc';
          permissions.dbus_system = {
            status: 'denied',
            rationale: 'Container lacks /run/dbus/system_bus_socket bind mount',
            remediation: 'Bind mount /run/dbus/system_bus_socket:/run/dbus/system_bus_socket:ro in compose volume mounts',
          };
          limitations.push('Linux container has no BlueZ D-Bus socket; Bluetooth transport unavailable locally');
        }
      } else {
        transportMode = 'native_dbus';
        permissions.dbus_system = { status: 'granted' };
        permissions.bluetooth = { status: 'granted' };
        bleScan = true;
        bleConnect = true;
      }

      if (input.hasMulticastLoop === false) {
        mdnsMulticast = false;
        limitations.push('IPv6 multicast loop is disabled on Linux host/container; mDNS and Matter operational discovery restricted');
      }
      break;
    }

    case 'ios': {
      transportMode = 'corebluetooth';
      const btGranted = input.grantedPermissions?.bluetooth !== false;
      permissions.bluetooth = btGranted
        ? { status: 'granted' }
        : {
            status: 'prompt_required',
            rationale: 'iOS requires NSBluetoothAlwaysUsageDescription in Info.plist',
            remediation: 'Grant Bluetooth access in iOS Settings -> Haus',
          };
      const netGranted = input.grantedPermissions?.local_network !== false;
      permissions.local_network = netGranted
        ? { status: 'granted' }
        : {
            status: 'prompt_required',
            rationale: 'iOS requires NSLocalNetworkUsageDescription and Multicast entitlement',
            remediation: 'Grant Local Network access in iOS Settings -> Haus',
          };
      bleScan = btGranted;
      bleConnect = btGranted;
      threadCreds = true; // Apple ThreadNetwork framework supported with entitlement
      wifiInfo = false; // iOS restricts SSID without NEHotspotConfiguration / Location
      break;
    }

    case 'android': {
      transportMode = 'android_bluetooth';
      const apiLevel = input.androidApiLevel ?? 33;
      if (apiLevel >= 31) {
        // Android 12+ (API 31+) uses BLUETOOTH_SCAN and BLUETOOTH_CONNECT
        const btScanGranted = input.grantedPermissions?.bluetooth !== false;
        permissions.bluetooth = btScanGranted
          ? { status: 'granted' }
          : {
              status: 'prompt_required',
              rationale: 'Android 12+ requires BLUETOOTH_SCAN and BLUETOOTH_CONNECT runtime permissions',
              remediation: 'Grant Nearby Devices permission in Android App Info',
            };
        bleScan = btScanGranted;
        bleConnect = btScanGranted;
      } else {
        // Android 11 and lower (API <= 30) requires ACCESS_FINE_LOCATION for BLE scanning
        const locGranted = input.grantedPermissions?.location === true;
        permissions.location = locGranted
          ? { status: 'granted' }
          : {
              status: 'prompt_required',
              rationale: 'Android <= 11 requires Location permission to detect BLE advertisements',
              remediation: 'Grant Location permission in Android App Info',
            };
        const btGranted = input.grantedPermissions?.bluetooth !== false;
        permissions.bluetooth = btGranted ? { status: 'granted' } : { status: 'denied' };
        bleScan = locGranted && btGranted;
        bleConnect = btGranted;
        if (!locGranted) {
          limitations.push('Android <= 11 cannot scan BLE devices without fine location permission');
        }
      }
      threadCreds = true; // Supported via Google Play services Thread Network API
      break;
    }
  }

  const manualFallbackRequired = !bleScan || !bleConnect;
  let recommendedAction = 'Ready for nearby radio onboarding';
  if (manualFallbackRequired) {
    if (limitations.length > 0) {
      recommendedAction = `Manual entry recommended: ${limitations[0]}`;
    } else {
      recommendedAction = 'Bluetooth radio unavailable; use manual setup code or LAN discovery';
    }
  }

  return {
    os: input.os,
    osVersion: input.osVersion,
    isContainer,
    isWsl,
    isExpoGo: false,
    transportMode,
    capabilities: {
      ble_scan: bleScan,
      ble_connect: bleConnect,
      ble_advertise: bleAdvertise,
      mdns_multicast: mdnsMulticast,
      wifi_info: wifiInfo,
      thread_credentials: threadCreds,
    },
    permissions,
    limitations,
    manualFallbackRequired,
    recommendedAction,
  };
}
