# Deferred code-first onboarding

Updated: 2026-11-09. Active extension of `PLAN.md`, Milestone 20, executed after migration readiness (P18) and home/Hub lifecycle (P19). The [complete supplied research](../history/onboarding/source.txt) is preserved unchanged as reference data; its embedded citation identifiers are unresolved and its recommendations are not proof of API availability or implemented behavior.

## Task status

- [ ] **P20.1 Resumable commissioning transaction.**
- [ ] **P20.2 Validated setup-code parsing.**
- [ ] **P20.3 LAN discovery and IP handover.**
- [ ] **P20.4 Nearby radio agents and transport.**
- [ ] **P20.5 Matter IP/BLE/Wi-Fi/Thread commissioning.**
- [ ] **P20.6 Improv BLE/serial provisioning.**
- [ ] **P20.7 HAP-IP/BLE and WAC boundaries.**
- [ ] **P20.8 Wi-Fi/Thread credential providers.**
- [ ] **P20.9 Platform capabilities and permissions.**
- [ ] **P20.10 Remote Matter commissioning handoff.**
- [ ] **P20.11 Documented vendor provisioning.**
- [ ] **P20.12 Cross-platform code-first UI and acceptance.**

## Product contract

Start with scanning/entering a setup code. Discover a matching device on LAN, then use an available nearby radio agent if needed. Ask for Wi-Fi/Thread network credentials only when provisioning requires them; complete pairing, verify actual state/control and place the device in the Haus home. The Hub owns the permanent controller identity.

Keep three distinct flows:

1. P19 adds/creates/transfers Haus Hubs and homes.
2. P20 commissions a physical device into Haus.
3. P18.10 publishes selected Haus devices into Apple Home.

Reuse `packages/core/src/commissioning/`, Hub commissioning orchestration and existing Matter/HomeKit adapters before adding another framework or package. Candidate dependencies and protocol details from the research require current primary-source verification, version pinning, license review and platform tests. New package names remain one word; create a package only at a demonstrated consumer boundary.

## P20.1 — Audit and define one resumable transaction

- [ ] Review the current code parser, commissioning service, radio/Improv and Matter/HomeKit adapters and their consumers/tests. Distinguish real operations from prototype paths; preserve behavior and identities already relied upon.
- [ ] Model a stable `commissioningId`, authenticated home/Hub/user binding, typed events, deadlines, cancellation and recovery after client/network loss. Reopening a screen must not restart physical pairing or create another owner.
- [ ] Cover parse → LAN discovery → radio discovery → candidate selection → required network credentials → secure channel → provisioning → IP rediscovery → final pairing → verification → completion/failure. Implement protocol-specific transitions through adapters rather than forcing all protocols through every stage.

Acceptance: contract/consumer checks demonstrate resume, cancellation, stale events, wrong-home access, duplicate attempts and partial failure without duplicate physical actions.

## P20.2 — Parse codes with the real protocol libraries

- [ ] Support raw Matter `MT:` QR and 11/21-digit manual payloads, HomeKit `X-HM://` URIs and formatted PINs; retain the original payload securely. Validate checksum/format and use the stack's decoder instead of copied bit extraction.
- [ ] Preserve full/short discriminator semantics, vendor/product hints and rendezvous capabilities where supplied. An ambiguous bare numeric passcode requires context rather than guessing a protocol.
- [ ] Route Improv/vendor identification through a supported parser/discovery flow; do not assume they all carry Matter/HomeKit setup codes.

Acceptance: valid/invalid test vectors, ambiguous input, normalization and matching to an actual discovered candidate; codes/secrets absent from logs and ordinary UI state.

## P20.3 — LAN discovery and network handover

- [ ] Reuse P18.8's deduplicated discovery service. Validate protocol-specific DNS-SD matchers for HAP-IP, Matter commissionable/operational nodes, ESPHome and supported vendor announcements against current sources.
- [ ] Match identity/discriminator/pairing availability, refresh expiring candidates and expose manual fallback. Do not treat an mDNS name, IP or unicast UDP-5353 sweep as identity/authentication.
- [ ] After network provisioning, have the Hub watch for IP-side reappearance and continue the correct secure protocol. Handle address changes, temporary BLE loss and incomplete network joins with bounded timeouts.

Acceptance: on-network devices, stale/duplicate/mismatched advertisements, cancellation and BLE-to-IP handover on an isolated network; record IPv6/multicast limitations explicitly.

## P20.4 — Radio agents and transport boundaries

- [ ] Define/reuse bounded `RadioAgent`, `NetworkCredentialProvider` and `CommissioningAdapter` ports, composed through constructors. The nearby Electron/mobile client supplies transport; Hub orchestration remains protocol-neutral.
- [ ] Register available Hub, macOS/Windows/Linux desktop and iOS/Android agents with actual capabilities/permissions and liveness. Discover available candidates across permitted agents; select one exclusive transport owner and close all losing/cancelled scans.
- [ ] Design authenticated transport RPC with short-lived transaction-scoped permissions, bounded packets/queues, disconnect handling and sanitized errors. Choose a transport from measured needs; the research's WebSocket/QUIC suggestions are not an instruction to implement both.

Acceptance: a Hub with no local Bluetooth can use an authorized nearby client, while denied/revoked/expired agents cannot read credentials or continue commissioning.

## P20.5 — Matter over IP, BLE, Wi-Fi and Thread

- [ ] Check the current `@haus/matter` stack and the actual matter.js/server APIs before choosing an incremental implementation. Prefer the TypeScript stack where it supplies the required controller/transport boundary; keep `chip-tool` as a reference/interop tool. Do not change a working runtime solely because the research claims another runtime is obsolete.
- [ ] Prove direct IP commissioning and Hub-local BLE commissioning, including discriminator matching, BTP/PASE, fail-safe/regulatory/network configuration, fabric credentials, operational discovery, CASE and completion in the order implemented by the authoritative stack.
- [ ] Provision Wi-Fi SSID/password or a Thread Active Operational Dataset through the appropriate cluster. Treat disappearance of the BLE transport after connecting the network as a handover, not automatic pairing failure.
- [ ] Handle commissioning-window expiry, invalid credentials, reboots and failed completion without losing existing controller/fabric identities or pretending partial setup succeeded.

Acceptance: isolated Matter device/stack interop and actual Wi-Fi/Thread hardware evidence where available; no broad claim of BLE/Thread acceptance from simulated IP tests.

## P20.6 — Improv BLE and serial

- [ ] Compare existing `core`/Hub Improv code with the [official BLE specification](https://www.improv-wifi.com/ble/). Review its SDK before writing another codec. Extract shared transport-neutral logic only when there are real BLE/serial consumers.
- [ ] Cover service/capability discovery, authorization-required/authorized/provisioning/provisioned states, errors, RPC results and supported network scans. Verify advertised service/data identifiers from the current spec.
- [ ] Implement/verify Wi-Fi RPC encoding, UTF-8 lengths, checksum, bounded fragments/reassembly and transfers spanning multiple BLE writes. Serial is a separate framing/transport adapter, not assumed identical to BLE.

Acceptance: official-compatible vectors plus a real supported device, including authorization failure, wrong Wi-Fi password, fragmented messages, disconnect and IP rediscovery.

## P20.7 — HomeKit IP/BLE and honest Wi-Fi provisioning

- [ ] Reuse the actual HAP-IP controller path and verify setup URI/PIN, Pair Setup/Verify, encrypted session, read/write/events, pairing cache and restart persistence. Respect existing pairing ownership; never reset a household accessory implicitly.
- [ ] Evaluate current `hap-controller`/existing HAP libraries for BLE rather than reimplementing SRP/TLV/PDU cryptography. Verify advertisement identification, HAP Pairing service/characteristic UUIDs, IID descriptor, transaction/framing/encryption and fragmentation from primary sources; do not use the research-rejected `0xFED3` shortcut.
- [ ] Classify online HAP-IP, true HAP-BLE, vendor Wi-Fi provisioning and WAC-only accessories separately. HAP-BLE pairing must not be marketed as generic Wi-Fi provisioning.
- [ ] For Apple WAC/system paths, verify entitlements and supported lifecycle. Do not base Haus on adding to Apple Home and removing again to obtain an unpaired Wi-Fi device; no such lifecycle guarantee is assumed.

Acceptance: real supported HAP-IP and BLE accessory checks are separately reported; WAC/vendor limitations and user choices are explicit.

## P20.8 — Wi-Fi and Thread credential providers

- [ ] Offer explicit manual SSID/password entry on every platform. Prefill a current SSID only where the OS returns it with appropriate user permission; never assume saved Wi-Fi passwords can be extracted.
- [ ] Store only user-approved reusable credentials in OS/Hub secure storage, scope transmission to the selected commissioning agent, encrypt sensitive transport and clear temporary values on completion/cancellation. Keep network secrets out of logs, command lines, generic replicated state and discovery payloads.
- [ ] Prefer an authorized Haus/OTBR Thread dataset. Verify Apple ThreadNetwork and Android Thread Network APIs/entitlements/consent for optional system-assisted access, including rejection or missing services.

Acceptance: manual fallback, denied/missing permission, wrong network/dataset and secret-lifetime checks; physical dataset access is verified per platform.

## P20.9 — Platform capability and permission matrix

- [ ] Maintain observed support for macOS/Windows/Linux Electron/Hub and iOS/Android native builds. Evaluate current Node BLE/Noble, Linux BlueZ D-Bus/raw-HCI and mobile BLE APIs against actual transport requirements; do not select libraries from names alone.
- [ ] Verify Bluetooth/local-network/Wi-Fi permissions and entitlement requirements, Android version-specific scan/connect/location behavior and the effects of scan-filtering flags. Expo custom native builds are distinct from Expo Go support.
- [ ] Test Linux/container radio access with least privilege and functioning IPv6/multicast; Windows/WSL availability must be measured rather than inferred from the physical laptop having Bluetooth. Do not grant arbitrary containers broad host access.

Acceptance: OS/version/build/radio evidence matrix with clear unavailable/manual paths; no claim that one successful OS proves all five.

## P20.10 — Remote Matter handoff and permanent ownership

- [ ] For a Hub with BLE, commission directly. For an already-networked accessory, use IP. For a new device near a client, evaluate an authorized temporary commissioner that provisions the network, opens an additional commissioning window and lets the Hub join as permanent controller.
- [ ] Verify the Hub's secure session, persistent fabric and real device control before removing the temporary fabric. Make interruption/cleanup recoverable; never remove the only working controller after an uncertain acknowledgement.
- [ ] Keep a later transport-proxy slice for Hub-owned PASE/fabric state from the first packet, informed by current Matter Commissioning Proxy/BTP APIs. Do not claim that matter.js already exposes the exact remote adapter Haus needs without checking it.
- [ ] Do not copy opaque phone/desktop fabric databases, NOCs or private keys as the normal transfer mechanism. Explicitly distinguish a transport agent from a client intentionally acting as a temporary commissioner.

Acceptance: no-local-BLE Hub flow, lost client during handoff, expired window, failed Hub pairing and retry/cleanup behavior, with permanent keys retained only by their deliberate owners.

## P20.11 — Documented vendor provisioning

- [ ] Add Aqara, Shelly, Tasmota/ESPHome or other vendor SoftAP/BLE adapters only for actual inventory needs and verified documented/stable protocols.
- [ ] Distinguish Aqara Matter, online HAP-IP and proprietary cloud/SDK provisioning. Verify developer/cloud registration, expiring bind credentials and vendor authorization requirements; `_aqara` advertisements do not establish an open provisioning protocol.
- [ ] Keep vendor/cloud binding outside the generic core state machine, with explicit requirements and supported fallback. Do not add universal reverse-engineering work or fabricate a local-only path.

Acceptance: one supported vendor flow with real dependency/authentication/error behavior and no long-term credential leakage.

## P20.12 — Finish the cross-platform code-first experience

- [ ] Connect the accepted protocol/radio paths to shared desktop/mobile screens: code entry/scan, discovery progress/candidates, just-in-time network credentials, permission explanation, bounded pairing progress, actionable failure/cancel/retry and verified completion.
- [ ] Preserve `commissioningId` and current stage through reconnect, avoid duplicate submissions and confirm the device appears once with the correct services/characteristics/room. Pairing success requires actual identity and state/control checks.
- [ ] Record separate protocol/platform/hardware acceptance and remaining vendor/WAC/radio limitations. Start this phase with Matter/Improv, then HAP-IP/BLE, then documented vendor needs; none preempts the migration work in P18.

Acceptance: users start with a device code and provide additional network information only when necessary; unsupported hardware receives an honest useful path rather than a fake success screen.
