# Haus engineering contract

Applies to Codex, OpenCode, Antigravity, and other coding agents. Follow platform instructions and the latest user request first. Work directly; do not spawn or delegate to other agents unless the user explicitly asks.

## Repository facts

- Package manager: `pnpm@11.22.0`; Node.js `>=24.11.0`; ESM workspace.
- Workspace globs: `apps/*`, `packages/*`.
- Apps: `apps/hub`, `apps/node`, `apps/desktop`, `apps/mobile`.
- Shared packages: `packages/core`, `packages/state`, `packages/ha`, `packages/apps`, `packages/media`, `packages/homekit`, `packages/kitsune`, `packages/bridge`.
- Core contracts: `packages/core/src/types.ts`, `home.ts`, `runtime.ts`, and `lifecycle.ts`. HA wire/client/view code belongs in `packages/ha`; neutral Apps contracts are in `packages/apps`; cross-package import policy is checked by `scripts/check-architecture.mjs`.
- Hub persistence uses TypeORM with better-sqlite3 and typed `EntitySchema` definitions. Use explicit migrations, `synchronize: false` and transaction-scoped managers. New adapters must not bypass the ORM through private driver handles; migrate legacy SQLite paths incrementally while preserving their data.
- New physical SQL table/column names use lowercase kebab-case, with quoting handled by TypeORM. TypeScript property names follow language conventions. Legacy SQL names change only through explicit migrations with all queries, foreign keys and archive paths accounted for.
- Main commands: `pnpm dev`, `pnpm mobile`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm check:apps`, `pnpm architecture:check`, `pnpm check`.
- Hub and Node currently retain legacy `.mjs` runtime code. New service/domain code is TypeScript ESM; conversion of old runtime files is planned, not a reason to disguise compatibility constraints.
- `apps/mobile/AGENTS.md` adds Expo-specific rules. It must follow the root package manager and may not weaken root safety, typing, naming, or architecture rules.

## Work protocol

1. Read `git status` and the relevant diff first; preserve user changes.
2. Read the current task in `PLAN.md`, its architecture constraints, affected public contracts, callers, tests, and compatibility surfaces. The current plan's decisions supersede older conflicting notes until those notes are reconciled.
3. For a small local change, proceed directly. For cross-package work, state the affected packages, invariants, risks, and focused verification briefly.
4. Confirm APIs, package versions, import paths, schemas, and commands from the repository or authoritative current docs. Search for existing implementations before adding another abstraction.
5. Reproduce a bug or establish a specific failing scenario and cause before changing code. Add focused regression coverage when implementation work is authorized and it meaningfully captures the contract.
6. Make the smallest coherent change. Split work that cannot be independently reviewed in one focused session into smaller plan IDs. Inspect the final diff after the last edit.
7. If `PLAN.md` says work is paused, do not start implementation until the user resumes it. A plan or docs request does not authorize device control or deployment.
8. Plan markers: `[ ]` is open; `[~]` is in progress; `[+]` means implemented by an agent other than ChatGPT, awaiting ChatGPT review; `[x]` means completion verified by ChatGPT. Other agents must use `[+]` with changed paths, checks and remaining limitations, even when their checks pass. Only ChatGPT may promote `[+]` to `[x]` after inspecting the final changes and verifying the task's acceptance evidence.
9. Before starting a task, every agent must mark its selected plan ID `[~]`. Keep that marker and leave a concise handoff if interrupted; do not leave active work marked `[ ]` or mark it complete without acceptance evidence.

## Architecture and ownership

- Haus owns its domain, onboarding, identities, rooms, devices, Apps, scenes, automations, clients, and orchestration. Home Assistant is a compatibility adapter/runtime, not a dependency of the core domain.
- `core` has no HA, Docker, Electron, Homebridge, Scrypted, or OS imports. Adapters implement core ports; `state` consumes neutral contracts; apps wire implementations through composition roots.
- Prefer object-oriented composition for stateful services. Inject explicit ports through constructors. Do not add a universal base class or inheritance tree. Pure parsing/formatting and React hooks can remain functions.
- Keep HA API/wire types, Supervisor protocol, provider-specific interpretation, and HA lifecycle behind `packages/ha`. Keep generic App contracts/drivers behind `packages/apps`. Do not add an empty package without a demonstrated consumer boundary.
- Use one explicit owner for each integration session, rotating token, automation execution, radio coordinator, HomeKit identity, and exclusive media job. A coordinator is not a required hop for already-assigned local work.
- On partition or uncertain acknowledgement, do not create a second owner or replay a physical action. Preserve local authorized work, expose stale/unavailable state honestly, and require verified revocation/fencing before takeover.
- Preserve persistent Haus IDs, external aliases, installed add-on slugs, protocols, archive digests, permissions, secrets, and HomeKit pairing. Trace contract changes through producers and consumers before changing them.

## Names, language, and file size

- Prefer one-word lowercase names for apps, packages, directories, and files. If a name needs multiple concepts, use a short category directory and a one-word file. Avoid camelCase, PascalCase, and snake_case in file names; use kebab-case only when a clear one-word name is impractical. TypeScript identifiers follow normal language conventions.
- Write new application and service code in strict TypeScript ESM. Do not add plain JS/MJS without a concrete runtime or tooling need. Python is allowed where HA's integration runtime requires it; native code is allowed for established platform APIs.
- No explicit `any`. Use `unknown`, runtime validation, type guards, and discriminated unions at boundaries. Do not hide errors with `as unknown as T`, broad non-null assertions, `@ts-ignore`, or disabled lint rules. Narrow assertions require a proven invariant and a local explanation.
- Keep authored source, tests, config, and active documentation within 500 lines. Existing larger files are baseline debt: do not grow them; split them in behavior-preserving plan slices. Frozen history, generated output, lockfiles, and required upstream/legal files are exceptions.
- Keep comments and docs concise, nonduplicative, and useful to the next maintainer. Put tasks in `PLAN.md`, durable design in `docs/architecture/`, coding rules here, and dated evidence in `docs/history/`.

## Security and operations

- Treat network, storage, user input, provider payloads, and discovered services as untrusted. Discovery never authenticates a Hub. Validate permissions and deny unknown capabilities by default.
- Never expose credentials, rotating tokens, pairing material, private media URLs, SDP, or command payloads in logs or renderer state. Do not expose a generic Docker/Supervisor management proxy or grant arbitrary containers the host daemon.
- Use isolated fixtures for development. Do not touch production HA, live nodes, MQTT, cameras, radios, HomeKit, archives, or physical devices unless the current task explicitly authorizes that exact operation. A code change, test pass, or commit does not imply deployment permission.
- Preserve known household limits recorded in `PLAN.md`; verify time-sensitive conditions before operational work. Never run hazardous controls unattended.
- Do not reset, clean, overwrite, or delete broad data. Resolve exact targets and preserve recoverable copies before a destructive operation.

## Verification and reporting

- Respect existing `tsconfig`, Oxlint, Prettier, and package scripts; do not weaken configuration to get a pass. Use `pnpm` workspace commands and package filters, not npm/yarn/npx for project work.
- After implementation's final edit, run the narrow relevant checks. For public contracts, imports, or cross-package changes, check affected consumers and architecture boundaries. Use full `pnpm check` at milestone/clean-checkout gates, not after every tiny edit.
- Tests must cover observable behavior, regressions, failure and boundary cases where relevant. A mock does not prove physical or production acceptance.
- Report each check as PASS, FAIL, or NOT RUN with its exact command and observed result. Never claim an unrun command or unsupported hardware outcome.
- Do not skip failing tests, weaken assertions/types, add dummy implementations, catch and ignore errors, or mass-reformat unrelated files to get a green result.
- Final handoff states changed paths, behavior/evidence, checks and limitations, and remaining plan IDs. Do not mark work complete without its acceptance evidence.
