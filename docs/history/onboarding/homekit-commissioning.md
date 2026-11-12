# Milestone 20.7 Evidence: HomeKit IP/BLE and Honest Wi-Fi Provisioning

## Executive Summary

Milestone `P20.7` establishes code-first HomeKit IP and BLE commissioning and honest provisioning boundaries within the native Haus architecture. Prior to this milestone, HomeKit pairing in Haus was restricted to IP transports (`_hap._tcp`), lacking direct BLE Pair Setup (M1..M6), Pair Verify (M1..M4), accessory classification, and explicit boundaries around Apple Wireless Accessory Configuration (WAC).

This milestone delivers:
1. **Accessory Classification Engine (`@haus/core`):** Direct classification of accessories into five strict categories (`hap-ip`, `hap-ble`, `vendor-wifi-ble`, `wac-only`, and `vendor-softap`) with protocol-specific validation and actionable guidance.
2. **Honest Provisioning Invariants:** True HAP-BLE communicates permanently over Bluetooth LE GATT; Haus strictly forbids marketing HAP-BLE as Wi-Fi provisioning and refuses to prompt for Wi-Fi credentials when pairing true HAP-BLE accessories.
3. **MFi WAC Entitlement Boundary:** Rejection of WAC-only accessories with explicit error reporting (`wac_unsupported`) referencing the Apple entitlement requirement (`com.apple.external-accessory.wireless-configuration`), preventing brittle "add-to-Apple-Home-then-remove" workarounds.
4. **HAP-BLE Stack & Cryptography (`@haus/homekit`):** Full HAP-BLE PDU framing, chunking, and reassembly; SRP-6a state machine with `fastSrp.SrpClient`; ChaCha20-Poly1305 AEAD with canonical HAP nonces (`'PS-Msg05'`, `'PS-Msg06'`, `'PV-Msg02'`, `'PV-Msg03'`); and Ed25519 controller/accessory key derivation.
5. **Existing Pairing Ownership & Zero Implicit Resets:** Accessories reporting `sf === 0` (or TLV error `0x02`) are rejected with `already_paired`; Haus never implicitly resets an accessory.
6. **Canonical UUID Enforcement:** Explicit rejection of `0xFED3` shortcut as a HAP pairing discovery criterion in favor of canonical `00000055-0000-1000-8000-0026bb765291`.
7. **Hub Commissioning Adapters & Multi-Transport Onboarding (`apps/hub`):** Unified `HomeKitIpAdapter` (aliased as `HomeKitAdapter`) dynamically supporting both HAP-IP and HAP-BLE, integrating with `RadioAgentRegistry` for leased Bluetooth LE access and cold-restart persistence.

---

## Architecture and Contracts

### 1. Accessory Classification Matrix

```
+-------------------+------------------------------------------+----------------------+-----------------------------+
| Classification    | Discovery Clues                          | Direct Commissioning | Requires Wi-Fi Credentials? |
+-------------------+------------------------------------------+----------------------+-----------------------------+
| hap-ip            | _hap._tcp via DNS-SD / Zeroconf          | Yes                  | No                          |
| hap-ble           | Apple Adv (0x4c/0x06), HAP UUID 0x0055   | Yes (via BLE GATT)   | No (Permanent BLE)          |
| vendor-wifi-ble   | HAP-BLE + vendor Wi-Fi characteristic   | Yes                  | Yes                         |
| wac-only          | _wac._tcp, Apple MFi WAC                 | No                   | No (Gated by MFi)           |
| vendor-softap     | Vendor Wi-Fi AP (e.g. 192.168.4.1)       | No                   | Yes                         |
+-------------------+------------------------------------------+----------------------+-----------------------------+
```

### 2. Invariant: Honest Wi-Fi Provisioning
True HAP-BLE devices (e.g. Eve Door & Window, Eve Energy BLE) do not have Wi-Fi hardware. Marketing HAP-BLE as Wi-Fi onboarding confuses users and results in unreachable states. Haus handles true HAP-BLE directly over BLE GATT using leased radio connections and creates persistent Haus devices bound to `ble:<id>`.

### 3. Invariant: Respect Existing Pairing Ownership
Per the HAP specification, an accessory in paired state (`sf=0` in advertisement or state 2 with error 0x02 during Pair Setup) cannot be claimed without physical factory reset. Haus emits clear, transparent guidance and refuses to tamper with existing pair records.

### 4. Invariant: 0xFED3 Rejection
The 16-bit UUID `0xFED3` is not a standard HAP pairing service; relying on it causes pairing failures against standard accessories. Haus canonicalizes to `HAP_PAIRING_SERVICE_UUID` (`00000055-0000-1000-8000-0026bb765291`) and detects/rejects `0xFED3`.

---

## Verification Evidence

### 1. Standalone Hub Onboarding Suite (`apps/hub/test/standalone/homekit-commissioning.test.ts`)
```
 ✓ test/standalone/homekit-commissioning.test.ts (6 tests) 3481ms
   ✓ HomeKit IP/BLE & Honest Provisioning (P20.7) (6)
     ✓ pairs true HAP-BLE accessory honestly over Bluetooth LE without Wi-Fi credentials 913ms
     ✓ respects existing pairing ownership and rejects already-paired accessory (sf=0) 343ms
     ✓ rejects candidate with setup hash mismatch 148ms
     ✓ rejects WAC-only accessories and cites the Apple MFi entitlement requirement 139ms
     ✓ retains HAP pairings across cold Hub restart without re-pairing 609ms
     ✓ executes full REST API onboarding lifecycle for HomeKit via Hub endpoints 1323ms

 Test Files  1 passed (1)
      Tests  6 passed (6)
```

### 2. HomeKit BLE Stack & Codec Suite (`packages/homekit/test/ble.test.ts`)
```
 ✓ test/ble.test.ts (15 tests) 3086ms
   ✓ HomeKit BLE and Classification (P20.7) (15)
     ✓ Classification and Boundaries (4)
     ✓ 0xFED3 Rejection and Canonical UUIDs (2)
     ✓ BLE Advertisement Parsing (2)
     ✓ HAP-BLE PDU Framing and Reassembly (4)
     ✓ HAP-BLE Pair-Setup & Pair-Verify (M1..M6 / M1..M4) (3)

 Test Files  1 passed (1)
      Tests  15 passed (15)
```

### 3. Hub Standalone Regression Suite (`apps/hub/test/standalone/`)
```
 Test Files  17 passed (17)
      Tests  58 passed (58)
   Duration  46.22s
```

### 4. Root Engineering Rules & Compliance
- **Typecheck:** `pnpm typecheck` passed (exit code 0 across all 18 workspace packages).
- **Linter:** `oxlint --deny-warnings` passed (0 warnings, 0 errors on 1703 files).
- **Rule checker:** `pnpm rules:check` passed (zero explicit `any`, file lengths <= 500 lines, directory counts <= 25 files).
- **Architecture checker:** `pnpm architecture:check` passed (452 source files inspected).
- **Whitespace:** `git diff --check` passed cleanly.
