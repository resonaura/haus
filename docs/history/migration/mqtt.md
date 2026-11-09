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

At this slice, ownership was runtime-only; the catalog-reopen case proved deletion persistence, not restored MQTT bindings. The following slice adds retained reconstruction. Existing source/format/license/rule debt recorded in the migration plan is unchanged except that the touched Home service is now below 500 lines.

## Retained reconstruction — P18.2.1.2

Added typed `mqtt_retained` ORM storage and an explicit migration. Original payload bytes/QoS are retained for MQTT subscribers; a separate cumulative discovery projection preserves omitted bundle components and explicit removal markers. Invalid announcements cannot promote an older duplicate reference's command binding during restore. Tombstones remain as empty journal rows and do not produce retained messages for subscribers.

The broker commits retained client packets before authorizing publication because [Aedes acknowledges QoS 1 before its publish event](https://github.com/moscajs/aedes/blob/main/lib/handlers/publish.js). Internal retained publications also await storage. Storage errors reject publication or startup with stable codes. Boot replays discovery before state and accepts clients only afterward; replayed state does not dispatch automation triggers. `CatalogLifetime` stops the MQTT writer before draining/closing its database. Concurrent broker initialization shares one operation.

Observed checks after the final code edit:

- PASS — `pnpm --filter @haus/mqtt build` and `pnpm --filter @haus/hub typecheck`.
- PASS — `pnpm exec vitest run apps/hub/test/mqtt apps/hub/test/matter/matter.test.ts packages/mqtt/test`: 9 files, 36 tests, isolated loopback fixtures.
- The added cases cover cold reopen/routing/state/command execution, original retained wire replay, incremental bundles/removals, invalid replacement ordering, old-catalog migration preserving a scene, byte-exact binary storage, rejection of destructive rollback, failed startup, delayed commit before PUBACK, concurrent initialization and failed internal writes.
- PASS — architecture boundaries and focused Oxlint checks. No live source deployment or migration performed.

Limits: this is retained-message recovery, not durable MQTT sessions, queued command replay or exactly-once actuation. QoS 2 incoming/outgoing session state remains in Aedes memory. Abrupt termination between retained acceptance and Home-registry updates, pre-upgrade stale endpoints, full source-identity changes/collisions, prefix handling, availability and export remain explicit parent tasks. Database files use the existing private catalog directory; retained provider payloads must never be exposed to renderer/logs or committed as fixtures.
