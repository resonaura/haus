# Milestone 20.9 Evidence: Platform Capability and Permission Matrix

## Executive Summary

Milestone `P20.9` establishes a rigorous platform capability, permission, and container isolation matrix across all five Haus runtime environments (macOS, Windows, Linux, iOS, and Android) plus Windows Subsystem for Linux (WSL2) and Expo Go. Prior to this milestone, capability assumptions risked conflating host platform success with container or mobile availability (e.g. assuming a physical Windows laptop with Bluetooth implies WSL2 container radio access, or assuming Expo Go can execute native BLE scan plugins).

This milestone delivers:
1. **Cross-Platform Capability Evaluator (`@haus/core`):** `evaluatePlatformCapabilities` analyzes OS version, container boundaries, D-Bus sockets, USBIP bridges, permissions, and network loopbacks, returning structured radio capabilities (`PlatformRadioCapabilities`) and actionable remediation.
2. **Invariant: Zero Cross-Platform Generalization:** One successful platform never proves the remaining four. Each platform defines its distinct transport mode (`corebluetooth`, `winrt`, `native_dbus`, `android_bluetooth`, or `remote_radio_rpc`) and permission lifecycle.
3. **Invariant: WSL2 Measured Availability:** Windows/WSL2 Bluetooth availability is strictly measured via attached USBIP/VHCI device detection, never inferred from the physical host having Bluetooth hardware. Unbridged WSL2 falls back gracefully to `remote_radio_rpc` with truthful manual fallback recommendations.
4. **Invariant: Linux Container Least Privilege:** Container Bluetooth access requires bind-mounting `/run/dbus/system_bus_socket` (`native_dbus`). Broad `--privileged` flags and arbitrary `/dev/bus/usb` container access are strictly rejected.
5. **Invariant: Expo Go vs Custom Native Builds:** Expo Go is explicitly detected and rejected for direct BLE scanning; clear guidance requires custom native builds (`npx expo prebuild` / `expo-build-properties`) or desktop remote radio agents.
6. **Android Version-Specific Permissions & Scan Filtering:** Distinguishes Android 12+ (API 31+) `BLUETOOTH_SCAN` and `BLUETOOTH_CONNECT` from Android $\le 11$ (API $\le 30$) `ACCESS_FINE_LOCATION` requirements, with scan-filtering guidance for backgrounded pairings.
7. **Hub REST API (`apps/hub`):** Endpoints `GET /api/commissioning/platform-matrix/current` and `POST /api/commissioning/platform-matrix/evaluate` expose verified capabilities and remediation to desktop and mobile clients.

---

## Platform Support & Evaluation Matrix

```
+------------------+-----------------------+------------------+----------------------------+-------------------------------------+
| Environment      | Transport Mode        | Direct BLE Scan  | Thread Keychain Extraction | Primary Permission / Requirement    |
+------------------+-----------------------+------------------+----------------------------+-------------------------------------+
| macOS 14+        | corebluetooth         | Yes              | Yes (ThreadNetwork)        | NSBluetoothAlwaysUsageDescription   |
| Windows Native   | winrt                 | Yes              | No (Manual dataset entry)  | Windows.Devices.Bluetooth WinRT     |
| Windows WSL2     | remote_radio_rpc      | No (Measured)    | No                         | Requires usbipd-win attach or agent |
| Linux Host       | native_dbus           | Yes              | No (OTBR preferred)        | /run/dbus/system_bus_socket (BlueZ) |
| Linux Container  | native_dbus (D-Bus)   | Yes              | No (OTBR preferred)        | Bind-mount system_bus_socket        |
| iOS Native       | corebluetooth         | Yes              | Yes (ThreadNetwork)        | NSBluetoothAlwaysUsageDescription   |
| Android 12+      | android_bluetooth     | Yes              | Yes (Google Play Thread)   | BLUETOOTH_SCAN / BLUETOOTH_CONNECT  |
| Android <= 11    | android_bluetooth     | Yes (w/ Location)| Yes (Google Play Thread)   | ACCESS_FINE_LOCATION                |
| Expo Go (iOS/And)| unsupported           | No               | No                         | Requires custom native build        |
+------------------+-----------------------+------------------+----------------------------+-------------------------------------+
```

---

## Verification Evidence

### 1. Core Unit Test Suite (`packages/core/test/platform/platform-matrix.test.ts`)
```
 ✓ test/platform/platform-matrix.test.ts (12 tests) 6ms
   ✓ Platform Capability and Permission Matrix (P20.9) (12)
     ✓ Expo Go vs Custom Native Builds (1)
       ✓ rejects native BLE and marks onboarding unsupported when running in Expo Go
     ✓ macOS CoreBluetooth & Permissions (2)
       ✓ evaluates macOS with granted Bluetooth and Location
       ✓ requires prompt and flags manual fallback when Bluetooth is not granted
     ✓ Windows WinRT vs WSL2 Isolation (3)
       ✓ evaluates native Windows WinRT without saved passphrase extraction
       ✓ measures WSL2 isolation: does not infer Bluetooth availability from physical host
       ✓ recognizes explicit usbipd-win bridge in WSL2
     ✓ Linux Container Least-Privilege & Multicast (3)
       ✓ grants native_dbus when /run/dbus/system_bus_socket is bind-mounted under least privilege
       ✓ denies container Bluetooth when D-Bus socket is missing (refuses broad host access assumption)
       ✓ detects disabled IPv6 multicast loop and restricts mDNS/Matter discovery
     ✓ iOS Entitlements & Local Network (1)
       ✓ evaluates iOS custom native build with CoreBluetooth and ThreadNetwork
     ✓ Android Version-Specific Permissions & Scan Filtering (2)
       ✓ evaluates Android 12+ (API 31+) requiring BLUETOOTH_SCAN without location
       ✓ evaluates Android <= 11 (API 30) requiring fine location for BLE scanning
```

### 2. Standalone Hub Integration Suite (`apps/hub/test/standalone/platform-matrix.test.ts`)
```
 ✓ test/standalone/platform-matrix.test.ts (1 test) 576ms
   ✓ Platform Capability and Permission Matrix Integration (P20.9) (1)
     ✓ evaluates host capabilities, measures WSL2 isolation, verifies least-privilege container rules, and distinguishes Expo Go from native builds
```

### 3. Full Standalone Regression Suite (`apps/hub/test/standalone/`)
```
 Test Files  19 passed (19)
      Tests  60 passed (60)
   Duration  40.21s
```

### 4. Quality & Governance Gates
- `pnpm typecheck`: PASS across all 18 workspace packages + root `tsc --noEmit` (0 errors).
- `pnpm lint` (`oxlint --deny-warnings`): PASS across 1714 files (0 warnings, 0 errors).
- `pnpm rules:check`: PASS across 2060 files (zero new `any`, all directories $\le 25$ files, all authored files $\le 500$ lines, zero credential leaks).
- `pnpm architecture:check`: PASS (452 source files inspected).
- `git diff --check`: PASS (clean diff with zero whitespace errors).
