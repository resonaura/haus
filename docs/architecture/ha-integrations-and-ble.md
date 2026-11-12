# Universal Home Assistant Integrations & BLE Subsystem Architecture

## 1. Context and User Directives

Per user directive (2026-11-12):
1. **Focus Shift:** Defer mobile application work; prioritize 100% out-of-the-box support for all Home Assistant integrations.
2. **Elimination of `unsupported_flow`:** The Haus Hub must never abort configuration flows for valid catalog integrations.
3. **Dynamic Upstream Sync & Caching:** Upgrade beyond the frozen 2024.12.5 catalog to the active 2026 upstream (`2026.11.1`), providing tiered caching for instant offline boot and background sync.
4. **BLE Ecosystem & Zero-Touch Xiaomi Migration:** Support BLE sensors and controls natively. Crucially: migrate Xiaomi BLE wireless dimmer switches (`YLKG07YL` / `YLKG08YL`) while preserving pairing keys (`bindkey`), requiring **zero physical re-pairing or button presses** on devices installed in hard-to-reach locations.

---

## 2. Xiaomi BLE Wireless Dimmer Switches: Migration Without Re-Pairing

### 2.1 Cryptographic & Physical Mechanics
Xiaomi BLE switches (specifically Yeelight `YLKG07YL` and `YLKG08YL` rotary dimmers) do **not** establish a continuous, bidirectional, paired GATT connection with a specific coordinator. Instead, they operate as **event-driven broadcast beacons** using **MiBeacon V3 / V4 encrypted advertisements**:
* When a user presses, double-presses, holds, or rotates the physical knob, the microcontroller wakes up, increments an internal sequence counter, and broadcasts BLE advertisement packets containing the event payload (e.g., `rotate_left`, `rotate_right`, `press`).
* The payload is encrypted with a symmetric 12-byte / 16-byte key: the **`bindkey`**.
* The switch transmits blind broadcasts to the air; it does **not** know or care what hub or receiver is listening.

### 2.2 Household Inventory & Saved Credentials
In the user's active Home Assistant setup, both dimmer switches already had their bindkeys negotiated and saved in the Home Assistant configuration entries:
1. **Living Room Dimmer Switch (`Dimmer Switch 7D98`):**
   * MAC Address: `F8:24:41:C5:7D:98`
   * Model: `YLKG07YL/YLKG08YL`
   * `bindkey`: `"eb8dea5be36d8f96d86bbc4a"`
   * Event Types: `['press', 'long_press', 'rotate_left', 'rotate_right', 'rotate_left_pressed', 'rotate_right_pressed']`
2. **Narnia Entry Dimmer Switch (`Dimmer Switch A96F`):**
   * MAC Address: `F8:24:41:C5:A9:6F`
   * Model: `YLKG07YL/YLKG08YL`
   * `bindkey`: `"ab072b13cef7ab58f9f7aabf"`
   * Event Types: `['press', 'long_press', 'rotate_left', 'rotate_right', 'rotate_left_pressed', 'rotate_right_pressed']`

### 2.3 Verdict on Migration Feasibility
**Ответ: ДА.**
* **Физический доступ не требуется:** Пользователю **НЕ нужно** снимать выключатели со стен, лезть в труднодоступные места или зажимать сервисные кнопки сброса/сопряжения.
* **Бесшовный перенос:** Haus Hub импортирует связку `MAC + bindkey` в свой BLE-диспетчер. Как только хаб начинает слушать Bluetooth LE эфир через локальный адаптер или удаленный `RadioAgent`, он немедленно расшифровывает широковещательные пакеты обоих выключателей.
* **Параллельная работа:** Home Assistant и Haus Hub могут одновременно принимать события с этих выключателей без взаимных помех.

---

## 3. Dynamic HA Catalog Architecture (`@haus/ha` & `apps/hub`)

### 3.1 Upstream Release Tracking (`2026.11.1`)
* Pinned baseline `2024.12.5` was a frozen snapshot for early migration tests. Upstream Home Assistant Core is currently at release **`2026.11.1`** (PyPI & GitHub API).
* `DynamicCatalogService` queries `https://api.github.com/repos/home-assistant/core/releases/latest` and PyPI `https://pypi.org/pypi/homeassistant/json` with conditional `If-None-Match` / `ETag` headers.

### 3.2 Tiered Caching Strategy
1. **Tier 1 (Instant Cold Boot):** Embedded baseline in `packages/ha/data/ha-catalog-2024.12.5.json.gz` guarantees 0ms startup without external dependencies or network access.
2. **Tier 2 (Persistent Local Cache):** Stored at `<dataDirectory>/cache/ha-catalog-latest.json.gz` with computed SHA-256 integrity verification.
3. **Tier 3 (Background Sync):** Periodic background sync (configurable TTL, default 7 days) and manual trigger (`POST /api/catalog/refresh`). When a new release tag is detected:
   * Downloads and parses `manifest.json` entries.
   * Compiles compressed catalog index.
   * Atomically swaps the active in-memory catalog without restarting the Hub process.

---

## 4. Universal Config Flow Engine (`@haus/core` & `apps/hub`)

### 4.1 Root Cause of `unsupported_flow`
Previous implementation in `packages/core/src/commissioning/flow-engine.ts` used a hardcoded dictionary `KNOWN_FLOW_DOMAINS` of only 14 entries. Any domain outside that list resulted in an immediate abort step:
```typescript
if (!def) {
  initialStep = { type: 'abort', reason: 'unsupported_flow', ... };
}
```
And `apps/desktop/src/main/hub/flow-entries.ts` only returned 12 items in `buildHubManifests()`.

### 4.2 Dynamic Flow Resolution
1. **Removal of Hardcoded Barriers:** Replace static dictionary with dynamic resolver linked to `HaIntegrationCatalog`.
2. **Manifest-Driven Form Generation:** For any domain with `config_flow: true`, dynamically generate schema fields based on the integration manifest and IoT class:
   * **Network / IP (`local_push`, `local_polling`):** `host` / `ip_address`, `port` (with default), `username`, `password`, `api_key` / `access_token`.
   * **Cloud Services (`cloud_push`, `cloud_polling`):** account credentials, API tokens, or OAuth authorization URLs.
   * **BLE / Radio (`bluetooth`):** candidate selection from discovered BLE devices with MAC, local name, and bindkey prompt.
   * **Zero-Config (Zeroconf / SSDP / DHCP discovery):** single-click confirmation step.
3. **Flow Handlers Exposure:** `GET config/config_entries/flow_handlers` serves all 1,300+ integrations from the dynamic catalog to Desktop and Web clients.

---

## 5. Dynamic Bluetooth LE Architecture (Zero Hardcoded Decoders)

### 5.1 Manifest-Driven Matching
Per architectural principle and user directive, Haus **never hardcodes vendor-specific BLE decoders** (no bespoke `xiaomi.ts`, `bthome.ts`, `govee.ts`, etc.).
Instead, BLE device discovery and routing are driven 100% dynamically from upstream integration manifests:
1. **Manifest Matcher Rules (`manifest.json`):**
   * Home Assistant integration manifests declare their Bluetooth matching criteria:
     * `service_data_uuid` (e.g., `0xFE95` for `xiaomi_ble`, `0xFCD2` for `bthome`)
     * `service_uuid`
     * `manufacturer_id` (e.g., `0xEC88` for Govee)
     * `local_name` patterns
2. **Dynamic Discovery Evaluation (`matchesDiscoveryRule`):**
   * Discovered BLE advertisements from local host radios or remote `RadioAgent` instances are evaluated against active catalog manifests.
   * Matching advertisements dynamically resolve to their integration domain (e.g. `xiaomi_ble`, `bthome`, `qingping`, `inkbird`, `govee_ble`) without custom TypeScript decoder files.

### 5.2 Dynamic Flow & Config Entry Storage
* When a BLE device is selected in the discovery list, `IntegrationFlowEngine` dynamically launches the configuration flow for that domain.
* The device's MAC address and optional encryption credentials (`bindkey`) are submitted through the flow and persisted in TypeORM SQLite `config_entries` (`domain`, `entry_id`, `data: { mac, bindkey, ... }`).
* **Zero Hardcoding Invariant:** Device MAC addresses, keys, and vendor decoders are strictly prohibited in application constants or source code. All runtime parameters reside in the dynamic database catalog and user configuration entries.

---

## 6. Universal Integration Runtime Bridge

* **Dynamic Config Entries:** All completed flows create standard `ConfigEntry` records in TypeORM SQLite.
* **Universal Execution (`@haus/kitsune`):**
  * The Python sidecar / integration harness loads the upstream integration package dynamically on demand.
  * Integration-provided event decoders (e.g. `xiaomi-ble`, `bthome-ble`, etc.) process encrypted BLE advertisement packets inside the integration runtime using the persisted `bindkey`.
  * Generated state entities (`sensor`, `binary_sensor`, `switch`, `light`, `event`) are mapped into canonical `HausDevice` and `HausEndpoint` models with bidirectional control.

---

## 7. Implementation Roadmap & Verification Gates

| Phase | Component | Deliverable | Acceptance Verification |
| :--- | :--- | :--- | :--- |
| **Phase 1** | Dynamic Catalog | `DynamicCatalogService`, PyPI/GitHub sync, tiered disk cache | Unit tests verifying online fetch (`2026.11.1`), cache fallback, and SHA-256 integrity |
| **Phase 2** | Config Flow Engine | Universal `IntegrationFlowEngine` dynamic resolver | Verification that arbitrary HA catalog domains open forms without `unsupported_flow` |
| **Phase 3** | Dynamic BLE Matching | Manifest-driven `service_data_uuid` / `service_uuid` matching | Unit tests verifying zero hardcoded vendor decoders and dynamic manifest matching |
| **Phase 4** | Flow Handlers API | Hub controller & Desktop `flow-entries.ts` updates | UI / API tests verifying discovery and flow initiation across catalog |
| **Phase 5** | End-to-End Test | Standalone integration test suite in `apps/hub/test/standalone/` | End-to-end device setup and entity projection passing all workspace checks |
