# Documented Vendor Provisioning (P20.11)

## Context & Objectives

Per `PLAN.md` Milestone 20 (Task P20.11):
1. **Documented Vendor SoftAP & RPC Provisioning:** Add vendor adapters for documented, stable local provisioning protocols (Shelly Gen2/Gen3 RPC, Shelly Gen1 HTTP, ESPHome web captive portal, and Tasmota web).
2. **Clear Boundaries on Proprietary Cloud & Aqara:**
   - Distinguish open standards from vendor cloud locks: Aqara devices with Matter or HomeKit capabilities are routed to standard open commissioning (`matter` or `homekit`).
   - Devices advertising proprietary protocols (`_aqara` services or Zigbee hubs without open local Wi-Fi provisioning) are truthfully classified as `unsupported_proprietary` with guidance directing users to Matter bridges or native Zigbee coordinators, strictly avoiding brittle reverse-engineered hacks or fake success screens.
3. **No Long-Term Credential Leakage:**
   - Network credentials (SSID and passphrase) are scoped exclusively to the transient HTTP call and wiped from memory immediately upon completion or error.
   - Zero credential echo in API responses, logs, or error descriptors.

---

## Architecture & Implementation

### 1. Vendor Device Classification (`@haus/core/commissioning`)
* [`packages/core/src/commissioning/vendor.ts`](file:///Users/resonaura/haus/packages/core/src/commissioning/vendor.ts):
  - `classifyVendorDevice()`: Evaluates mDNS service types, device names, and TXT records:
    - **Shelly Gen 2+ (RPC):** Identified by `gen: '2'` or model prefixes (`Plus`, `Pro`, `Gen3`, `Mini`). Uses `shelly-rpc` protocol over port 80.
    - **Shelly Gen 1 (Legacy):** Identified by `SHSW-1`, `shelly1`, `shelly25`, etc. Uses `shelly-gen1` HTTP query parameters over port 80.
    - **ESPHome Web:** Identified by `_esphomelib._tcp` or `esphome` project names. Uses `esphome-web` `/wifisave` form POST.
    - **Tasmota Web:** Identified by `tasmota` friendly names. Uses `tasmota-web` `/wi` form POST.
    - **Aqara Open Standards (Matter/HomeKit):** Identified by TXT records (`md` for Matter discriminator, `sf` / `setup_id` for HomeKit). Returns `protocol: 'aqara-matter-referral'` with discriminator/setup ID.
    - **Aqara Proprietary:** Truthfully identified as `protocol: 'aqara-proprietary'`, rejecting fake local SoftAP claims.

### 2. Provisioning Engine & Security
* `provisionVendorDevice()`:
  - **Shelly RPC:** Dispatches `WiFi.SetConfig` (`id: 1`, `sta: { ssid, pass, enable: true }`) followed by `Shelly.Reboot`. Handles 401 digest authentication.
  - **Shelly Gen1:** Dispatches `GET /settings/sta?enabled=1&ssid=...&key=...`.
  - **ESPHome:** Dispatches `POST /wifisave` with `ssid` and `psk`.
  - **Tasmota:** Dispatches `POST /wi` with `s1` and `p1`.
  - **Aqara Referral:** Returns `status: 'referral_required'`, directing user to the device's Matter QR code or HomeKit PIN.
  - **Aqara Proprietary:** Returns `status: 'unsupported_proprietary'` with clear guidance.
  - **Transient Credential Wipe:** Immediate memory zeroization of `WifiCredentials.password`.

### 3. Hub NestJS Endpoints (`apps/hub/src/commissioning/`)
* [`apps/hub/src/commissioning/vendor.controller.ts`](file:///Users/resonaura/haus/apps/hub/src/commissioning/vendor.controller.ts):
  - `POST /api/commissioning/vendor/classify` (200 OK): Classifies candidate protocol from discovery metadata.
  - `POST /api/commissioning/vendor/provision` (200 OK): Provisions credentials with memory wipe and error mapping.
  - Guarded with `AuthGuard` (rejects unauthenticated requests with 401 Unauthorized).
* [`apps/hub/src/commissioning/vendor.service.ts`](file:///Users/resonaura/haus/apps/hub/src/commissioning/vendor.service.ts):
  - Injectable Nest service logging sanitized actions and managing timeouts.

---

## Verification Evidence

1. **`@haus/core` Unit Tests (`packages/core/test/vendor/vendor.test.ts`):**
   - `classifies Shelly Gen2/Gen3 RPC devices correctly` — PASS
   - `classifies Shelly Gen1 legacy devices correctly` — PASS
   - `classifies ESPHome web captive portal devices` — PASS
   - `classifies Tasmota devices correctly` — PASS
   - `classifies Aqara device with Matter or HomeKit referral` — PASS
   - `classifies Aqara proprietary device honestly without fabricating fake protocol` — PASS
   - `provisions Shelly RPC device via WiFi.SetConfig and Shelly.Reboot` — PASS
   - `reports authentication required for password-protected Shelly devices` — PASS
   - `provisions Shelly Gen1 legacy device via /settings/sta` — PASS
   - `provisions ESPHome web captive portal via /wifisave` — PASS
   - `provisions Tasmota web portal via /wi` — PASS
   - `routes Aqara Matter devices to open standard without cloud lock-in` — PASS
   - `rejects proprietary Aqara devices with truthful boundary guidance` — PASS
2. **Hub Standalone End-to-End Test (`apps/hub/test/standalone/vendor-provisioning.test.ts`):**
   - Authenticated 3-step pairing (`challenge` -> `confirm` -> `pair`).
   - 401 rejection on unauthenticated calls.
   - Live endpoint execution for Shelly Gen2, ESPHome, Tasmota, Aqara Matter referral, and Aqara proprietary rejection.
   - Validation rejection on missing parameters with 400 Bad Request.
   - PASS (1/1 test suite, 14 checks passed).
