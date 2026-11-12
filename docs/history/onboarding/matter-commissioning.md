# Matter over IP, BLE, Wi-Fi & Thread Commissioning (P20.5)

Updated: 2026-11-12. Milestone 20 verification evidence for code-first Matter device commissioning into the Haus standalone fabric.

## Architecture & Commissioning Lifecycles

Haus provides direct IP and nearby radio (BLE) commissioning for Matter devices. The Haus Hub maintains the permanent Matter controller identity and fabric root, orchestrating the multi-stage commissioning pipeline through `@haus/matter` and `@haus/hub`'s `MatterAdapter`.

```mermaid
sequenceDiagram
  autonumber
  participant Client as Admin Client (Desktop / Mobile)
  participant Hub as CommissioningService
  participant Adapter as MatterAdapter
  participant Radio as RadioAgentRegistry
  participant Handover as IpHandoverCoordinator
  participant Transport as MatterWsTransport
  participant Device as Physical Matter Device

  Client->>Hub: POST /api/commissioning/sessions (MT:... or manual pairing code)
  Hub->>Hub: parseSetupCode() (validate Verhoeff D5, short/long discriminator, passcode)
  Hub-->>Client: 202 Accepted (PARSE_CODE -> DISCOVER)

  alt Direct IP Commissioning
    Hub->>Hub: discovery.ingest() on-network mDNS advertisement (_matterc._udp)
    Client->>Hub: POST /api/commissioning/sessions/:id/select { candidateId }
    Hub->>Adapter: commission(ctx)
    Adapter->>Adapter: Match 12-bit / 4-bit short discriminator & verify CM != 0
    Adapter->>Transport: commission({ code, ip, port, failSafeTimeoutSeconds: 60 })
    Transport->>Device: PASE -> OperationalCredentials (NOC) -> CASE session
    Device-->>Transport: CommissioningComplete (NodeId assigned)
    Adapter-->>Hub: { status: 'completed', detail: { nodeId } }
    Hub-->>Client: Transaction COMPLETED / State DONE
  else BLE to IP Handover Commissioning (Wi-Fi / Thread)
    Radio-->>Hub: BLE advertisement discovered via nearby radio agent
    Client->>Hub: POST /api/commissioning/sessions/:id/select { candidateId }
    Hub->>Adapter: commission(ctx)
    Adapter-->>Hub: status: 'credentials_required' (wifi or thread prompt)
    Client->>Hub: POST /api/commissioning/sessions/:id/credentials { ssid, password / dataset }
    Hub->>Adapter: commission(ctx with credentials)
    Adapter->>Radio: grantLease(agentId, commissioningId, homeId)
    Adapter->>Transport: setWifiCredentials(ssid, pass) or setThreadDataset(dataset)
    Transport->>Device: NetworkCommissioning.AddOrUpdateWiFi/ThreadNetwork -> ConnectNetwork
    Device-->>Transport: BLE link drops (Expected handover, NOT pairing failure!)
    Adapter->>Handover: waitForIp(commissioningId, { protocol: 'matter', discriminator })
    Device->>Handover: Device joins LAN/Thread; advertises mDNS operational node
    Handover-->>Adapter: targetIp & targetPort discovered on IP network
    Adapter->>Transport: commission({ code, ip: targetIp, port: targetPort, failSafeTimeoutSeconds: 60 })
    Transport->>Device: CASE session -> CommissioningComplete
    Adapter->>Radio: revokeLease(leaseToken)
    Adapter-->>Hub: { status: 'completed', detail: { nodeId } }
    Hub-->>Client: Transaction COMPLETED / State DONE
  end
```

## Security Boundaries & Protocol Invariants

1. **Discriminator Matching:**
   - Evaluates 12-bit full discriminator against QR code payload (`MT:...`).
   - Evaluates 4-bit short discriminator (top 4 bits: `(long >> 8) & 0x0f`) against 11-digit or 21-digit manual pairing codes.
   - Rejects mismatched advertisements with `discriminator_mismatch` or `short_discriminator_mismatch`.
2. **Commissioning Window Enforcement:**
   - Verifies candidate advertisement commissioning mode (`CM: 1` or `CM: 2`).
   - If candidate advertises `CM: 0` or already paired (`pairingAvailable === false`), commissioning fails immediately with `commissioning_window_expired` before initiating PASE.
3. **Network Credential Requirement & Isolation:**
   - Detects off-network devices (`caps.onNetwork === false && (caps.ble || caps.softAp)` or discovered via radio agent).
   - If credentials missing, transitions session to `OBTAIN_NETWORK_CREDENTIALS` and emits `credentials_required` prompt (`kind: 'wifi'` or `'thread'`).
   - Wipes plaintext network credentials from memory upon provisioning.
4. **Resilient BLE-to-IP Handover:**
   - BLE transport teardown upon `ConnectNetwork` execution is treated as normal transition to `WAIT_FOR_IP`, preventing false failures.
   - `IpHandoverCoordinator` listens for operational IP discovery (`_matter._tcp` / `_matterc._udp`) using the device discriminator.
5. **Fail-Safe Arming & Rollback:**
   - Arms fail-safe timer (60–120s) during PASE.
   - On network error or credential rejection (`wifi_connect_failed`), maps to `invalid_network_credentials` without orphan fabric registration or controller corruption.
   - Automatically revokes short-lived radio agent session leases in `finally` blocks.

## Verification Evidence

- `packages/matter/test/commissioning.test.ts` (5 tests PASS):
  - Encodes and decodes standard Matter QR codes (`MT:...`) with Verhoeff $D_5$ check digit.
  - Generates 11-digit manual pairing code with short discriminator.
  - Multi-Admin share and commissioning window lifecycle.
  - Wi-Fi credentials provisioning and Thread Active Operational Dataset configuration.
  - Server error code translation (`window_expired`, `invalid_credentials`).
- `apps/hub/test/standalone/matter-commissioning.test.ts` (7 tests PASS):
  - Direct IP commissioning with QR code and 12-bit long discriminator matching.
  - 11-digit manual pairing code parsing with short discriminator matching.
  - Mismatched discriminator and expired commissioning window (`CM: 0`) rejection.
  - BLE-to-IP handover with Wi-Fi provisioning without false failure on BLE disconnect.
  - Thread Active Operational Dataset provisioning for Thread candidate.
  - Invalid credentials and network join timeout handling without controller corruption.
  - End-to-end Matter onboarding via Hub Nest REST API (`/api/commissioning/sessions`).
- Full standalone suite `apps/hub/test/standalone/` (15 test files, 47 tests PASS).
- `pnpm typecheck`: PASS across all 18 workspace packages with zero errors.
- `pnpm lint`: PASS (`oxlint --deny-warnings`: 0 errors, 0 warnings across 1698 files).
- `pnpm rules:check`: PASS (2044 files $\le 500$ lines, zero new `any`, max 25 files/dir, license headers, zero credential leaks).
- `pnpm architecture:check`: PASS (452 source files).
- `pnpm format:check`: PASS.
- `git diff --check`: PASS.
