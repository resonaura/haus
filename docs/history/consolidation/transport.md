# Native transport test ownership — 2026-11-06

P14.2.3.3.2.3.2.2 is verified. The user's subsequent `haus` native namespace requirement is also verified separately by P14.2.3.3.1.1.

## Changed

- Removed the four remaining Node native MJS suites. Their ten scenarios now live in nine focused strict TypeScript files under `packages/media/test/native`: relay, capture, cached picture, repeated browser signaling, diagnostics/producer lifecycle, cached parameter sets, large receive burst, audio clock and clean live-IDR joining. Existing independent C++ compilation tests remain in core.test.ts.
- Extracted small media-local fixtures for native IPC, loopback port allocation, interleaved RTSP/RTP parsing, packet generation, synthetic browser offers and complete typed session/viewer data. Process creation uses MediaRuntime and its configured paths, including synthetic FFmpeg generators. No application import or new production API is required.
- Native IPC fixtures validate unknown JSON events, bound line/event storage, surface malformed output/process failures and await an owned child closing with bounded graceful shutdown and kill fallback. Capture cleanup attempts every resource and reports failures instead of suppressing them. Two UDP fixture sends now propagate their actual send errors rather than treating an error argument as successful completion.
- AST inventory maps all ten original test names exactly and preserves every original assertion count: 45 equal, twelve ok, ten deepEqual, six match and three doesNotMatch. Shared guards narrow required rows, probe/signaling values and complete fixture shapes without casts through unknown, explicit any or compiler suppressions.
- Existing explicit 10/15/20/30-second native deadlines and the receive-buffer/Windows skips remain. The two formerly unbounded Node relay/capture cases now have finite 20/60-second test budgets around their existing readiness/recording deadlines. No production timeout, packet requirement, frame/audio assertion or receive-buffer threshold was weakened.
- Docker's media-verification stage runs the media native Vitest directory with the freshly built engine and development-only compiler/runner. The final image copies deployment output through that stage so verification cannot be bypassed as an unused build stage; no removed MJS test path remains. Its production dependencies and executable paths are preserved. Linux image build/container acceptance remains NOT RUN in this slice.

## Observed checks

All native streams, UDP/TCP readers and synthetic browser offers are local disposable fixtures. No camera, household node, HA service, pairing, archive or deployment was operated.

- PASS — `pnpm --filter @haus/media typecheck`, exit 0 after resolving actual job diagnostics and UDP callback signatures without weakening types.
- PASS — `HAUS_CAMERA_MEDIA_BIN=$PWD/.cache/media-native/haus-camera-media pnpm exec vitest run packages/media/test/native`: ten files/thirteen tests, zero skips. Ten migrated scenarios plus three independent C++ regressions. Real pre-roll contains audio/video, cached long-GOP IDR decodes before the next source keyframe, repeated browser answers retain fixed DTLS roles, H.264 burst payloads/sequences/clocks and AAC wraparound survive, and late readers wait for a clean complete IDR.
- PASS — `pnpm --filter @haus/media check:native`: four owned CTests, including actual pinned-library RTCP feedback/NACK, continuity, partial/stalled interleaved writer and pacing.
- PASS — focused `pnpm exec oxlint --deny-warnings`, changed-file formatting, exact test/assertion inventory and `git diff --check`.
- FAIL — the first `pnpm check` completed types/lint/rules/format/builds, root 1483 passed/eight explicit native skips, Kitsune 18, HomeKit 21, Node 14 passed/two tmpfs skips and local integration two passed/one container skip. Final Hub suite had 295 passed and one unchanged statistics benchmark failure: 286 ms versus its 150 ms limit. `git diff` confirms no statistics source/test changes. Focused `pnpm --filter @haus/hub exec vitest run test/nest/stats-api.test.ts` then passed 7/7 without changing the threshold. The observed query jitter is retained for P16.4 analysis.
- PASS — final `pnpm check`, exit 0 after all implementation edits and the namespace follow-up: workspace typechecks/lint/rules/licenses/format/builds, root 1483 passed/eight explicit native skips, Kitsune 18, HomeKit 21, Node 14 passed/two tmpfs skips, local integration two passed/one container skip, Hub 296/296. No statistics source, assertion or benchmark threshold changed.

## Continuation

P14.2.3.3.1.1 is verified: owned native namespaces are `haus`, protocol/wire names remain unchanged, rebuilt symbols and all native cases pass (namespace.md). Next P14.2.3.3.2.3.3 migrates the three remaining Node runtime test files, integration suites and model/install tools. Node packaging retirement and the broader P14/P16 work remain open. The goal and hourly automation stay active without subagents. Commit/push waits for completion of the agreed plan; branches and production remain untouched.
