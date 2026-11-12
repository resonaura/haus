# Code-First Device Onboarding UI Experience (P20.12)

## Overview & Architecture

P20.12 connects the accepted protocol and radio onboarding pipelines (Matter over IP/BLE/Thread, HomeKit IP/BLE, Improv BLE/Serial, and documented vendor SoftAP/RPC) to a unified, cross-platform code-first user experience.

Rather than forcing users to guess brand categories, browse manual integration directories, or suffer silent pairing errors, onboarding starts directly with a setup code:
1. **Code Entry & Real-Time Protocol Detection:**
   Users enter or paste a setup code (Matter QR code, 11/21-digit Matter manual code, 8-digit HomeKit PIN, HomeKit setup URI, Improv identifier, or documented vendor code). As the user types, `detectSetupCode` validates formats and Verhoeff dihedral group $D_5$ checksums in real time, displays protocol badges, and enforces security specifications (rejecting banned weak HomeKit PIN patterns `000-00-000`, `123-45-678`, etc.).
2. **Honest Boundaries & Proprietary Protocols:**
   Proprietary protocols (such as closed `_aqara` Zigbee hubs or cloud-only devices) are truthfully classified (`unsupported_proprietary`) with actionable instructions to use open pairing modes (Matter or Apple HomeKit) rather than displaying fake success screens or failing silently.
3. **Nearby Discovery & Candidate Selection:**
   When multiple candidates match nearby, an animated discovery radar presents candidate devices with signal RSSI, transport protocol (`LAN` or `BLE`), and network addresses, letting the user explicitly select the intended hardware.
4. **Just-in-Time Network Credentials:**
   Wi-Fi SSID/passwords and Thread datasets are requested **only** when the device requires network provisioning (`OBTAIN_NETWORK_CREDENTIALS`). Passwords are zeroized in volatile memory immediately after transmission. Users can optionally save credentials in encrypted storage on the Hub for future devices.
5. **Bounded Pairing Progress:**
   A bounded progress timeline visualizes the exact physical lifecycle phases (secure channel negotiation -> network joining -> IP rediscovery -> permanent controller pairing -> capability audit) with live event streaming.
6. **Room Placement & Verified Completion:**
   Upon verified commissioning, device model details and functional capabilities are confirmed, and the user can immediately place the device into a room from `snapshot.areas`.

## File Structure & Directory Bounds

- `apps/desktop/src/main/hub/commissioning.ts`: Validated Hub commissioning client for Desktop main process.
- `apps/desktop/src/main/hub/commissioning.test.ts`: Desktop main process commissioning routing tests.
- `apps/desktop/src/main/hub/connection.ts`: Wired `HubCommissioningClient` and `HubHomeKitPublishing` into `HubConnection.management`.
- `apps/desktop/src/renderer/src/features/commissioning/`: Dedicated directory (6 direct files $\le 25$).
  - `types.ts`: Strongly typed UI session state and protocol representations without explicit `any`.
  - `protocol-detect.ts`: Real-time parser and validator with honest limitation handling.
  - `useCommissioningSession.ts`: React hook managing session transactions, polling with `sinceSeq`, and retry.
  - `CodeFirstCommissioningDialog.tsx`: Multi-stage interactive modal.
  - `index.ts`: Modular exports.
  - `code-first.test.ts`: Vitest test suite for protocol detection and hook lifecycle.
- `apps/desktop/src/renderer/src/features/connections/AddDevice.tsx`: Integrated code-first setup as the premier entry point.

## Verification Evidence

- Desktop commissioning client suite: `apps/desktop/src/main/hub/commissioning.test.ts` (PASS, 1 test).
- Desktop code-first experience suite: `apps/desktop/src/renderer/src/features/commissioning/code-first.test.ts` (PASS, 13 tests).
- Desktop connection suite: `apps/desktop/src/main/hub/connection.test.ts` (PASS, 9 tests).
- Core & Hub commissioning standalone suites:
  - `apps/hub/test/standalone/commissioning-transaction.test.ts` (PASS)
  - `apps/hub/test/standalone/commissioning-handover.test.ts` (PASS)
  - `apps/hub/test/standalone/matter-commissioning.test.ts` (PASS)
  - `apps/hub/test/standalone/homekit-commissioning.test.ts` (PASS)
  - `apps/hub/test/standalone/improv-commissioning.test.ts` (PASS)
  - `apps/hub/test/standalone/vendor-provisioning.test.ts` (PASS)
  - `packages/core/test/vendor/vendor.test.ts` (PASS)
  - `packages/core/test/commissioning.test.ts` (PASS)
  Total: 8 files, 56 tests passing.
- Engineering rules and architecture verification: `pnpm rules:check`, `pnpm architecture:check`, `pnpm typecheck`, `pnpm lint`.
