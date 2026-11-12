# Nearby Radio Agents and Transport Boundaries — P20.4

Documented evidence for P20.4: nearby radio agent registration, platform capability profiles, liveness tracking, multi-agent scan aggregation, exclusive transport owner selection with immediate cancellation of losing scans, short-lived transaction-scoped leases, bounded RPC packet queues, disconnect handling, sanitized errors, and wrong-home isolation.

## Architecture & Port Composition

Haus decouples protocol orchestration from physical radio hardware: a headless Haus Hub (e.g. running in Docker or a server rack without Bluetooth) can commission BLE devices (such as Improv BLE or Matter BLE) by leveraging authorized nearby companion devices (macOS, Windows, Linux desktop, iOS, Android):

```mermaid
flowchart TD
    subgraph Client ["Nearby Agent (macOS / Desktop / Mobile)"]
        Scanner["Native BLE Scanner / Peripheral"]
        RpcClient["Radio Agent RPC Client"]
    end

    subgraph Hub ["Haus Hub (Headless / Standalone)"]
        Controller["CommissioningController"]
        Service["CommissioningService"]
        Registry["RadioAgentRegistry"]
        Proxy["RemoteRadioAgentProxy"]
        Adapter["ImprovBleAdapter / MatterAdapter"]
    end

    subgraph Device ["Target Device"]
        BleGatt["BLE GATT Server (Improv / Matter)"]
    end

    Client -- "POST /radios/register" --> Controller
    Controller --> Registry
    Service --> Registry
    Service --> Adapter
    Adapter --> Registry
    Registry -- "scanAcrossAgents()" --> Proxy
    Proxy -- "RadioRpcMessage: scan.start" --> RpcClient
    Scanner -- "Advertisements" --> RpcClient
    RpcClient -- "POST /radios/:id/rpc" --> Controller
    Controller --> Proxy
    Adapter -- "claimTransportOwner()" --> Registry
    Note over Registry: Selects exclusive owner & closes losing scans
    Proxy -- "RadioConnection: GATT write/read" --> RpcClient
    RpcClient -- "GATT writes" --> BleGatt
```

## Bounded Ports & Contracts (`@haus/core`)

1. **`RadioAgentCapabilities` & `RadioAgentDescriptor`:**
   - Defines platform (`'hub' | 'macos' | 'windows' | 'linux' | 'ios' | 'android'`).
   - Flags actual radio features: `bleScan`, `bleConnect`, `softApScan`, `softApConnect`, `rssiReporting`.
   - Records status (`'online' | 'busy' | 'offline'`), registration timestamp, and liveness `lastSeenAt`.

2. **Transaction-Scoped Session Leases (`RadioAgentSessionLease`):**
   - Issued on demand per commissioning transaction (`commissioningId`, `homeId`, `agentId`).
   - Short-lived expiration (`expiresAt = Date.now() + ttlMs`).
   - Explicit revocation tracking (`revoked: boolean`).
   - `isLeaseValid(lease, commissioningId, homeId, now)`: Enforces fail-closed evaluation. Denied, expired, or revoked agents cannot read network credentials or continue commissioning.

3. **Bounded Transport RPC (`BoundedRpcQueue` & `RemoteRadioAgentProxy`):**
   - **Bounded Packet Queues:** Configurable ceiling (default 100 packets); drops and rejects new requests with `queue_overflow` to prevent backpressure memory exhaustion.
   - **Timeout Enforcement:** Default 10,000ms request-response deadline; rejects with `rpc_timeout` if unacknowledged.
   - **Error Sanitization (`sanitizeRadioRpcError`):** Automatically redacts setup codes, PINs, Wi-Fi passwords, bearer tokens, and keys from all RPC error messages.
   - **Automatic Scan Teardown:** When a consumer stops or breaks from an async iterator, the proxy immediately issues `'scan.stop'` to release remote radio scanning resources.

## Multi-Agent Discovery & Exclusive Transport Owner Selection

When commissioning begins:
1. `RadioAgentRegistry.scanAcrossAgents` identifies all permitted, online agents for the authenticated `homeId`.
2. Parallel scans are launched across all candidate agents, each receiving a dedicated transaction lease and per-agent `AbortController`.
3. When an agent discovers the target candidate or connection is initiated, `claimTransportOwner(commissioningId, winningAgentId)`:
   - Designates the winning agent as the **exclusive transport owner** for the session.
   - **Immediately closes and aborts all losing scans on other agents**, preserving radio bandwidth and battery life on client devices.
4. On transaction completion, cancellation, or failure, all session leases are immediately revoked (`revokeAllLeasesForSession`), and open scans are terminated.

## Security & Tenant Isolation

- **Wrong-Home Rejection:** The Hub rejects unauthenticated or wrong-home requests with `403 Forbidden` (`wrong_home`).
- **Secret Isolation:** Wi-Fi credentials (`ssid`, `password`) and Thread datasets are only forwarded over verified secure channels and never echoed in RPC state or server logs.
- **Revocation Safety:** Calling `DELETE /api/commissioning/radios/:agentId` instantly revokes all active leases, terminates active scans, and unregisters the agent proxy.

## Observed Verification Evidence

- **PASS** — `pnpm vitest run packages/core/test/commissioning.test.ts` (17 tests passed, 44ms).
  - Validates transaction-scoped radio agent leases and expiration.
  - Validates RPC error sanitization and credential scrubbing.
  - Validates `BoundedRpcQueue` overflow rejection and timeout.
  - Validates `RemoteRadioAgentProxy` scan lifecycle, GATT operations, and `scan.stop` on loop exit.
  - Validates expired/revoked agent rejection.
- **PASS** — `pnpm vitest run apps/hub/test/standalone/radio-transport.test.ts` (1 integration test passed, 587ms).
  - Proves hub with zero local Bluetooth gracefully reports `no_radio_agent_available`.
  - Proves desktop agent registration, capabilities listing, and heartbeat liveness tracking.
  - Proves multi-agent scanning across desktop and mobile agents.
  - Proves candidate matching, exclusive transport owner selection, and immediate closure of losing scans on other agents (`mobileScanAborted: true`).
  - Proves end-to-end Improv BLE provisioning via nearby radio proxy into state `DONE`.
  - Proves lease revocation after completion and fail-closed wrong-home access rejection (403 `wrong_home`).
  - Proves agent unregistration (`DELETE /api/commissioning/radios/:id`).
- **PASS** — `pnpm vitest run apps/hub/test/standalone/` (14 test files, 40 tests passed, 18.04s).
- **PASS** — `pnpm typecheck` (all 18 workspace packages clean).
- **PASS** — `pnpm lint` (`oxlint --deny-warnings` 0 errors, 0 warnings across 1697 files).
- **PASS** — `pnpm rules:check` (2043 files $\le 500$ lines, 0 new `any`, max 25 files/dir, license headers, 0 leaks).
- **PASS** — `pnpm format:check` (`All matched files use Prettier code style!`).
- **PASS** — `git diff --check` (0 errors).
