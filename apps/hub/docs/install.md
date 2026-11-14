<!-- Haus — A thoughtful home. -->
<!-- Copyright © 2026 Andrii Vynohradov. All rights reserved. -->
<!-- Licensed under the GNU General Public License v3.0 or later; see LICENSE. -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later. -->

# Installing Standalone Haus Hub (Linux, Docker & Windows + WSL2)

Haus Hub can run standalone on a Linux host, inside Docker, or on **Windows + WSL2** without requiring Home Assistant OS or Supervisor.

> For running the Home Assistant add-on inside an existing HA OS installation, see [`../DOCS.md`](../DOCS.md).

---

## 1. Requirements & Runtime Defaults

| Component | Requirement / Default |
| --- | --- |
| Node.js | `>= 24.11.0` (`pnpm@11.22.0` from repository root) |
| Media & integrations | `ffmpeg` on `PATH` (for cameras/NVR), optional `python3` / `uv` for HA Python compatibility flows |
| Persistent data (`HAUS_DATA_DIR`) | Native Linux filesystem path (default `/var/lib/haus`, or Docker volume `/data`) |
| HTTP / WebSocket API (`PORT`) | `8790/tcp` |
| Discovery / protocols | `5353/udp` (mDNS), `1883/tcp` (MQTT, optional), `51828/tcp` (HomeKit, optional) |
| NVR (when `HAUS_ROLES` enabled) | `8098/tcp` + `8555-8631/udp` |
| WSL2 NAT LAN relay (`HAUS_LAN_RELAY_PORT`) | `8791/tcp` (Windows host relay, NAT fallback only) |

### Key Environment Variables

- `HAUS_DATA_DIR` — persistent SQLite database, keys, and state directory (must live on Linux ext4/btrfs/xfs or a named Docker volume, **never** on `/mnt/c/...`).
- `PORT` / `HAUS_BIND_ADDRESS` — Hub listener port (default `8790`) and bind IP (default `0.0.0.0`).
- `HAUS_PUBLIC_URL` / `HAUS_HUB_URL` — externally reachable base URL (for example `http://192.168.1.50:8790`), used by auth flows, pairing hints, and reverse-proxy/WSL setups.
- `HAUS_FRONTEND_BASE` — optional frontend URL override (defaults to `HAUS_PUBLIC_URL`, `HAUS_HUB_URL`, or `http://127.0.0.1:${PORT}`).
- `HAUS_WSL_NETWORKING` — optional override (`mirrored` or `nat`) when automatic detection needs pinning.
- `HAUS_LAN_RELAY_URL` — Windows LAN relay URL (`auto` resolves to `http://<default-gateway>:8791` in WSL2 NAT mode, which the Hub also auto-probes when unset under WSL2 NAT).
- `HAUS_MDNS_ADVERTISE` / `HAUS_MDNS_ADDRESS` — control `_haus-hub._tcp` mDNS announcements and pin a specific LAN IPv4 address.

---

## 2. Linux Installation

### Option A: Automated Native `systemd` Setup

From a built repository checkout:

```bash
pnpm install --frozen-lockfile
pnpm -r --filter @haus/hub... build
sudo bash apps/hub/install/hub.sh --mode native --data-dir /var/lib/haus --port 8790
```

What [`install/hub.sh`](../install/hub.sh) does:

- Verifies Node.js `>= 24`, checks `ffmpeg`, and rejects unsafe `/mnt/<drive>` paths.
- Creates an isolated service user (`--user`, default caller or `haus`) and `/var/lib/haus` (`0750`).
- Writes `/etc/haus/hub.env` once (existing env files and secrets are preserved unless `--force-env` is passed).
- Installs and enables `/etc/systemd/system/haus-hub.service` (reference template in [`deploy/haus-hub.service`](../deploy/haus-hub.service)) with `CAP_NET_RAW` for BLE/network capabilities.

Useful installer flags: `--check-only`, `--dry-run`, `--public-url http://192.168.1.50:8790`, `--no-systemd`, `--yes`.

### Option B: Standalone Docker Compose

Prepare `.env` safely with the installer or CLI generator, then start [`deploy/hub/compose.yaml`](../deploy/hub/compose.yaml):

```bash
bash apps/hub/install/hub.sh --mode docker --data-dir /var/lib/haus --no-systemd
docker build --target hub --file apps/hub/Dockerfile --tag haus-hub:local .
HAUS_IMAGE=haus-hub:local docker compose -f apps/hub/deploy/hub/compose.yaml -f apps/hub/deploy/hub/wsl-mirrored.yaml up -d
```

Adding [`deploy/hub/wsl-mirrored.yaml`](../deploy/hub/wsl-mirrored.yaml) switches Docker to `network_mode: host` + `NET_RAW`, allowing native mDNS, SSDP, and LAN device discovery directly from the container.

---

## 3. Windows + WSL2 Installation

Haus Hub actively inspects the WSL2 environment at startup and via `pnpm --filter @haus/hub wsl --check`. Keep these three rules in mind before installing:

1. **Store Hub data on Linux `ext4`, never `/mnt/c/...`:** WSL2 accesses Windows drives over 9P/DrvFs, which breaks SQLite WAL file locking under load, stalls camera/FFmpeg I/O, and loses POSIX file permissions. Use `/var/lib/haus` (or a named Docker volume), never `/mnt/c/Users/...`. Hub diagnostics raise `wsl_data_on_windows_mount` and installers refuse `/mnt/<drive>` paths.
2. **Enable `systemd` inside WSL2:** `/etc/wsl.conf` needs `[boot]` `systemd=true` (followed by `wsl --shutdown` on Windows once).
3. **Keep the distro running headless without an open terminal:** WSL2 automatically stops a distribution ~8 seconds after the last interactive shell closes. Because WSL distributions are registered **per Windows user (`HKCU`)** rather than `LocalSystem`, background startup tasks must run under your logged-in Windows user account (`-AtLogOn`). [`install/wsl-windows.ps1`](../install/wsl-windows.ps1) automates this cleanly.

### Choosing Mirrored vs NAT Mode

| Capability | Mirrored Mode (**Recommended**, Windows 11 22H2+) | NAT Mode (Fallback / Windows 10) |
| --- | --- | --- |
| Inbound Desktop/Mobile connections | Direct to Windows LAN IP | Requires `netsh interface portproxy` (refresh after reboots) |
| mDNS / SSDP / ARP device discovery | Works natively inside WSL2 | Blocked across Hyper-V NAT; needs `scripts/lan-relay.ts` + `scripts/advertise.ts` on Windows |
| HomeKit bridge & Matter/local multicast | Direct (`wsl-mirrored.yaml` or native `systemd`) | Limited by Hyper-V NAT multicast isolation |
| Hub automatic behavior | Advertises LAN IP (`wsl_mirrored_networking_active`) | Suppresses unreachable `172.x` NAT mDNS (`wsl_nat_mdns_limited`) and auto-probes `http://<gateway>:8791` |

---

### Path A (Recommended): WSL2 Mirrored Networking

#### Step 1 — Configure Windows Host (Elevated PowerShell as Administrator)

From the repository folder on Windows:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\apps\hub\install\wsl-windows.ps1 -Action SetupMirrored -Distro Ubuntu -Port 8790 -RegisterStartupTask
wsl --shutdown
```

Optional switches: `-IncludeHomeKit` (TCP `51828`), `-IncludeNvr` (TCP `8098` + UDP `8555-8631`), `-MqttPort 1883`, `-DryRun`.

What this script configures:

- Merges `[wsl2]` `networkingMode=mirrored`, `hostAddressLoopback=true`, and `dnsTunneling=true` into `%UserProfile%\.wslconfig` using **UTF-8 without BOM** (a UTF-8 BOM silently breaks Windows's `.wslconfig` INI parser), backing up any existing file.
- Adds **Windows Defender Firewall** Private-profile inbound allow rules for Haus Hub (`8790/tcp`, mDNS `5353/udp`, MQTT `1883/tcp`, plus optional HomeKit/NVR).
- Registers per-user Task Scheduler logon job `Haus-WSL-Keepalive-<Distro>` so WSL + `systemd` stay alive after login without keeping a terminal window open.

> **Important:** After running `wsl --shutdown`, reopen your WSL distribution (or trigger the logon task) so Windows applies `.wslconfig`.

#### Step 2 — Build & Install Inside the WSL2 Distro (Ubuntu)

Clone and keep the checkout on the Linux filesystem (e.g. `~/haus` or `/opt/haus`, not `/mnt/c/...`), then run:

```bash
pnpm install --frozen-lockfile
pnpm -r --filter @haus/hub... build
pnpm --filter @haus/hub wsl --check --data-dir /var/lib/haus
sudo bash apps/hub/install/hub.sh --mode native --data-dir /var/lib/haus --port 8790
```

If `/etc/wsl.conf` was updated on this run (`systemd=true` was not active yet), run one more `wsl --shutdown` in Windows PowerShell, reopen Ubuntu, and start/verify the service:

```bash
sudo systemctl enable --now haus-hub
sudo systemctl status haus-hub
curl -fsS http://127.0.0.1:8790/health
```

#### Note on Docker in WSL2 (Native Engine vs Docker Desktop)

- **Native Docker Engine inside Ubuntu WSL2** (installed via `apt` / official Docker repo with `systemd=true`): supports full Linux host networking. Start Hub with:
  ```bash
  docker compose -f apps/hub/deploy/hub/compose.yaml -f apps/hub/deploy/hub/wsl-mirrored.yaml up -d
  ```
- **Docker Desktop for Windows**: runs containers inside its own `docker-desktop` utility VM rather than Ubuntu's kernel namespace. Prefer running [`deploy/hub/compose.yaml`](../deploy/hub/compose.yaml) (published ports) plus Windows LAN relay/advertiser, or install native Docker Engine inside WSL2 instead.

---

### Path B (Fallback): WSL2 NAT Networking

If your Windows build or VPN policy requires `networkingMode=nat` (`eth0` has a `172.16.0.0/12` virtual NAT address):

1. **Inside WSL2:** run [`install/hub.sh`](../install/hub.sh) passing your Windows host's LAN IP so `HAUS_PUBLIC_URL`, `HAUS_HUB_URL`, `HAUS_WSL_NETWORKING=nat`, `HAUS_LAN_RELAY_URL=auto`, and `HAUS_MDNS_ADVERTISE=0` are configured:
   ```bash
   sudo bash apps/hub/install/hub.sh --mode native --data-dir /var/lib/haus --public-url http://192.168.1.50:8790
   ```
   When running inside WSL2 NAT without an explicit `HAUS_LAN_RELAY_URL`, Haus Hub automatically probes `http://<default-gateway>:8791` for SSDP/mDNS/ARP discovery and suppresses unreachable `172.x` mDNS announcements.

2. **On Windows (Elevated PowerShell as Administrator):** forward LAN traffic from Windows into WSL2:
   ```powershell
   .\apps\hub\install\wsl-windows.ps1 -Action SetupNat -Distro Ubuntu -Port 8790 -RegisterStartupTask
   ```
   Because WSL2 NAT dynamically reassigns the distro's `172.x` IP after reboots or `wsl --shutdown`, refresh the forwarding rule whenever WSL restarts:
   ```powershell
   .\apps\hub\install\wsl-windows.ps1 -Action RefreshPortProxy -Distro Ubuntu -Port 8790
   ```

3. **On Windows (LAN discovery bridge & mDNS advertiser):** run both Windows-side helpers so Hub discovers smart-home devices on your physical LAN and Mobile/Desktop apps auto-discover the Hub:
   ```powershell
   # Terminal 1: Windows LAN discovery relay (TCP 8791)
   pnpm tsx scripts/lan-relay.ts

   # Terminal 2: Publish Hub mDNS (_haus-hub._tcp) pointing to your Windows LAN IP
   $env:HAUS_HUB_ID="hub-standalone-01"
   $env:HAUS_MDNS_ADDRESS="192.168.1.50"
   $env:PORT="8790"
   pnpm tsx scripts/advertise.ts
   ```

---

## 4. USB Radio & Bluetooth Adapters on WSL2 (`usbipd-win`)

WSL2 does not see Windows USB Zigbee, Thread, or Bluetooth dongles until attached via `usbipd-win` (run in Elevated Windows PowerShell):

```powershell
winget install --exact dorssel.usbipd-win
usbipd list
usbipd bind --busid <BUSID>
usbipd attach --wsl --busid <BUSID>
```

Re-run `usbipd attach --wsl --busid <BUSID>` after Windows reboots or replugging the adapter, then check `/dev/ttyUSB*` / `/dev/ttyACM*` / `hciconfig` inside WSL2.

---

## 5. Connecting Desktop & Mobile Clients

- Open **Haus Desktop** (or Mobile) on the same LAN, open **Pair Server / Connect**, and either select the discovered Hub or enter `http://<HOST_OR_WINDOWS_LAN_IP>:8790`.
- Verify diagnostics anytime with the built-in CLI (`--json` and `--strict` also supported):

```bash
pnpm --filter @haus/hub wsl --check
pnpm --filter @haus/hub wsl --env-template --data-dir /var/lib/haus
```

---

## 6. Troubleshooting WSL2

| Symptom | Cause | Fix |
| --- | --- | --- |
| `wsl_data_on_windows_mount` / SQLite `SQLITE_BUSY` | `HAUS_DATA_DIR` points under `/mnt/c` | Move `HAUS_DATA_DIR` to Linux `ext4` (e.g. `/var/lib/haus`) |
| `wsl_systemd_inactive` / `System has not been booted with systemd` | `/etc/wsl.conf` missing `[boot] systemd=true` or distro not restarted | Run `sudo bash apps/hub/install/hub.sh ...` or add `[boot]\nsystemd=true` and run `wsl --shutdown` |
| Hub reachable on `localhost:8790`, unreachable from LAN | Windows Firewall blocking Private port or NAT mode missing `portproxy` | Run `wsl-windows.ps1 -Action SetupMirrored` (or `-Action RefreshPortProxy` in NAT mode) |
| `.wslconfig` settings ignored after `wsl --shutdown` | Editor saved `.wslconfig` with UTF-8 BOM or wrong filename | Re-apply via `wsl-windows.ps1 -Action SetupMirrored` (writes UTF-8 without BOM) |
| Hub stops a few seconds after closing WSL terminal | WSL idle auto-shutdown terminates headless distro | Pass `-RegisterStartupTask` to `wsl-windows.ps1` and check Task Scheduler `Haus-WSL-Keepalive-<Distro>` |
| No Zigbee / Tuya / mDNS discovery in NAT mode | Hyper-V NAT blocks LAN multicast/ARP | Switch to `networkingMode=mirrored` or run `scripts/lan-relay.ts` + `scripts/advertise.ts` on Windows |
| Remove all Windows WSL helpers | Clean uninstall of rules & scheduled task | Run `.\apps\hub\install\wsl-windows.ps1 -Action Remove -Distro Ubuntu` as Administrator |
