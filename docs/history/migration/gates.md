# Migration checkpoint quality gates — 2026-11-11

## P18.1.4

The checkpoint initially failed lint, engineering limits, license headers, formatting and then two tests. The gate was retained throughout; no assertion, limit or check was disabled.

- Extracted desktop connection-health state/update/timing into a hook; preference loading stays with preference synchronization. The original hook is below its locked legacy size.
- Separated the HAP HTTP message parser and memory room-move repository, preserving public exports. Protocol tests now form a focused directory; standalone Kitsune acceptance is separate from controller fixtures. Parser fixtures cover partial bodies, HTTP/Event boundaries and chunked completion.
- Removed unused local bindings and restored the missing copyright line. Seven formatting-only files emit identical JavaScript under the installed SWC transform before and after formatting.
- Ordinary server requests no longer issue an unnecessary session IPC call; the previous implementation masked the older-Helper update guidance when that call was unavailable. The original banner regression now passes.
- Parallel Hub fixtures use ephemeral loopback MQTT listeners. Supervisor unit fixtures explicitly provide their isolated environment. They still run real TCP brokers; production port defaults are unchanged.

The first full test run had 457 passing files, one failed test and one failed suite. The occupied-port broker bug is documented separately below. Final observed `pnpm check` completed with exit 0: workspace types, lint, engineering/architecture rules, license provenance, formatting, builds and all configured tests passed. The main run had **460 passed / 9 skipped files, 2337 passed / 11 skipped tests**. `check:apps` also passed Kitsune (31 tests), HomeKit (25 tests) and Hub (889 passed / 3 skipped tests). Counts overlap; they are not distinct-test totals. `git diff --check` passed. These checks do not prove household hardware behavior or close the remaining migration plan.

Commits so far: `ec26141` (HAP parser / room-move persistence separation and protocol test grouping), `5445433` (broker failed-bind shutdown and fixture isolation), `5439d79` (formatting, unused bindings and license-header cleanup). Other existing migration changes remain in the worktree and are not implicitly included in those commits.

## P18.2.5.8

A real loopback occupied-listener regression first failed: `listen()` correctly rejected `EADDRINUSE`, but `close()` then rejected `ERR_SERVER_NOT_RUNNING`, masking the startup failure. Broker close now shares an in-flight shutdown and treats the specifically identified already-unbound socket as closed. Other close errors still propagate. A new listen waits for a pending shutdown.

The regression verifies the original bind failure, cleanup, repeated/concurrent close, reuse of the released port, and concurrent close of the restarted broker. The focused final run also covered client reconnect, Supervisor fixtures, streaming/events and the server banner: **5 files / 30 tests passed**. The full workspace gate above passed afterward. No production broker or household device was restarted for this fix.
