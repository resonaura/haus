# Pi runtime — 2026-11-17

The user explicitly requested remote replacement of HAOS on the existing Raspberry Pi SD, hostname `haus`, without physical access or USB, and declined a full HA backup. The Pi was identified as a Raspberry Pi 4B Rev 1.5 with 4 GB RAM, Ethernet and a 128 GB SD.

## Installed OS

Downloaded the official Raspberry Pi OS Lite arm64/Trixie image dated 2026-10-06 and verified its published SHA-256 before customization. Prepared the user, existing Ethernet address, SSH identity and hostname offline. The first temporary netboot attempt returned to HAOS without overwriting the SD. A second, autonomous initramfs provided authenticated SSH with its root in RAM and no SD mounts. The exact SD identity was checked before writing.

Wrote 3,078,619,136 image bytes in 104 seconds. Both the initial readback and a second full readback after `blockdev --flushbufs` matched the prepared image digest. The installed system boots as `haus`, kernel `6.18.50+rpt-rpi-v8`; SSH, sudo and NetworkManager work. The ext4 root expanded to 117 GiB with 109 GiB free. Existing Mac SSH access was authorized and tested. BlueZ exposes the real controller and the expected video/render device nodes exist; actual hardware video decoding was not exercised.

## Eufy Life and Bluetooth

The original Eufy Life entry and both weight endpoint IDs were retained on Miku with the Living Room assignment. Its HA source was disabled/unloaded before the reimage. Unknown and unavailable weights had been incorrectly projected as strings. The shared sensor projection now preserves numeric weight metadata and units before the first measurement; unknown states produce no fabricated readings. Both live Miku endpoints now report numeric capabilities in kilograms.

The Pi runs [bt-proxy](https://github.com/denvera/bt-proxy) pinned to commit `95143174029667c047a429ac2b9ade5623508cb8`, using Debian Bleak 0.22.3 and Zeroconf 0.147.0. It implements the ESPHome Native API, including advertisements and GATT. Its plaintext listener and mDNS advertisement are confined to loopback. A systemd-managed, authenticated SSH tunnel exposes that listener only on Miku loopback; the dedicated SSH account permits forwarding only to that proxy and denies shell, other ports and remote forwarding. Miku adopted it through the real ESPHome config flow as `Haus Bluetooth`. No fake radio agent or second Eufy integration was created.

A real API client received 1,662 advertisements from 51 devices through the encrypted path. After a normal Pi reboot, SSH and the proxy returned automatically and the same path received 1,669 advertisements from 49 devices. The scale itself did not advertise during either observation; an actual weighing and GATT interaction with the scale remain **not verified**.

The Miku Hub update changed only the three compiled sensor-projection modules. Its previous container was stopped before the replacement started. Readback retained all 113 devices and their names/rooms, eight scenes and 17 automations. The source image remains stopped for operational rollback.

## Checks

- PASS — `pnpm exec vitest run packages/kitsune/test/ha/sensor.test.ts packages/kitsune/test/ha/classification.test.ts packages/kitsune/test/virtualization.test.ts --reporter=dot`: 18 tests.
- PASS — `pnpm --filter @haus/kitsune build`; `pnpm --filter @haus/hub typecheck`; `pnpm architecture:check`.
- PASS — focused Oxlint, Prettier and `git diff --check`; isolated candidate-image projection checks and live numeric endpoint readback.
- FAIL — `pnpm --filter @haus/kitsune typecheck`: seven existing Buffer/BodyInit errors in the separately authored `test/hacs-updater.test.ts`. That file was not changed by this slice.
- PASS — full SD SHA readback, installed OS/SSH/sudo/root-size checks, real BLE reception, restricted transport policy and reboot recovery. Private credentials and operational evidence remain in ignored local storage.
