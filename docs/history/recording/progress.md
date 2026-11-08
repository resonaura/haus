# Recording progress ownership — 2026-11-07

P14.3.2 moves the FFmpeg `-progress` parser from `apps/hub/lib/recording-progress.mjs` to `@haus/media/recording` (`RecordingProgress`). The current typed recorder imports it in `apps/hub/src/events/recorder/buffer.ts`; `out_time_us` is parsed in one place. The MJS implementation and its MJS test are deleted with no re-export.

## Behavior preserved

- Stream-copy releases without a frame counter still prove progress through advancing `out_time_us`; `frame` and `out_time_us` advance independently.
- Repeated, regressed, zero or invalid values never count as progress; split chunks are reassembled; unfinished output is bounded (8192 characters) and never exposed. A new process starts with fresh state.
- Review reproduced two chunk-boundary faults: trimming an entire large chunk lost an earlier valid frame counter, and trimming a malformed line could turn its suffix into valid progress. Both new regressions failed before the fix. The parser now processes complete lines before discarding oversized lines through their newline, including across separate chunks.
- Sustained thresholds are unchanged (120 frames or 6 s of output time).

The three original MJS cases retain their assertions in `packages/media/test/recording/progress.test.ts` (private partial length uses the numeric getter). Three additional cases cover split `Buffer` chunks/privacy and the two reproduced faults.

## Observed checks

- RED — `pnpm exec vitest run packages/media/test/recording/progress.test.ts`: two new failures, four existing passes (`/tmp/haus-progress-boundaries-red.log`).
- PASS — `pnpm exec vitest run packages/media/test/recording`: 5 files, 12 cases; final extended boundary cases also pass 6/6 in the focused file.
- PASS — `pnpm --filter @haus/hub exec node --test test/recorder.test.mjs test/recording-input.test.mjs`: 24/24, real synthetic FFmpeg/HLS/RTSP, including stall termination, storage pause, verified originals and compatibility repair (`/tmp/haus-progress-typed-consumers.log`, exit 0).
- PASS — `pnpm --filter @haus/media typecheck`, `pnpm --filter @haus/media build`, HA/Kitsune builds and Hub SWC transpilation before running the typed consumer. Focused Oxlint, explicit Prettier and `git diff --check` pass.
- FAIL — initial `pnpm check` stops at Hub typechecking: 66 errors in pending camera/bootstrap/server ports (`/tmp/haus-current-ports-check.log`, exit 1). Those ports changed further during review; transpilation and these runtime tests do not prove their final type safety or Nest composition. The 24-case legacy consumer run preceded the subsequent lib retirement; its imports need acceptance again after P14.5.
- PASS — final Hub typecheck/build and `pnpm --filter @haus/hub check`: 462 passed/three skipped (`/tmp/haus-handoff-hub-check.log`, exit 0). The initial type failures were corrected in the wider port; actual Nest recorder injection remains open under P14.3.5.

No household camera, archive or HA instance was touched. P14.3.2 is reviewed; the parent remains pending review of the other recording slices and composition.
