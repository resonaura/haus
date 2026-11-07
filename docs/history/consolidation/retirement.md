# Node workspace retirement — 2026-11-07

P14.2.3.3.3.3 is verified locally. The Node package, its redundant Dockerfile and all 26 authored paths still tracked at this slice's baseline are absent from the working tree. Earlier runtime/test/native moves retain their separate evidence. Actual Linux image acceptance is still pending under P14.2.3.3.3.1, so its parent milestones remain in progress.

## Final consumers

- Root `check:apps` keeps its command name and runs the owning Hub suite directly after service builds/Kitsune/HomeKit. The moved runtime and integration suites already belong to Hub's normal Vitest inclusion; deleting the two Node wrapper invocations removes duplicate runs without dropping their cases. The separate Hub integration command remains available.
- pnpm reports nineteen projects including the root, with no @haus/node. Lockfile regeneration removed only the 27-line Node importer; dependency versions/snapshots did not change. A subsequent frozen/offline install succeeds. CI targets and Desktop pairing-document links point to Hub's shared recipe/profiles/docs.
- Seven obsolete Node file/directory debt allowances are removed, tightening the existing engineering baseline. The current architecture and complete eighteen-package license inventory no longer describe Node as an application. Historical extraction/reconciliation references remain labeled historical; root agent instructions are preserved.
- The first authored-path inventory found the two hidden Node ignore files after ordinary visible-file searches missed them. Before deleting them, their private/generated-file protection moved into root Git ignores: pairing keys (including nested node.key files), legacy Node data/model output and the AI owner's model. The Hub build context also excludes keys, local media and temporary local data. The retirement removes only known authored files and performs no data/key migration. Existing legacy data/format exclusions remain protective exceptions rather than active package dependencies.
- The former Node LICENSE matched the retained root GPL text before removal. Model attribution remains with AI; release history and icon were moved with byte comparisons in the deployment slice.

## Observed checks

- PASS — `pnpm install --lockfile-only --frozen-lockfile=false --offline --ignore-scripts` regenerates the intentionally changed workspace inventory; final `pnpm install --frozen-lockfile --offline --ignore-scripts --prod=false` succeeds. Future CI still enforces the frozen lockfile.
- PASS — `pnpm list --recursive --depth -1 --json`: nineteen projects including root, no Node package. All 26 indexed Node source paths are absent; the eighteen-package license table exactly matches current workspace manifests.
- PASS — `git check-ignore --no-index` on synthetic path names confirms legacy data, direct/nested pairing keys and old/new model output stay ignored. This checks patterns without creating or reading those files.
- PASS — final `HAUS_NVR_TEST_DISPOSABLE=0 pnpm check`, exit 0, with optional playback report/retention variables unset: types, lint, rules/licenses, formatting and builds; root 1550 passed/eleven environment skips; Kitsune 25, HomeKit 21; Hub 335 passed/three skips. Hub contains the moved runtime/integration tests and four new health cases. Node wrapper runs are gone.
- PASS — architecture, explicit formatting for normally ignored Hub tests/docs/deploy assets, five exact Compose comparisons, current documentation links and `git diff --check`. The independent production-artifact process/schema/health checks are recorded in the image evidence.

## Remaining requirements

Neither a registry publication nor an installed upgrade occurred. No branch was changed and no commit/push was performed. The shared image recipe still needs an actual Linux build/run because the configured local daemon is unavailable; do not promote P14.2/P14.2.3/P14.2.3.3 or their packaging parent yet. Remaining P14.3–P14.9 and P16 acceptance requirements, including legacy behavior parity, standalone authorization and measured resilience/performance, remain active. Continue those independent local source slices without operating household systems.
