# Haus native namespace — 2026-11-06

P14.2.3.3.1.1 is verified: owned native code uses `haus` instead of `tuya` as its C++ namespace, as explicitly requested by the user.

## Changed

- Renamed namespace declarations, closing comments and qualified references in 30 owned C++ files: eleven media implementation/header files, four native regressions and fifteen linked Kitsune protocol implementation/header files. AI already uses `haus::vision` and needs no change.
- No namespace alias or compatibility shim keeps the old name. Application-facing IPC, JSON fields, executable names, source identifiers, protocol payloads and vendor names retain their existing values. Kitsune keeps ownership of vendor protocol code and its existing CMake source boundary.
- A snapshot comparison reverses only the namespace replacement in every changed file and reproduces the pre-edit bytes exactly. No algorithm, condition, compiler option, dependency version, protocol string or line count changed. The generic native extraction's older byte-identical-source evidence predates this new user requirement.
- Media README records `namespace haus` as the owned native convention and documents the new native TypeScript loopback test command and environment skips.

## Observed evidence

- PASS — `pnpm --filter @haus/media build:native`, exit 0: Release camera engine, linked Kitsune implementations and four native regression executables compile/link on the existing macOS arm64 toolchain. The build reuses the same pinned source/dependency cache and compile options.
- PASS — `nm .cache/media-native/haus-camera-media | c++filt` plus explicit assertions over all listed symbols: `haus::IpcServer`, `haus::BrowserPeer`, `haus::StreamSession` are present; no `tuya::` symbol remains.
- PASS — owned-source search finds no `namespace tuya`, `tuya::` or `using namespace tuya` in C++ files. All 30 reverse-replacement byte comparisons pass.
- PASS — `pnpm --filter @haus/media check:native`: all four owned CTests, including feedback/NACK, continuity, writer and pacing, pass after rebuilding the namespace change.
- PASS — `HAUS_CAMERA_MEDIA_BIN=$PWD/.cache/media-native/haus-camera-media pnpm exec vitest run packages/media/test/native`: ten files/thirteen cases, zero skips against the rebuilt binary. Covers the actual engine's IPC, repeated browser answers, real audio/video capture, cached-picture decoding, RTP bursts and AAC clocks.
- PASS — final combined `pnpm check`, exit 0: root 1483 passed/eight explicit native skips, Hub 296, Kitsune 18, HomeKit 21, remaining Node 14 passed/two tmpfs skips, local integration two passed/one container skip, plus all workspace types/lint/rules/licenses/format/builds. No assertion, benchmark threshold or configuration was weakened after the earlier statistics benchmark failure recorded in transport.md.

## Limits and continuation

Local synthetic loopback verification does not establish Linux image, Windows native, real vendor-device or production acceptance. No household service, camera, pairing, archive or deployment was operated. Native protocol identifiers remain unchanged. Continue the active Node runtime/integration/tool migration after this and the native test ownership slice pass their final gate. The goal and automation remain active without subagents; commit/push still waits for completion of the agreed plan, on the existing branch.
