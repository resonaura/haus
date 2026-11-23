# Haus plan

Updated: 2026-11-22. Status: active (clean slate after archiving the platform migration plan).

Markers: `[ ]` open; `[~]` in progress; `[+]` implemented by an agent other than ChatGPT, awaiting ChatGPT review; `[x]` completion verified by ChatGPT. Every agent marks its selected plan ID `[~]` before starting work and leaves a concise handoff if interrupted.

## Archived plans

- [`docs/history/plan-legacy-2026-11-22.md`](docs/history/plan-legacy-2026-11-22.md) — standalone Hub migration, consolidation, Kitsune virtualization, native protocols, and onboarding milestones (P0–P20).
- [`docs/history/plan-legacy-2026-11-04.md`](docs/history/plan-legacy-2026-11-04.md) — earlier architecture reset plan and pre-monorepo reliability evidence.

## Current baseline & invariants

- **Standalone platform:** `apps/hub` (`@haus/hub`) is the single Haus server application (home domain, SQLite/TypeORM persistence, native MQTT broker, Matter/Zigbee/Thread, HomeKit/HKSV, local NVR/recording/AI, host telemetry, and Kitsune virtualization for HA integrations, HACS, Homebridge, Scrypted, and Docker Apps). Home Assistant (`packages/ha`, `custom_components/haus`) is strictly an optional external compatibility adapter.
- **Clients:** `apps/desktop` (Electron + React + HeroUI + Liquid Glass) and `apps/mobile` (Expo / React Native) consume Haus Hub directly and share domain/state contracts in `packages/core` and `packages/state`.
- **Ownership & safety:** Single-writer ownership for every integration session, rotating token, automation executor, radio coordinator, HomeKit identity, and exclusive media job. Never replay ambiguous physical commands after an unknown acknowledgement.
- **Operational limits:** Local fixtures and isolated test hosts for development; production hub deploys, live device control, HomeKit/radio transfers, and destructive operations require explicit task authorization. Preserve household constraints (Narnia offline/restore lights off, avoid unnecessary Bedroom light tests).
- **Engineering rules:** Canonical coding, naming, persistence, typing, file-size (`<= 500` lines), directory-density (`<= 25` files/dir), and verification rules live in [`AGENTS.md`](AGENTS.md). Durable architecture docs live in [`docs/architecture/`](docs/architecture/).

## Active queue

_No open tasks queued yet. Add focused, independently verifiable plan IDs here before starting substantial multi-step work._
