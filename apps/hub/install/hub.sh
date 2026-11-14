#!/usr/bin/env bash
# Haus — A thoughtful home.
# Copyright © 2026 Andrii Vynohradov. All rights reserved.
# Licensed under the GNU General Public License v3.0 or later; see LICENSE.
# SPDX-License-Identifier: GPL-3.0-or-later.

set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
HUB_DIR=$(dirname -- "$SCRIPT_DIR")
REPO_ROOT=$(CDPATH= cd -- "$HUB_DIR/../.." && pwd)

MODE="native"
DATA_DIR="/var/lib/haus"
PORT="8790"
PUBLIC_URL=""
RUN_USER="${SUDO_USER:-${USER:-haus}}"
DRY_RUN=0
CHECK_ONLY=0
NO_SYSTEMD=0
AUTO_YES=0
FORCE_ENV=0

usage() {
  cat <<'EOF'
Usage: apps/hub/install/hub.sh [options]

Options:
  --mode <native|docker>   Deployment mode (default: native)
  --data-dir <path>        Persistent Hub data directory on Linux ext4 (default: /var/lib/haus)
  --port <port>            Hub HTTP/WebSocket listener port (default: 8790)
  --public-url <url>       Reachable LAN URL (e.g. http://192.168.1.50:8790)
  --user <username>        Linux user for native systemd service (default: sudo caller or haus)
  --no-systemd             Do not modify /etc/wsl.conf or install systemd unit
  --check-only             Run Linux/WSL2 preflight checks and exit without writing
  --dry-run                Print actions and generated config without modifying files
  --force-env              Overwrite existing Hub env file after creating a backup
  --yes                    Skip interactive confirmation prompts
  -h, --help               Show this help
EOF
}

log() { printf '[haus-install] %s\n' "$*"; }
warn() { printf '[haus-install] WARNING: %s\n' "$*" >&2; }
die() { printf '[haus-install] ERROR: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="${2:?missing value for --mode}"; shift 2 ;;
    --data-dir) DATA_DIR="${2:?missing value for --data-dir}"; shift 2 ;;
    --port) PORT="${2:?missing value for --port}"; shift 2 ;;
    --public-url) PUBLIC_URL="${2:?missing value for --public-url}"; shift 2 ;;
    --user) RUN_USER="${2:?missing value for --user}"; shift 2 ;;
    --no-systemd) NO_SYSTEMD=1; shift ;;
    --check-only) CHECK_ONLY=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --force-env) FORCE_ENV=1; shift ;;
    --yes) AUTO_YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

case "$MODE" in
  native|docker) ;;
  *) die "--mode must be 'native' or 'docker' (got '$MODE')" ;;
esac

if ! printf '%s' "$PORT" | grep -Eq '^[0-9]+$' || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  die "Invalid --port: $PORT"
fi

is_windows_mount() {
  case "$1" in
    /mnt/[a-zA-Z]|/mnt/[a-zA-Z]/*) return 0 ;;
    *) return 1 ;;
  esac
}

detect_wsl() {
  if [ -e /proc/sys/fs/binfmt_misc/WSLInterop ] || [ -n "${WSL_DISTRO_NAME:-}" ] || [ -n "${WSL_INTEROP:-}" ]; then
    return 0
  fi
  if [ -r /proc/version ] && grep -qiE 'microsoft|wsl' /proc/version; then
    return 0
  fi
  return 1
}

POWERSHELL_BIN="/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"

query_windows_lan_ip() {
  [ -x "$POWERSHELL_BIN" ] || return 0
  "$POWERSHELL_BIN" -NoLogo -NoProfile -NonInteractive -Command \
    "\$r=Get-NetRoute -DestinationPrefix '0.0.0.0/0'|Sort-Object RouteMetric,InterfaceMetric|Select-Object -First 1;if(\$r){(Get-NetIPAddress -InterfaceIndex \$r.InterfaceIndex -AddressFamily IPv4|Where-Object{\$_.IPAddress -notlike '169.254.*' -and \$_.IPAddress -ne '127.0.0.1'}|Select-Object -First 1 -ExpandProperty IPAddress)}" \
    2>/dev/null | tr -d '\r' | head -n 1 || true
}

query_windows_wslconfig_mode() {
  [ -x "$POWERSHELL_BIN" ] || return 0
  local win_cfg linux_cfg
  win_cfg=$("$POWERSHELL_BIN" -NoLogo -NoProfile -NonInteractive -Command \
    'Join-Path $env:USERPROFILE ".wslconfig"' 2>/dev/null | tr -d '\r' | head -n 1 || true)
  [ -n "$win_cfg" ] || return 0
  linux_cfg=$(wslpath -u "$win_cfg" 2>/dev/null || true)
  [ -r "$linux_cfg" ] || return 0
  awk '
    BEGIN { in_wsl2=0 }
    /^[[:space:]]*\[/ {
      s=tolower($0); gsub(/[[:space:]\[\]]/, "", s); in_wsl2=(s=="wsl2"); next
    }
    in_wsl2 && /^[[:space:]]*networkingMode[[:space:]]*=/ {
      sub(/^[^=]*=/, "", $0); sub(/[;#].*$/, "", $0); gsub(/[[:space:]]/, "", $0);
      print tolower($0); exit
    }
  ' "$linux_cfg" || true
}

detect_wsl_networking_mode() {
  local cfg_mode
  cfg_mode=$(query_windows_wslconfig_mode)
  if [ "$cfg_mode" = "mirrored" ] || [ "$cfg_mode" = "nat" ]; then
    printf '%s' "$cfg_mode"
    return
  fi
  if command -v ip >/dev/null 2>&1; then
    if ip link show loopback0 >/dev/null 2>&1; then
      printf 'mirrored'
      return
    fi
    local eth_ip
    eth_ip=$(ip -4 -o addr show scope global 2>/dev/null | awk '!/docker|br-|veth|vethernet/ {print $4}' | cut -d/ -f1 | head -n 1 || true)
    case "$eth_ip" in
      192.168.*|10.*) printf 'mirrored'; return ;;
      172.1[6-9].*|172.2[0-9].*|172.3[0-1].*) printf 'nat'; return ;;
    esac
  fi
  printf 'nat'
}

wsl_conf_has_systemd() {
  [ -r /etc/wsl.conf ] || return 1
  awk '
    BEGIN { in_boot=0; found=1 }
    /^[[:space:]]*\[/ {
      s=tolower($0); gsub(/[[:space:]\[\]]/, "", s); in_boot=(s=="boot"); next
    }
    in_boot && /^[[:space:]]*systemd[[:space:]]*=/ {
      sub(/^[^=]*=/, "", $0); sub(/[;#].*$/, "", $0); gsub(/[[:space:]]/, "", $0);
      if (tolower($0) ~ /^(true|1|yes)$/) found=0; else found=1
    }
    END { exit found }
  ' /etc/wsl.conf
}

ensure_wsl_conf_systemd() {
  if wsl_conf_has_systemd; then
    log "/etc/wsl.conf already enables [boot] systemd=true"
    return 0
  fi
  local merged
  if [ -r /etc/wsl.conf ]; then
    merged=$(awk '
      BEGIN { in_boot=0; seen_boot=0; wrote=0 }
      /^[[:space:]]*\[/ {
        if (in_boot && !wrote) { print "systemd=true"; wrote=1 }
        s=$0; gsub(/[[:space:]\[\]]/, "", s);
        in_boot=(tolower(s)=="boot");
        if (in_boot) seen_boot=1;
        print; next
      }
      in_boot && /^[[:space:]]*systemd[[:space:]]*=/ {
        if (!wrote) { print "systemd=true"; wrote=1 }
        next
      }
      { print }
      END {
        if (in_boot && !wrote) { print "systemd=true"; wrote=1 }
        else if (!seen_boot) { print ""; print "[boot]"; print "systemd=true" }
      }
    ' /etc/wsl.conf)
  else
    merged=$(printf '[boot]\nsystemd=true\n')
  fi
  if [ "$DRY_RUN" = 1 ]; then
    log "[dry-run] Would update /etc/wsl.conf with:"
    printf '%s\n' "$merged"
    return 0
  fi
  [ "$(id -u)" = 0 ] || die "Run with sudo to write /etc/wsl.conf (or pass --no-systemd)."
  if [ -e /etc/wsl.conf ]; then
    cp /etc/wsl.conf "/etc/wsl.conf.bak.$(date +%Y%m%d%H%M%S)"
  fi
  printf '%s\n' "$merged" > /etc/wsl.conf
  warn "Updated /etc/wsl.conf (systemd=true). Run 'wsl --shutdown' in Windows PowerShell once to activate systemd."
}

IS_WSL=0
if detect_wsl; then
  IS_WSL=1
fi

if is_windows_mount "$DATA_DIR"; then
  die "Refusing --data-dir '$DATA_DIR' on Windows /mnt drive. DrvFs/9P breaks SQLite WAL locks and hurts performance. Use a Linux ext4 path like /var/lib/haus."
fi

WSL_NET_MODE="linux"
WIN_LAN_IP=""
SYSTEMD_ACTIVE=0
[ -d /run/systemd/system ] && SYSTEMD_ACTIVE=1

if [ "$IS_WSL" = 1 ]; then
  WSL_NET_MODE=$(detect_wsl_networking_mode)
  WIN_LAN_IP=$(query_windows_lan_ip)
  if [ -z "$PUBLIC_URL" ] && [ -n "$WIN_LAN_IP" ]; then
    PUBLIC_URL="http://${WIN_LAN_IP}:${PORT}"
  fi
fi

if [ -z "$PUBLIC_URL" ] && command -v hostname >/dev/null 2>&1; then
  FIRST_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
  [ -n "$FIRST_IP" ] && PUBLIC_URL="http://${FIRST_IP}:${PORT}"
fi

log "Detected environment: $([ "$IS_WSL" = 1 ] && printf "WSL2 (distro=%s, net=%s)" "${WSL_DISTRO_NAME:-unknown}" "$WSL_NET_MODE" || printf 'Linux')"
log "Deployment mode: $MODE | Data dir: $DATA_DIR | Port: $PORT | systemd PID 1: $([ "$SYSTEMD_ACTIVE" = 1 ] && printf 'yes' || printf 'no')"
[ -n "$PUBLIC_URL" ] && log "Suggested LAN URL: $PUBLIC_URL"

if [ "$MODE" = "native" ]; then
  command -v node >/dev/null 2>&1 || die "Node.js >= 24.11.0 is required for native mode."
  NODE_MAJOR=$(node -p 'Number(process.versions.node.split(".")[0])')
  [ "$NODE_MAJOR" -ge 24 ] || die "Node.js >= 24.11.0 required (found $(node --version))."
  command -v ffmpeg >/dev/null 2>&1 || warn "ffmpeg not found in PATH; install ffmpeg before enabling camera streaming/recording."
else
  command -v docker >/dev/null 2>&1 || die "Docker CLI not found in PATH."
  if ! docker info >/dev/null 2>&1; then
    if [ "$IS_WSL" = 1 ]; then
      warn "Docker daemon is not reachable. Start Docker Desktop on Windows (with WSL2 integration) OR enable native Docker Engine inside this WSL distro."
    else
      warn "Docker daemon is not reachable right now."
    fi
  fi
fi

if [ "$CHECK_ONLY" = 1 ]; then
  if [ -f "$HUB_DIR/dist/cli/wsl.js" ] && command -v node >/dev/null 2>&1; then
    node "$HUB_DIR/dist/cli/wsl.js" --check --data-dir "$DATA_DIR" --port "$PORT"
  fi
  exit 0
fi

if [ "$AUTO_YES" = 0 ] && [ "$DRY_RUN" = 0 ] && [ -t 0 ]; then
  printf 'Proceed configuring Haus Hub (%s mode) into %s? [y/N] ' "$MODE" "$DATA_DIR"
  read -r REPLY
  case "$REPLY" in
    y|Y|yes|YES) ;;
    *) log "Aborted by user."; exit 0 ;;
  esac
fi

render_env_content() {
  cat <<EOF
# Haus Hub environment (generated by apps/hub/install/hub.sh)
HAUS_DATA_DIR=$DATA_DIR
PORT=$PORT
HAUS_BIND_ADDRESS=0.0.0.0
EOF
  if [ -n "$PUBLIC_URL" ]; then
    cat <<EOF
HAUS_PUBLIC_URL=$PUBLIC_URL
HAUS_HUB_URL=$PUBLIC_URL
EOF
  fi
  if [ "$IS_WSL" = 1 ]; then
    printf 'HAUS_WSL_NETWORKING=%s\n' "$WSL_NET_MODE"
    if [ "$WSL_NET_MODE" = "nat" ]; then
      printf 'HAUS_LAN_RELAY_URL=auto\nHAUS_MDNS_ADVERTISE=0\n'
    elif [ -n "$WIN_LAN_IP" ]; then
      printf 'HAUS_MDNS_ADVERTISE=1\nHAUS_MDNS_ADDRESS=%s\n' "$WIN_LAN_IP"
    fi
  fi
}

write_env_safely() {
  local target="$1" mode="$2" content
  content=$(render_env_content)
  if [ "$DRY_RUN" = 1 ]; then
    log "[dry-run] Would write $target:"
    printf '%s\n' "$content"
    return 0
  fi
  if [ -e "$target" ] && [ "$FORCE_ENV" = 0 ]; then
    log "Preserving existing $target (pass --force-env to regenerate; keeping existing secrets intact)."
    return 0
  fi
  if [ -e "$target" ]; then
    cp "$target" "${target}.bak.$(date +%Y%m%d%H%M%S)"
  fi
  install -d -m 0750 "$(dirname -- "$target")"
  printf '%s' "$content" > "$target"
  chmod "$mode" "$target"
  log "Wrote $target"
}

if [ "$IS_WSL" = 1 ] && [ "$NO_SYSTEMD" = 0 ]; then
  ensure_wsl_conf_systemd
fi

if [ "$MODE" = "native" ]; then
  NODE_BIN=$(command -v node)
  ENV_FILE="/etc/haus/hub.env"
  UNIT_FILE="/etc/systemd/system/haus-hub.service"
  [ "$DRY_RUN" = 1 ] || [ "$(id -u)" = 0 ] || die "Native installation writes /etc/haus and /etc/systemd/system; re-run with sudo or use --dry-run."

  if [ "$DRY_RUN" = 0 ]; then
    if ! id "$RUN_USER" >/dev/null 2>&1; then
      useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$RUN_USER" 2>/dev/null || \
        die "User '$RUN_USER' does not exist and could not be created."
    fi
    install -d -m 0750 -o "$RUN_USER" "$DATA_DIR"
  fi

  write_env_safely "$ENV_FILE" 0640

  UNIT_CONTENT=$(cat <<EOF
# Haus — A thoughtful home.
# Copyright © 2026 Andrii Vynohradov. All rights reserved.
# Licensed under the GNU General Public License v3.0 or later; see LICENSE.
# SPDX-License-Identifier: GPL-3.0-or-later.

[Unit]
Description=Haus Hub standalone smart-home controller
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
Group=$(id -gn "$RUN_USER" 2>/dev/null || printf '%s' "$RUN_USER")
WorkingDirectory=$REPO_ROOT
EnvironmentFile=-$ENV_FILE
ExecStart=$NODE_BIN apps/hub/dist/main.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=15
AmbientCapabilities=CAP_NET_RAW
CapabilityBoundingSet=CAP_NET_RAW
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF
)
  if [ "$DRY_RUN" = 1 ]; then
    log "[dry-run] Would install $UNIT_FILE"
  elif [ "$NO_SYSTEMD" = 0 ]; then
    printf '%s\n' "$UNIT_CONTENT" > "$UNIT_FILE"
    chmod 0644 "$UNIT_FILE"
    log "Installed $UNIT_FILE"
    if [ "$SYSTEMD_ACTIVE" = 1 ]; then
      systemctl daemon-reload
      if [ -f "$HUB_DIR/dist/main.js" ]; then
        systemctl enable --now haus-hub.service
        log "Enabled and started haus-hub.service"
      else
        systemctl enable haus-hub.service
        warn "Built entrypoint $HUB_DIR/dist/main.js not found yet; run: pnpm install --frozen-lockfile && pnpm -r --filter @haus/hub... build && sudo systemctl start haus-hub"
      fi
    else
      warn "systemd is not PID 1 yet. After 'wsl --shutdown', enable/start service with: sudo systemctl enable --now haus-hub"
    fi
  fi
else
  ENV_FILE="$HUB_DIR/deploy/hub/.env"
  write_env_safely "$ENV_FILE" 0600
  if [ "$IS_WSL" = 1 ] && [ "$WSL_NET_MODE" = "mirrored" ]; then
    log "Start Docker stack (native Docker Engine inside WSL2 mirrored): docker compose -f $HUB_DIR/deploy/hub/compose.yaml -f $HUB_DIR/deploy/hub/wsl-mirrored.yaml up -d"
  else
    log "Start Docker stack: docker compose -f $HUB_DIR/deploy/hub/compose.yaml up -d"
  fi
fi

if [ "$IS_WSL" = 1 ]; then
  DISTRO_ARG="${WSL_DISTRO_NAME:-Ubuntu}"
  PS_ACTION=$([ "$WSL_NET_MODE" = "nat" ] && printf 'SetupNat' || printf 'SetupMirrored')
  cat <<EOF

Next step on Windows (run in Elevated PowerShell as Administrator):
  powershell -ExecutionPolicy Bypass -File "$REPO_ROOT\\apps\\hub\\install\\wsl-windows.ps1" -Action $PS_ACTION -Distro "$DISTRO_ARG" -Port $PORT -RegisterStartupTask
EOF
  if [ "$WSL_NET_MODE" = "nat" ]; then
    cat <<EOF

Because this WSL2 distro currently uses NAT networking, also start the Windows LAN relay & mDNS advertiser on the Windows host so smart-home devices and Desktop/Mobile discovery reach your LAN:
  pnpm tsx scripts/lan-relay.ts
  HAUS_HUB_ID=hub-standalone-01 HAUS_MDNS_ADDRESS=${WIN_LAN_IP:-<YOUR_WINDOWS_LAN_IP>} PORT=$PORT pnpm tsx scripts/advertise.ts
(Or switch to recommended mirrored mode using '-Action SetupMirrored' above followed by 'wsl --shutdown'.)
EOF
  fi
fi
