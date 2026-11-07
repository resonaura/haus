# Haus Licensing and Provenance

## Core Licensing Policy

Haus is committed to user freedom, verifiable code integrity, and transparency.

- All Haus core domains, applications, and shared libraries are licensed under the **GNU General Public License v3.0 or later** (`GPL-3.0-or-later`), unless explicitly scoped otherwise.
- `@haus/kitsune` is licensed under the **GNU General Public License v3.0 only** (`GPL-3.0-only`) to maintain strict boundary isolation for external plugin sandboxing.

### Package License Inventory

| Package         | Path               | License          | Description                                                 |
| :-------------- | :----------------- | :--------------- | :---------------------------------------------------------- |
| `@haus/desktop` | `apps/desktop`     | GPL-3.0-or-later | Haus Desktop application (Electron / React)                 |
| `@haus/hub`     | `apps/hub`         | GPL-3.0-or-later | Local coordinator and standalone core server                |
| `@haus/mobile`  | `apps/mobile`      | GPL-3.0-or-later | Haus Mobile application (Expo / React Native)               |
| `@haus/ai`      | `packages/ai`      | GPL-3.0-or-later | Vision analysis, resource admission and model assets        |
| `@haus/servers` | `packages/servers` | GPL-3.0-or-later | Host telemetry, hardware inventory and node clients         |
| `@haus/ui`      | `packages/ui`      | GPL-3.0-or-later | Shared UI metadata and catalogs                             |
| `@haus/apps`    | `packages/apps`    | GPL-3.0-or-later | Neutral app container runtime and permission contracts      |
| `@haus/bridge`  | `packages/bridge`  | GPL-3.0-or-later | Neutral device protocol and camera streaming bridge         |
| `@haus/core`    | `packages/core`    | GPL-3.0-or-later | Neutral domain core contracts, types, and automations       |
| `@haus/ha`      | `packages/ha`      | GPL-3.0-or-later | Optional external Home Assistant adapter and migration port |
| `@haus/homekit` | `packages/homekit` | GPL-3.0-or-later | Native Apple HomeKit HAP / HKSV accessory engine            |
| `@haus/kitsune` | `packages/kitsune` | GPL-3.0-only     | Independent plugin runtime and vendor protocol adapters     |
| `@haus/matter`  | `packages/matter`  | GPL-3.0-or-later | Native Matter controller and commissioning port             |
| `@haus/media`   | `packages/media`   | GPL-3.0-or-later | Video recording, HLS / WebRTC streaming engine              |
| `@haus/mqtt`    | `packages/mqtt`    | GPL-3.0-or-later | Native MQTT client and broker orchestration                 |
| `@haus/state`   | `packages/state`   | GPL-3.0-or-later | State container and synchronization primitives              |
| `@haus/thread`  | `packages/thread`  | GPL-3.0-or-later | Native OpenThread controller and dataset manager            |
| `@haus/zigbee`  | `packages/zigbee`  | GPL-3.0-or-later | Native Zigbee coordinator and cluster controller            |

## Source Header Requirements

Every authored source file (`.ts`, `.tsx`, `.mjs`, `.js`) carries the standard copyright notice:

```typescript
/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */
```

## Third-Party Provenance and Restrictions

- **Zero Scrypted runtime copying:** Haus does not bundle, vendor, or copy `@scrypted/server` or `@scrypted/sdk` runtime implementations. All plugin adapters run through clean, independently authored interfaces in `@haus/kitsune`.
- **Permissive dependencies:** External npm libraries utilized across workspace packages must adhere to permissive open-source licenses (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC) or compatible GPL licenses.
- **Verification script:** Enforced continuously via `scripts/check-license-provenance.mjs`.
