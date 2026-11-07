# Relay, playback and peer test ownership — 2026-11-06

P14.2.3.3.2.3.2.1 is verified. Native transport tests remain P14.2.3.3.2.3.2.2; runtime/integration/tools and Node packaging retirement remain open.

## Changed

- Removed Node's `streams.test.mjs`, `playback-process.test.mjs` and `rtsp-peer.test.mjs`. Their eight test definitions map exactly to four focused strict TypeScript files: Hub's `test/nvr/playback/relay.test.ts`, media's `test/stream/hls.test.ts`, `test/pipeline/playback.test.ts` and `test/camera/peer.test.ts`.
- Hub retains the authenticated HLS HTTP integration. Source generation/serving belongs to a reusable media test fixture; Hub imports that test-only fixture and never assembles FFmpeg arguments. The other three relay cases test the HlsStreams engine directly in media: cancel before process startup, remove stale playlists/files, and use injected executable paths with shell disabled.
- The three playback cases run real FFmpeg/ffprobe through MediaRuntime's existing bounded runMediaProcess API. Unknown probe JSON is validated before selecting video/audio streams. Checks retain dimensions, 40 moving frames, AAC audio, video-bounded duration, original-byte preservation, silent-video support, capacity/format/cancellation rejection, and the real tone after trimming a 943.418-second legacy silent lead.
- The loopback RTSP tunnel still carries a real OPTIONS response and disconnects after owner revocation. Its typed fixture returns the owned session identity and validates the HTTP-upgrade Socket without a cast. Cleanup hooks are registered as resources are created, including partial setup.
- The synthetic HLS fixture retains the eight-second source-start deadline and awaits its child closing at teardown. The end-to-end HLS case has a finite 25-second test budget around the existing eight-second source and twelve-second relay-start budgets; the old Node test was unbounded. Production deadlines are unchanged.
- AST comparison preserves all original assertions: 17 equal, ten ok, nine rejects, two deepEqual, one match and one throws. Added one equal assertion for shell=false and one ok Socket guard; common support guards validate network/probe values.

## Docker compatibility

The Node Dockerfile no longer references the removed playback MJS path. Its shared build stage installs FFmpeg and root development tooling, mounts the media test directory and runs `pnpm exec vitest run packages/media/test/pipeline/playback.test.ts` after package compilation. The stage has the existing root config and disposable Hub test setup; production deployment still excludes development dependencies. The final image retains the transient-workspace check and all native transport checks at their current paths.

This changes build-time test placement only. The Linux Docker image build is NOT RUN in this slice; packaging consolidation and container acceptance remain open. Local macOS execution does not establish Linux/container behavior.

## Observed checks

- PASS — `pnpm --filter @haus/media typecheck` and `pnpm --filter @haus/hub typecheck` after resolving the real Socket/request and blob-initialization signatures, without suppressions or weaker settings.
- PASS — `pnpm exec vitest run packages/media/test/pipeline/playback.test.ts packages/media/test/stream/hls.test.ts packages/media/test/camera/peer.test.ts apps/hub/test/nvr/playback/relay.test.ts`: four files/eight cases, no skips. Synthetic media, loopback networking and disposable filesystem fixtures only.
- PASS — focused `pnpm exec oxlint --deny-warnings`, explicit changed-test Prettier checks, `pnpm architecture:check` (421 source files), exact test/assertion inventory, and `git diff --check`.
- PASS — `pnpm check`, exit 0 after the final implementation edits: workspace types/lint/rules/licenses/format/builds; root 282 files/1481 tests; Kitsune 18/18, HomeKit 21/21; remaining Node 16 passed/10 environment skips; local integration two passed/one provisioned-container skip; Hub 57 files/296 tests. The first attempt stopped at the PLAN.md line-count rule; the duplicate release heading was removed while preserving every requirement, and the full rerun passed.

## Continuation

Select P14.2.3.3.2.3.2.2 next: native IPC/browser-answer/RTP suites, split fixtures and real native loopback checks. Keep environment skips explicit and retain the Docker native test paths until their replacements are wired. Then migrate runtime/integration/tools and retire Node packaging. No production, household resource, device or deployment was touched. The goal and hourly automation remain active without subagents; commit/push waits for completion of the agreed plan.
