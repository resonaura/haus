# Broaden Discovery & Improve Pairing — P18.8

Documented evidence for P18.8: generalizing discovery sources (mDNS/Zeroconf, SSDP, DHCP, Bluetooth, USB, MQTT) into deduplicated native flows beyond HomeKit, supporting user/discovery, credential/OAuth/external steps, 2FA, reauth, cancel/retry, multi-home isolation, and client reconnects.

## Generalized Discovery Sources & Deduplication — P18.8.1

Host discovery announcements across mDNS/Zeroconf, SSDP, DHCP, Bluetooth, USB, and MQTT feed into the unified `DiscoveryRegistry` (`packages/core/src/commissioning/discovery-deduplicator.ts`). Candidates are deduplicated by source-specific durable IDs in strict precedence order:

1. **Normalized MAC** (`mac:<12-hex>`): derived from DHCP MAC, Bluetooth address, Zeroconf TXT `macaddress`, SSDP device identity, or ARP lookup.
2. **Normalized UUID/UDN** (`uuid:<uuid>`): extracted from SSDP USN/UDN, HomeKit device identifier, or service discovery UUIDs.
3. **USB Serial / VID:PID** (`usb:<vid>:<pid>:<serial>`): derived from USB vendor, product, and serial/description strings.
4. **Network Endpoint** (`net:<host>:<port>`): fallback for IP services without hardware MAC or UUID.
5. **MQTT Topic / Unique ID** (`mqtt:<topic>`): derived from MQTT discovery topic patterns.

Multi-protocol announcements for the same physical device (e.g. initial DHCP discovery followed by Zeroconf service publication) merge into a single candidate record, preserving discovered addresses, ports, secondary protocols, and metadata without creating duplicate device entries.

### Truthful Invariants & State Suppression

- **Unauthenticated Advertisement Invariant:** `authenticated: false` is strictly enforced on all discovered candidates. An advertisement does not authenticate a device; pairing requires verified credentials, setup PIN, one-use pairing code, OAuth tokens, or challenge-response exchange.
- **Candidate Lifecycle:** `DiscoveryRegistry` tracks status (`discovered`, `in_progress`, `configured`, `ignored`).
  - `ignored`: Dismissed candidates are suppressed from active onboarding lists until explicitly unignored.
  - `configured`: Once paired/configured, candidates are suppressed from active onboarding lists and re-announcements preserve configured status.
  - `in_progress`: Flow initiation locks candidates to prevent duplicate concurrent pairing attempts. Cancelling a flow releases the lock back to `discovered`.
  - `clearStale(maxAgeMs)`: Purges unconfigured ephemeral discoveries older than TTL.

## Real Integration Flows & Multi-Step Pairing — P18.8.2

`IntegrationFlowEngine` (`packages/core/src/commissioning/flow-engine.ts`) executes interactive configuration flows across diverse authentication requirements:

1. **Form / Credential-Based Setup:** Validates required schemas (host, port, username, password, API keys) and returns bounded error messages on missing or invalid fields.
2. **Multi-Step Two-Factor Authentication (2FA):** Step 1 collects credentials/phone numbers; Step 2 presents the verification code schema (`pin`/SMS code) with active state tracking.
3. **OAuth 2.0 External Flow:** Presents `external` step with provider authorization URL and redirect handler, completing entry creation upon token receipt.
4. **Re-authentication:** Non-destructive credential updates (`reauth`) refresh expired session credentials for an existing entry without duplicating device records.
5. **Truthful Abort on Unsupported Domains:** Integrations requiring external Python execution, supervisor add-on containers, or unavailable hardware radios return `abort` steps detailing concrete `unsupportedRequirements` rather than pretending universal execution.
6. **Multi-Home Isolation & Client Reconnection:** Flow sessions are strictly bound to `homeId` and `userId`. Other homes or users cannot inspect or manipulate active flows. Client reconnects retrieve the exact active step and schema via `GET /api/commissioning/flows/:id`.

## Hub Commissioning API & Desktop Integration — P18.8.3

- **Hub Commissioning Controller (`apps/hub/src/commissioning/controller.ts`):**
  - `GET /api/commissioning/discoveries`: Returns deduplicated candidates, filterable by `status`, `domain`, and `protocol`.
  - `POST /api/commissioning/discoveries/announcements`: Ingests announcements from host scanners and network adapters.
  - `POST /api/commissioning/discoveries/:id/ignore`: Marks candidate ignored.
  - `POST /api/commissioning/discoveries/:id/unignore`: Restores candidate to discovered.
  - `POST /api/commissioning/flows`: Starts integration flows (`user`, `discovery`, `reauth`, `manual`).
  - `GET /api/commissioning/flows/:id`: Retrieves current step state for client reconnects.
  - `POST /api/commissioning/flows/:id/step`: Submits step input with validation and error reporting.
  - `DELETE /api/commissioning/flows/:id`: Cancels active flows and releases candidate locks.
- **Desktop Flow Manager (`apps/desktop/src/main/hub/flows.ts` & `flow-entries.ts`):**
  - Broadened discovery queries `/api/commissioning/discoveries` alongside HomeKit.
  - Maps discovered candidates to `flow_progress` so desktop shows real discovered devices.
  - Delegates flow initiation, progression, and cancellation to native Hub endpoints.

## Observed Verification Evidence

- **PASS** — `pnpm --filter @haus/core exec vitest run test/discovery.test.ts` (11 tests passed).
- **PASS** — `pnpm --filter @haus/hub exec vitest run test/commissioning/` (2 files, 5 tests passed).
- **PASS** — `pnpm --filter @haus/ha exec vitest run test/catalog.test.ts` (7 tests passed).
- **PASS** — `pnpm --filter @haus/desktop exec vitest run` (132 files, 693 tests passed).
- **PASS** — `pnpm typecheck` (all 18 packages and apps passed).
- **PASS** — `pnpm architecture:check` (450 source files passed).
- **PASS** — `pnpm rules:check` (2,017 files $\le 500$ lines, zero new `any`, max 25 files/dir, license & credential gates passed).
- **PASS** — `pnpm lint` (0 warnings, 0 errors across 1,671 files).
- **PASS** — `git diff --check` (0 issues).
