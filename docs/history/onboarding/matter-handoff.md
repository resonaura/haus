# Matter Remote Handoff and Permanent Ownership (P20.10)

## Context & Objectives

When onboarding a new Matter device in a home where the Haus Hub does not possess local Bluetooth Low Energy hardware (e.g. headless Linux servers, WSL2 environments, or virtualized containers), direct BLE commissioning from the Hub is impossible. For devices already connected to the IP network (Ethernet or pre-configured Wi-Fi), the Hub commissions directly over IP. For uncommissioned off-network devices located near a user's mobile phone or desktop client:
1. An authorized client acts as a **temporary commissioner**, performing initial BLE commissioning onto the home's Wi-Fi or Thread network.
2. The client opens an additional commissioning window (`OpenCommissioningWindow`) using Matter's standard Administrator Commissioning cluster (`0x003c`).
3. The client hands off the open commissioning window parameters (IP, port, discriminator, passcode) to the Haus Hub.
4. The Haus Hub connects over IP as the **permanent controller**, establishing its own independent operational fabric (generating its own Root CA, Node ID, and NOC).
5. The Hub thoroughly verifies the secure CASE session, persistent fabric allocation, and real device control before the temporary fabric can be removed.
6. Interruption, client loss, window expiration, and network failures are handled recoverably, strictly preventing device orphaning.

## Key Invariants Enforced

### 1. Zero Private Key, NOC, or Fabric Database Copying
- **Invariant:** Do not copy opaque phone/desktop fabric databases, NOCs, or private keys as the transfer mechanism.
- The client and Hub maintain separate cryptographic identities. The client never transmits its operational credentials or private keys. The handoff payload transfers only standard Matter commissioning window connection parameters (`targetIp`, `targetPort`, `discriminator`, `passcode`, `windowExpiresAt`).
- Validated via `validateHandoffRequest`: incoming payloads containing `noc`, `privateKey`, `fabricDatabase`, `caKey`, or `certificates` are rejected immediately with `400 Bad Request` (`forbidden_credential_transfer`).

### 2. Distinction: Temporary Commissioner vs Transport Proxy Agent
- **RadioAgent (Transport Proxy):** Forwards raw GATT bytes where the Hub's own controller drives PASE over BLE.
- **Temporary Commissioner:** An authorized Matter client running a local Matter stack with its own temporary fabric. It provisions network credentials over BLE, allocates a temporary fabric, opens a standard commissioning window, and delegates permanent ownership to the Hub.

### 3. Verify Permanent Fabric Before Removal
- **Invariant:** Verify the Hub's secure session, persistent fabric, and real device control before removing the temporary fabric.
- Any attempt to call `removeTemporaryFabric` before the Hub has verified CASE communication and attribute read (`BasicInformation` or `Descriptor`) is rejected with `400 Bad Request` (`permanent_fabric_not_verified`).

### 4. Uncertain Acknowledgement Safety
- **Invariant:** Never remove the only working controller after an uncertain acknowledgement.
- If the `RemoveFabric` command (`0x0a` on `OperationalCredentials` cluster `0x003e`) fails, times out, or receives network jitter, the temporary fabric is **not** assumed removed. The session records `uncertainAck: true` and transitions to `UNCERTAIN_REMOVAL`. The device remains operational under Hub control while the temporary fabric remains intact for safe retry or multi-admin cleanup.

### 5. Expired Window & Reopen Handling
- If `Date.now() > windowExpiresAt` before the Hub can connect, commissioning throws `commissioning_window_expired`.
- The temporary commissioner reopens the window via `POST /api/commissioning/matter-handoff/:id/reopen` with an extended expiration without re-running the physical BLE/network provisioning.

### 6. Lost Client Resilience
- If the mobile or desktop client disconnects or loses connectivity after opening the commissioning window, the Hub proceeds with IP commissioning independently. Permanent fabric ownership is retained by the Hub regardless of client liveness.

## Implementation Details

- **`@haus/matter/handoff` (`packages/matter/src/handoff.ts`):**
  - `validateHandoffRequest(payload)`: Rejects sensitive credential dumps and validates 12-bit discriminators, passcodes, and expiration.
  - `MatterHandoffManager`: Manages handoff sessions, executes Hub permanent IP commissioning, verifies real device control, safely removes temporary fabrics with uncertain ACK fallback, and handles window reopening.
- **`MatterHandoffService` (`apps/hub/src/commissioning/matter-handoff.service.ts`):**
  - Nest injectable service orchestrating handoff sessions, integrating with `MatterService` and updating node registries.
- **`MatterHandoffController` (`apps/hub/src/commissioning/matter-handoff.controller.ts`):**
  - `POST /api/commissioning/matter-handoff/initiate` (201 Created)
  - `POST /api/commissioning/matter-handoff/:id/commission` (200 OK)
  - `POST /api/commissioning/matter-handoff/:id/remove-temporary-fabric` (200 OK)
  - `POST /api/commissioning/matter-handoff/:id/reopen` (200 OK)
  - `GET /api/commissioning/matter-handoff/:id` (200 OK)
  - Fail-closed home authorization via `resolveHomeId(req)`.

## Verification Evidence

1. **`@haus/matter` Unit Tests (`packages/matter/test/handoff.test.ts`):**
   - `strictly rejects transfer of private keys, NOCs, or fabric databases` — PASS
   - `creates handoff session with valid manual and QR pairing codes` — PASS
   - `executes Hub permanent commissioning, verifies CASE and real device control` — PASS
   - `enforces verify-before-remove: rejects temporary fabric removal before permanent verification` — PASS
   - `removes temporary fabric cleanly after permanent controller verification` — PASS
   - `never removes temporary fabric on uncertain acknowledgement or command failure` — PASS
   - `detects expired commissioning window and supports reopening` — PASS
   - `handles lost client gracefully: Hub completes commissioning without requiring live client` — PASS
   - **Result:** 8/8 tests PASS.

2. **Standalone Nest Integration Test (`apps/hub/test/standalone/matter-handoff.test.ts`):**
   - Proves no-local-BLE Hub flow, zero key/NOC leak, fail-closed wrong-home rejection, verify-before-remove, uncertain ACK preservation, expired window reopening, and lost client resilience across 9 assertion phases.
   - **Result:** PASS (694ms).

3. **Full Standalone Test Suite:**
   - 20 test files, 61/61 tests PASS.

4. **Workspace Engineering Gates:**
   - `pnpm typecheck`: All 19 packages clean.
   - `pnpm lint`: 0 errors, 0 warnings across 1,719 files.
   - `pnpm rules:check`: File length ($\le 500$ lines), directory density ($\le 25$ files), zero explicit `any`, license provenance all PASS.
   - `pnpm architecture:check`: 452 files clean.
   - `git diff --check`: 0 whitespace or formatting errors.
