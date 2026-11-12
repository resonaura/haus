# Milestone 20.8 Evidence: Wi-Fi and Thread Credential Providers

## Executive Summary

Milestone `P20.8` delivers secure, platform-neutral Wi-Fi and Thread credential providers within the native Haus onboarding architecture. Prior to this milestone, provisioning relied on ad-hoc credentials without formal guarantees against secret leakage, lack of explicit user consent gates for persistent storage, missing Thread Active Operational Dataset TLV encoding/validation, and without platform abstraction for system-assisted Thread networks (Apple ThreadNetwork and Android Thread Network APIs).

This milestone delivers:
1. **Explicit Manual SSID/Password Fallback on All Platforms:** Every platform provides direct manual SSID and password entry. Current SSID is prefilled only where the underlying operating system returns it with explicit user permission (`'granted'`).
2. **Zero Password Extraction Invariant (`supportsPassphraseExtraction: false`):** Haus formally assumes saved OS Wi-Fi passwords cannot be extracted without explicit user input, reflecting modern macOS, iOS, Android, and Windows security models.
3. **User-Approved Encrypted Storage:** Stored credentials require explicit user consent (`userApproved: true`). Reusable credentials are encrypted using AES-256-GCM authenticated encryption (`AesGcmCredentialCipher`) with random 12-byte IVs and 16-byte authentication tags.
4. **Scoped Transmission and In-Memory Wipe:** Credentials are bound exclusively to the active commissioning transaction lease. Temporary credential objects and sensitive byte buffers are zeroed out and dereferenced on completion or cancellation (`wipeWifiCredentials`, `wipeBuffer`).
5. **Zero Secret Leak in Logs and Events:** Plaintext Wi-Fi passwords and Thread network keys are strictly redacted in all logs, snapshots, API responses, and event streams (`redactWifiCredentials` -> `password: '***'`, `redactThreadDataset` -> `[ThreadDataset: X bytes, redacted]`).
6. **Thread Active Operational Dataset TLV Codec (`@haus/core`):** Full parser and encoder for standard Thread Operational Dataset TLVs (Channel 11..26, 16-bit PAN ID, 8-byte Extended PAN ID, 16-byte/128-bit Network Key, UTF-8 Network Name, Mesh-Local Prefix) with strict validation.
7. **System-Assisted Thread Network Resolution:** Prioritizes authorized Haus / OpenThread Border Router (OTBR) datasets, with structured fallback to platform Thread providers (Apple / Android) and explicit handling for consent denial, missing services, or unsupported platforms.

---

## Architecture and Invariants

### 1. Security & Redaction Invariant Matrix

```
+--------------------------+------------------------------+---------------------------------------+
| Credential Type          | Public / Log Representation  | Storage Encryption                    |
+--------------------------+------------------------------+---------------------------------------+
| Wi-Fi Credentials        | { ssid, password: '***' }    | AES-256-GCM (12B IV, 16B Auth Tag)   |
| Thread Dataset           | [ThreadDataset: N B, redacted]| AES-256-GCM (12B IV, 16B Auth Tag)   |
| System Wi-Fi Passphrase  | Never extracted (always null)| N/A (supportsPassphraseExtraction: 0) |
+--------------------------+------------------------------+---------------------------------------+
```

### 2. Thread Dataset TLV Specifications
Encodes and validates standard OpenThread / Thread TLVs per Thread specification:
- **Type 0x00 (Channel):** Channel Page 0 (1 byte) + 2-byte big-endian channel, bounded to standard 802.15.4 channels 11..26.
- **Type 0x01 (PAN ID):** 2-byte big-endian 16-bit PAN ID.
- **Type 0x02 (Extended PAN ID):** Exactly 8 bytes (16 hex characters).
- **Type 0x03 (Network Name):** 1..16 bytes UTF-8 string.
- **Type 0x05 (Network Key):** Exactly 16 bytes (128-bit master key).
- **Type 0x07 (Mesh-Local Prefix):** Optional 8-byte prefix.

### 3. REST API Surface (`apps/hub`)

- `GET /api/commissioning/credentials/system-network`: Returns `SystemNetworkInfo` (`ssid`, `permissionStatus`, `supportsPassphraseExtraction: false`).
- `GET /api/commissioning/credentials/wifi`: Lists stored SSIDs without passwords.
- `DELETE /api/commissioning/credentials/wifi/:ssid`: Removes a stored Wi-Fi credential.
- `GET /api/commissioning/credentials/thread`: Lists stored Thread networks (`networkName`, `extendedPanId`) without network keys.
- `POST /api/commissioning/credentials/thread/resolve`: Resolves operational Thread dataset from Haus/OTBR or system provider with permission verification.
- `POST /api/commissioning/sessions/:id/credentials`: Provides Wi-Fi or Thread credentials for active commissioning transaction, with optional `saveForReuse: true`.

---

## Verification Evidence

### 1. Core Unit Test Suite (`packages/core/test/credentials/credentials.test.ts`)
```
 ✓ test/credentials/credentials.test.ts (25 tests) 32ms
   ✓ Thread Dataset Codec (7)
     ✓ encodes and validates valid Thread Active Operational Dataset TLV
     ✓ parses valid Thread dataset from hex string
     ✓ rejects invalid hex strings
     ✓ rejects truncated or too-short dataset buffers
     ✓ rejects out-of-range Thread channels (< 11 or > 26)
     ✓ detects missing required TLVs
     ✓ detects truncated TLV value
   ✓ Manual Wi-Fi Credential Provider (5)
     ✓ prefills current SSID only when permission is granted
     ✓ returns undefined SSID when permission is denied or unavailable
     ✓ supports explicit manual SSID and password entry
     ✓ supports manual Thread dataset entry
     ✓ wipes temporary credentials from memory on wipe()
   ✓ Encrypted Network Credential Store (4)
     ✓ requires explicit user approval before saving Wi-Fi credentials
     ✓ rejects empty or whitespace-only SSID
     ✓ saves and retrieves user-approved Wi-Fi credentials
     ✓ requires explicit user approval and valid TLV for Thread dataset
   ✓ System-Assisted Thread Manager (5)
     ✓ prefers Haus/OTBR dataset when available
     ✓ falls back to SystemThreadProvider when OTBR dataset is unavailable
     ✓ propagates denied status from system provider
     ✓ flags keychain_error if system returns invalid dataset TLV
     ✓ returns unsupported when neither OTBR nor system provider is available
   ✓ Credential Redaction and Buffer Zeroing (4)
     ✓ redacts Wi-Fi password without altering SSID
     ✓ redacts Thread dataset without leaking keys
     ✓ wipes buffers in memory
     ✓ wipes Wi-Fi credential object in memory
```

### 2. Standalone Hub Integration Suite (`apps/hub/test/standalone/credential-providers.test.ts`)
```
 ✓ test/standalone/credential-providers.test.ts (1 test) 580ms
   ✓ Wi-Fi and Thread Credential Providers (P20.8) (1)
     ✓ proves manual SSID/password entry, current SSID prefill, zero password extraction, user-approved storage, zero leak, wipe on completion/cancel, and Thread dataset handling
```

### 3. Full Standalone Regression Suite (`apps/hub/test/standalone/`)
```
 Test Files  18 passed (18)
      Tests  59 passed (59)
   Duration  38.10s
```

### 4. Quality & Governance Gates
- `pnpm typecheck`: PASS across all 18 packages and root (0 errors).
- `pnpm lint` (`oxlint --deny-warnings`): PASS across 1710 files (0 warnings, 0 errors).
- `pnpm rules:check`: PASS across 2056 files (zero new `any`, all directories $\le 25$ files, all authored files $\le 500$ lines, zero credential leaks).
- `pnpm architecture:check`: PASS (452 source files inspected).
- `git diff --check`: PASS (clean diff with zero whitespace errors).
