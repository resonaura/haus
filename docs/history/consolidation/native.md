# Native media ownership — 2026-11-06

P14.2.3.3.1 is verified. Node test/tool migration and package/deploy retirement remain open under P14.2.3.3.

## Changed

- Moved the generic camera engine from `apps/node/native` to `packages/media/native`: IPC, browser WebRTC, RTP ingress/continuity/pacing, RTCP feedback and RTSP framing. All eleven production source/header files compare byte for byte with their pre-move Git versions. No algorithm, executable name, IPC framing or camera ownership behavior changed.
- Vendor Tuya implementations remain in Kitsune. The CMake root preserves glaze v4.4.2 and libdatachannel v0.22.3 and links the explicit `KITSUNE_NATIVE_DIR` port. The private media package now carries its native source and optional build scripts; ordinary TypeScript builds still need no native toolchain.
- Three C++ fixtures moved from Node into focused media tests; the old Node MJS compiler wrapper was removed and replaced by `packages/media/test/native/core.test.ts`. The same RTP/RTSP checks run in Vitest with optimization and NDEBUG defined. Fixtures explicitly retain assertions, including operations inside assert expressions.
- Added independent CMake transport tests that need no downloaded WebRTC dependencies. All four Haus native tests have the `haus` CTest label; the optional full build also exercises feedback against the actual pinned library. The NVR Docker builder reads media-owned source and runs that owned suite. Its final-stage test list no longer references the deleted Node wrapper.
- Native generated output lives in the root `.cache`, outside authored packages and published sources. Package README and the extraction audit document the build/ownership boundary.

## Observed checks

All native protocol scenarios used loopback fixture streams and synthetic browser offers. No camera, household node, pairing, archive, service or deployment was operated.

- PASS — `pnpm --filter @haus/media build:native`, Release: full pinned WebRTC/SRTP/vendor engine and regression binaries compile and link on macOS arm64. A second build verifies the final root-cache path. Initial fetched dependency sources were reused for that relocation through CMake's explicit FETCHCONTENT_SOURCE_DIR ports; no version or source was changed.
- PASS — `pnpm --filter @haus/media check:native`: all four owned tests pass (continuity, writer, pacer, feedback).
- PASS — `pnpm --filter @haus/media test:native`: clean dependency-independent Release build and all three transport regressions pass.
- PASS — `pnpm exec vitest run packages/media/test`: 6 files/23 tests, including the three moved native cases.
- PASS — `pnpm --filter @haus/media typecheck` and `pnpm --filter @haus/media build`.
- PASS — `pnpm exec tsc --ignoreConfig --noEmit --strict --skipLibCheck --module nodenext --target es2023 --types node packages/media/test/native/core.test.ts`. Initial direct tsc invocations omitted TS7's explicit-config bypass and Node type selection; the corrected strict invocation passes without a source/config suppression.
- PASS — `pnpm --filter @haus/node test`: 149 passed/10 environment skips; the three moved tests now run in media rather than Node.
- PASS — `HAUS_CAMERA_MEDIA_BIN=/Users/resonaura/haus/.cache/media-native/haus-camera-media node --test apps/node/test/camera-media-native.test.mjs apps/node/test/native-camera-media.test.mjs apps/node/test/native-rtp-burst.test.mjs apps/node/test/native-browser-answer.test.mjs`: 10/10, zero skips. Covers native relay startup, audio/video pre-roll, real browser answers, repeated signaling, large H.264 bursts, AAC wraparound and late-reader cached pictures. This is a local protocol integration, not physical camera acceptance.
- PASS — `pnpm architecture:check` (421 source files), `pnpm rules:check`, `pnpm lint`, changed-file Prettier and `git diff --check`.

## Failures and limits

The first package-local cache location caused provenance checks to scan generated CMake TypeScript dependency files and upstream source. Build outputs were moved to the root cache and both scripts corrected; provenance passes without weakening scanner rules or editing upstream licenses.

An initial unfiltered `ctest --test-dir .cache/media-native --output-on-failure` ran the four Haus tests successfully but also discovered ten bundled SRTP tests from an EXCLUDE_FROM_ALL dependency. Eight of those executables were not built, so that command failed. The documented package and Docker checks now select the explicit Haus label and run every owned test; no Haus assertion was removed or disabled. The complete upstream SRTP test suite remains outside this acceptance and is not verified.

Linux image build, ARM/x86 container coverage, Windows native support and physical camera behavior were not verified. No Docker daemon/build/push or service installation was used. Full `pnpm check` was not repeated for this source-location slice; the previous runtime milestone passed it, and this slice has the focused source, package, consumer, native and architecture evidence above.

Continue P14.2.3.3.2: move remaining Node tests/tools into their owning strict TypeScript packages, preserving negative/integration coverage and splitting existing oversized fixtures. Then consolidate Docker/compose/CI/install assets and remove the Node package under P14.2.3.3.3. Keep data/key/image compatibility and the existing production boundary. The goal and hourly automation remain active without subagents; commit/push still waits for the agreed plan's completion.
