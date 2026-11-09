# MQTT migration evidence

Observed 2026-11-09. P18.2 remains in progress; no household source was transferred or deployed.

## Discovery lifecycle — P18.2.1.1

The active Hub ignored zero-byte discovery tombstones and kept previous state-topic bindings after updates. Bundled abbreviated `p` platforms were not expanded, and platform-only component removal was treated as a new endpoint. Four loopback-broker regressions failed before the fix.

Discovery bindings now have exact-topic/component ownership. Removing one announcement retains an endpoint with another live reference and restores that reference's command/state routing. Explicit bundle removals preserve omitted sibling components, as required by [HA MQTT discovery](https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery). Runtime-created camera endpoints are pruned only when their known MQTT references disappear.

The Home state owner clears removed endpoint rows and rejects queued state/command work for absent endpoints. A disposable TypeORM/better-sqlite3 catalog reopen confirms removal and retained sibling state. Discovery validation rejects malformed known fields, retains unknown extensions as data, and logs a stable error code without provider bodies. Expansion preserves malformed bundle children for rejection and handles prototype-looking keys as ordinary own properties.

Observed checks after implementation:

- PASS — `pnpm --filter @haus/mqtt build`.
- PASS — `pnpm --filter @haus/hub typecheck`.
- PASS — `pnpm exec vitest run apps/hub/test/mqtt apps/hub/test/matter/matter.test.ts packages/mqtt/test`: 7 files, 29 tests. All brokers/servers in this selection use loopback fixtures. Eight lifecycle cases cover removal, state-topic replacement, abbreviated bundle removal, queued state/commands, shared references, invalid input and catalog reopen.
- PASS — `pnpm architecture:check`: 428 source files.
- PASS — focused `pnpm exec oxlint --deny-warnings` on changed MQTT/Home source and tests.
- STOPPED — the broader `pnpm exec vitest run apps/hub/test packages/mqtt/test` (exit 130). An existing standalone test starts the real application, whose Matter default points at the household HA. It read real node inventory; no physical control was issued. The standalone empty-home assertion failed. Do not treat this interrupted run as a regression verdict or repeat it without isolation.

Limits: discovery ownership is currently runtime state. Broker restart retention, configurable discovery prefixes, full identity collision handling, availability, templates, reverse export and real App migration are separate open acceptance conditions. The catalog-reopen case proves deletion persistence, not restoration of MQTT bindings. Existing source/format/license/rule debt recorded in the migration plan is unchanged except that the touched Home service is now below 500 lines.
