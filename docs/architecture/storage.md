# Hub persistence

The Hub uses TypeORM 1.1.2 with its better-sqlite3 driver (12.11.1), typed `EntitySchema` definitions and explicit migrations. Node.js 24.11 or newer is required by this workspace's selected runtime dependencies. Application code uses transaction-scoped managers and never reaches into private TypeORM driver handles. See the [official driver options](https://typeorm.io/docs/drivers/sqlite/) and [schema definitions](https://typeorm.io/docs/entity/separating-entity-definition/).

`openCatalog` initializes only the new platform metadata. `synchronize` and automatic migration-on-initialize are disabled; the explicit pending migrations run in one transaction. The initial migration is additive, preserves NVR tables and leaves `PRAGMA user_version` untouched. It does not attempt a destructive Down migration. Older binaries can continue to ignore the added tables; removing identity history needs an explicit data migration. A newer platform schema marker is rejected without downgrading it.

Physical table and multiword column names use lowercase kebab-case, such as `haus-identity-refs` and `identity-id`. TypeORM quotes these identifiers. SQLite's [identifier quoting rules](https://www.sqlite.org/lang_keywords.html) apply to any manual maintenance query. Legacy NVR names stay on their existing path until an explicit migration updates all consumers.

Identity and readable-address repositories implement the asynchronous core ports. All their reads and writes inside one operation use the same transactional manager. Transactions serialize per database file in a process, including separate DataSources. Their first statement obtains SQLite's writer lock before reading application records, so other processes wait rather than both assigning a canonical ID. The queue propagates each operation's failure while allowing later work after rollback. WAL and a bounded busy timeout are enabled.

The initial persistence slice covers identity ownership, provider aliases, readable addresses and retained rename aliases. Session ownership, command receipts and encrypted local refresh attempts remain P2.0a.2. P2.0b wires these services into the actual Hub control composition. No installed catalog or household service is migrated by building these source files.

## Build and evidence

`pnpm --filter @haus/hub build` emits ESM under `dist`; `@haus/hub/storage` is the public compiled entry point. Hub typechecks are included in the root command, and its new TypeScript source/tests are covered by lint/format rules. The container's build stage compiles the Hub, rebuilds the native driver for its target and smoke-opens the deployed ESM entry point. Production dependencies include the native driver; compilers remain in the build stage.

`apps/hub/test/storage/identity.test.ts` exercises real database reopen, atomic rollback, competing DataSources, competing processes through the built export, readable-address conflicts, scope enforcement, additive migration/archive preservation, kebab identifiers, incompatible schema detection and whole-migration rollback. A local `pnpm deploy --legacy --prod` fixture successfully opens the deployed export with better-sqlite3. Linux container execution is not established by that macOS check; Docker's local daemon was unavailable during this increment.
