/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { execFile } from 'node:child_process';
import { constants, existsSync } from 'node:fs';
import { access, readFile, statfs } from 'node:fs/promises';
import { dirname, posix, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  assessWslEnvironment,
  isPrivateIpv4,
  isWindowsMountPath,
  type WslEnvironmentAssessment,
  type WslNetworkingMode,
} from './wsl.js';

const execFileAsync = promisify(execFile);

const WINDOWS_POWERSHELL = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const DEFAULT_DATA_DIR = '/var/lib/haus';
const DEFAULT_HUB_PORT = 8790;

export type ExecCommandFn = (
  file: string,
  args: readonly string[],
  options?: { readonly timeout?: number; readonly maxBuffer?: number },
) => Promise<string>;

export interface CommandAvailability {
  readonly name: string;
  readonly available: boolean;
  readonly version?: string;
}

export interface WslPreflightReport {
  readonly generatedAt: string;
  readonly assessment: WslEnvironmentAssessment;
  readonly recommendedMode: 'mirrored' | 'nat' | 'linux';
  readonly wslConfigPath?: string;
  readonly windowsLanIp?: string;
  readonly dataDirectory: string;
  readonly dataDirectoryValid: boolean;
  readonly dataDirectoryReason?: string;
  readonly port: number;
  readonly publicUrlHint: string;
  readonly commands: readonly CommandAvailability[];
  readonly dockerDaemonReachable: boolean;
  readonly ready: boolean;
  readonly blockers: readonly string[];
  readonly actions: readonly string[];
}

export interface WslInspectOptions {
  readonly dataDirectory?: string;
  readonly port?: number;
  readonly publicUrl?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly exec?: ExecCommandFn;
  readonly probeWindows?: boolean;
  readonly fileExists?: (path: string) => boolean;
  readonly readText?: (path: string) => Promise<string | undefined>;
}

export interface HubEnvTemplateOptions {
  readonly dataDirectory?: string;
  readonly port?: number;
  readonly networkingMode: WslNetworkingMode | 'linux';
  readonly publicUrl?: string;
  readonly mdnsAddress?: string;
  readonly mdnsAdvertise?: boolean;
  readonly lanRelayUrl?: string;
  readonly nvrEnabled?: boolean;
  readonly nvrDataDirectory?: string;
}

export interface SystemdHubUnitOptions {
  readonly nodeBinary?: string;
  readonly workingDirectory: string;
  readonly entrypoint?: string;
  readonly envFile?: string;
  readonly user?: string;
  readonly group?: string;
  readonly readWritePaths?: readonly string[];
}

async function defaultExec(
  file: string,
  args: readonly string[],
  options: { readonly timeout?: number; readonly maxBuffer?: number } = {},
): Promise<string> {
  const { stdout } = await execFileAsync(file, [...args], {
    timeout: options.timeout ?? 4000,
    maxBuffer: options.maxBuffer ?? 256 * 1024,
    encoding: 'utf8',
  });
  return stdout;
}

async function defaultReadText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

export function mergeIniKeys(
  existing: string | undefined,
  sectionName: string,
  updates: Readonly<Record<string, string>>,
): string {
  const lines = existing ? existing.replace(/^\uFEFF/, '').split(/\r?\n/) : [];
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const targetLower = sectionName.trim().toLowerCase();
  const pending = new Map(Object.entries(updates));
  const out: string[] = [];
  let inTarget = false;
  let foundTarget = false;
  let targetInsertIndex = -1;

  for (const line of lines) {
    const trimmed = line.trim();
    const sectionMatch = /^\[([^\]]+)\]$/.exec(trimmed);
    if (sectionMatch) {
      if (inTarget && pending.size > 0) {
        for (const [k, v] of pending) out.push(`${k}=${v}`);
        pending.clear();
      }
      inTarget = sectionMatch[1].trim().toLowerCase() === targetLower;
      if (inTarget) foundTarget = true;
      out.push(line);
      if (inTarget) targetInsertIndex = out.length;
      continue;
    }

    if (inTarget && trimmed && !trimmed.startsWith('#') && !trimmed.startsWith(';')) {
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        const matchKey = Array.from(pending.keys()).find(
          (k) => k.toLowerCase() === key.toLowerCase(),
        );
        if (matchKey) {
          out.push(`${matchKey}=${pending.get(matchKey)}`);
          pending.delete(matchKey);
          targetInsertIndex = out.length;
          continue;
        }
      }
    }

    out.push(line);
    if (inTarget && trimmed !== '') {
      targetInsertIndex = out.length;
    }
  }

  if (foundTarget && pending.size > 0) {
    const insertAt = targetInsertIndex >= 0 ? targetInsertIndex : out.length;
    const additions = Array.from(pending, ([k, v]) => `${k}=${v}`);
    out.splice(insertAt, 0, ...additions);
  } else if (!foundTarget) {
    if (out.length > 0) out.push('');
    out.push(`[${sectionName}]`);
    for (const [k, v] of pending) out.push(`${k}=${v}`);
  }

  return `${out.join('\n')}\n`;
}

export function mergeWslConfBootSystemd(existing?: string): string {
  return mergeIniKeys(existing, 'boot', { systemd: 'true' });
}

export function mergeWslConfigMirrored(existing?: string): string {
  return mergeIniKeys(existing, 'wsl2', {
    networkingMode: 'mirrored',
    hostAddressLoopback: 'true',
    dnsTunneling: 'true',
  });
}

export function renderHubEnvFile(options: HubEnvTemplateOptions): string {
  const dataDir = resolve(options.dataDirectory?.trim() || DEFAULT_DATA_DIR);
  const port = options.port ?? DEFAULT_HUB_PORT;
  const lines: string[] = [
    '# Haus Hub runtime configuration',
    `HAUS_DATA_DIR=${dataDir}`,
    `PORT=${port}`,
    'HAUS_BIND_ADDRESS=0.0.0.0',
  ];

  if (options.publicUrl?.trim()) {
    const cleanPublicUrl = options.publicUrl.trim().replace(/\/+$/, '');
    lines.push(`HAUS_PUBLIC_URL=${cleanPublicUrl}`);
    lines.push(`HAUS_HUB_URL=${cleanPublicUrl}`);
  }

  if (options.networkingMode === 'nat') {
    lines.push('HAUS_WSL_NETWORKING=nat');
    lines.push(`HAUS_LAN_RELAY_URL=${options.lanRelayUrl?.trim() || 'auto'}`);
    lines.push('HAUS_MDNS_ADVERTISE=0');
  } else if (options.networkingMode === 'mirrored') {
    lines.push('HAUS_WSL_NETWORKING=mirrored');
    if (options.mdnsAdvertise === false) {
      lines.push('HAUS_MDNS_ADVERTISE=0');
    } else if (options.mdnsAddress?.trim()) {
      lines.push('HAUS_MDNS_ADVERTISE=1');
      lines.push(`HAUS_MDNS_ADDRESS=${options.mdnsAddress.trim()}`);
    }
  } else {
    if (options.mdnsAdvertise === false) {
      lines.push('HAUS_MDNS_ADVERTISE=0');
    } else if (options.mdnsAddress?.trim()) {
      lines.push('HAUS_MDNS_ADVERTISE=1');
      lines.push(`HAUS_MDNS_ADDRESS=${options.mdnsAddress.trim()}`);
    }
  }

  if (options.nvrEnabled) {
    lines.push('HAUS_ROLES=storage,stream');
    if (options.nvrDataDirectory?.trim()) {
      lines.push(`HAUS_NVR_DATA_DIR=${resolve(options.nvrDataDirectory.trim())}`);
    }
    lines.push('# Set a strong random 64-hex-char NVR key (openssl rand -hex 32)');
    lines.push('# HAUS_NODE_KEY=');
  }

  return `${lines.join('\n')}\n`;
}

export function renderSystemdHubService(options: SystemdHubUnitOptions): string {
  const user = options.user?.trim() || 'haus';
  const group = options.group?.trim() || user;
  const nodeBin = options.nodeBinary?.trim() || '/usr/bin/node';
  const workDir = resolve(options.workingDirectory);
  const entrypoint = options.entrypoint?.trim() || 'apps/hub/dist/main.js';
  const envFile = options.envFile?.trim() || '/etc/haus/hub.env';
  const rwPaths = (options.readWritePaths?.length ? options.readWritePaths : [DEFAULT_DATA_DIR])
    .map((p) => resolve(p))
    .join(' ');

  return [
    '# Haus — A thoughtful home.',
    '# Copyright © 2026 Andrii Vynohradov. All rights reserved.',
    '# Licensed under the GNU General Public License v3.0 or later; see LICENSE.',
    '# SPDX-License-Identifier: GPL-3.0-or-later.',
    '',
    '[Unit]',
    'Description=Haus Hub standalone smart-home controller',
    'After=network-online.target docker.service',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `User=${user}`,
    `Group=${group}`,
    `WorkingDirectory=${workDir}`,
    `EnvironmentFile=-${envFile}`,
    `ExecStart=${nodeBin} ${entrypoint}`,
    'Restart=on-failure',
    'RestartSec=5',
    'TimeoutStopSec=15',
    'AmbientCapabilities=CAP_NET_RAW',
    'CapabilityBoundingSet=CAP_NET_RAW',
    'NoNewPrivileges=true',
    'PrivateTmp=true',
    'ProtectSystem=full',
    `ReadWritePaths=${rwPaths}`,
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n');
}

async function probeBinary(
  name: string,
  versionArgs: readonly string[],
  exec: ExecCommandFn,
): Promise<CommandAvailability> {
  try {
    const raw = await exec(name, versionArgs, { timeout: 2500 });
    const firstLine = raw.split(/\r?\n/, 1)[0]?.trim();
    return { name, available: true, version: firstLine || undefined };
  } catch {
    return { name, available: false };
  }
}

async function queryWindowsInteropInfo(
  exec: ExecCommandFn,
  fileExists: (path: string) => boolean,
): Promise<{ readonly wslConfigPath?: string; readonly windowsLanIp?: string }> {
  if (!fileExists(WINDOWS_POWERSHELL)) return {};
  const psScript = [
    "$ErrorActionPreference='SilentlyContinue';",
    '$cfg = Join-Path $env:USERPROFILE ".wslconfig";',
    '$cfgPath = if (Test-Path $cfg) { $cfg } else { "" };',
    "$route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric,InterfaceMetric | Select-Object -First 1;",
    '$ip = if ($route) { (Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "169.254.*" -and $_.IPAddress -ne "127.0.0.1" } | Select-Object -First 1 -ExpandProperty IPAddress) } else { "" };',
    '[pscustomobject]@{ WslConfig = $cfgPath; LanIp = $ip } | ConvertTo-Json -Compress',
  ].join(' ');

  try {
    const out = await exec(
      WINDOWS_POWERSHELL,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(psScript, 'utf16le').toString('base64'),
      ],
      { timeout: 5000, maxBuffer: 32 * 1024 },
    );
    const parsed = JSON.parse(out.replace(/^\uFEFF/, '').trim()) as {
      WslConfig?: unknown;
      LanIp?: unknown;
    };
    const wslConfigWin = typeof parsed.WslConfig === 'string' ? parsed.WslConfig.trim() : '';
    const rawLanIp = typeof parsed.LanIp === 'string' ? parsed.LanIp.trim() : '';
    const windowsLanIp = rawLanIp && isPrivateIpv4(rawLanIp) ? rawLanIp : undefined;

    let wslConfigPath: string | undefined;
    if (wslConfigWin) {
      try {
        const wslPathOut = await exec('/usr/bin/wslpath', ['-u', wslConfigWin], { timeout: 2000 });
        wslConfigPath = wslPathOut.trim() || undefined;
      } catch {
        const driveMatch = /^([a-z]):\\(.*)$/i.exec(wslConfigWin);
        if (driveMatch) {
          wslConfigPath = posix.join(
            `/mnt/${driveMatch[1].toLowerCase()}`,
            driveMatch[2].replaceAll('\\', '/'),
          );
        }
      }
    }
    return { wslConfigPath, windowsLanIp };
  } catch {
    return {};
  }
}

export async function inspectWslPreflight(
  options: WslInspectOptions = {},
): Promise<WslPreflightReport> {
  const env = options.env ?? process.env;
  const exec = options.exec ?? defaultExec;
  const fileExists = options.fileExists ?? existsSync;
  const readText = options.readText ?? defaultReadText;

  const dataDirectory = resolve(
    options.dataDirectory?.trim() ||
      env.HAUS_DATA_DIR?.trim() ||
      env.HAUS_DATA?.trim() ||
      DEFAULT_DATA_DIR,
  );
  const port = options.port ?? Number(env.PORT || DEFAULT_HUB_PORT);

  const initialAssessment = assessWslEnvironment({ env, dataDirectory });
  const shouldProbeWin =
    options.probeWindows ?? (initialAssessment.isWsl && !initialAssessment.isContainer);
  const winInfo = shouldProbeWin ? await queryWindowsInteropInfo(exec, fileExists) : {};
  const wslConfigContent = winInfo.wslConfigPath
    ? await readText(winInfo.wslConfigPath)
    : undefined;
  const wslConfContent = await readText('/etc/wsl.conf');

  const assessment = assessWslEnvironment({
    env,
    dataDirectory,
    wslConfigContent,
    wslConfContent,
  });

  const dataOnWinMount = isWindowsMountPath(dataDirectory);
  const blockers: string[] = [];
  const actions: string[] = [];

  if (dataOnWinMount) {
    blockers.push(
      `HAUS_DATA_DIR (${dataDirectory}) points to a Windows /mnt drive; move it to native Linux ext4 (e.g. /var/lib/haus).`,
    );
    actions.push(`Set HAUS_DATA_DIR=${DEFAULT_DATA_DIR} (never store SQLite/media on /mnt/c).`);
  }

  let writable = true;
  try {
    const checkTarget = fileExists(dataDirectory) ? dataDirectory : dirname(dataDirectory);
    if (fileExists(checkTarget)) {
      await statfs(checkTarget).catch(() => undefined);
    }
  } catch {
    writable = false;
  }

  if (assessment.isWsl && !assessment.isContainer && !assessment.systemdActive) {
    actions.push(
      'Enable systemd in /etc/wsl.conf ([boot]\\nsystemd=true) and run "wsl --shutdown" on Windows.',
    );
  }

  if (assessment.isWsl && assessment.networkingMode === 'nat') {
    actions.push(
      'Recommended: enable networkingMode=mirrored in %UserProfile%\\.wslconfig, OR run apps/hub/install/wsl-windows.ps1 -Action SetupNat and start scripts/lan-relay.ts + scripts/advertise.ts on Windows.',
    );
  }

  const commands = await Promise.all([
    probeBinary('node', ['--version'], exec),
    probeBinary('pnpm', ['--version'], exec),
    probeBinary('ffmpeg', ['-version'], exec),
    probeBinary('docker', ['--version'], exec),
    probeBinary('uv', ['--version'], exec),
    probeBinary('python3', ['--version'], exec),
  ]);

  let dockerDaemonReachable = false;
  try {
    await access(env.HAUS_DOCKER_SOCKET ?? '/var/run/docker.sock', constants.R_OK);
    await exec('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 2500 });
    dockerDaemonReachable = true;
  } catch {
    dockerDaemonReachable = false;
  }

  const nodeCmd = commands.find((c) => c.name === 'node');
  if (!nodeCmd?.available) {
    blockers.push('Node.js >= 24.11.0 is required on PATH.');
  }

  const recommendedMode: 'mirrored' | 'nat' | 'linux' = !assessment.isWsl
    ? 'linux'
    : assessment.networkingMode === 'nat'
      ? 'nat'
      : 'mirrored';

  const hostForUrl =
    options.publicUrl?.trim() ||
    env.HAUS_PUBLIC_URL?.trim() ||
    winInfo.windowsLanIp ||
    assessment.lanIps[0] ||
    '127.0.0.1';
  const publicUrlHint =
    hostForUrl.startsWith('http://') || hostForUrl.startsWith('https://')
      ? hostForUrl.replace(/\/+$/, '')
      : `http://${hostForUrl}:${port}`;

  return {
    generatedAt: new Date().toISOString(),
    assessment,
    recommendedMode,
    wslConfigPath: winInfo.wslConfigPath,
    windowsLanIp: winInfo.windowsLanIp,
    dataDirectory,
    dataDirectoryValid: !dataOnWinMount && writable,
    dataDirectoryReason: dataOnWinMount ? 'windows_mnt_drive_unsupported' : undefined,
    port,
    publicUrlHint,
    commands,
    dockerDaemonReachable,
    ready: blockers.length === 0,
    blockers,
    actions,
  };
}

export function formatWslPreflightReport(report: WslPreflightReport): string {
  const lines = [
    `Haus Hub Environment Preflight (${report.assessment.isWsl ? 'WSL2' : 'Linux'})`,
    `  Distro:           ${report.assessment.distroName ?? 'unknown'}${report.assessment.isContainer ? ' (container)' : ''}`,
    `  Networking mode:  ${report.assessment.networkingMode}`,
    `  systemd active:   ${report.assessment.systemdActive ? 'yes' : 'no'}`,
    `  Data directory:   ${report.dataDirectory} (${report.dataDirectoryValid ? 'ok' : (report.dataDirectoryReason ?? 'invalid')})`,
    `  Hub URL hint:     ${report.publicUrlHint}`,
  ];
  for (const [label, value] of [
    ['Windows LAN IP:', report.windowsLanIp],
    ['Linux LAN IPs:', report.assessment.lanIps.join(', ')],
    ['WSL NAT IPs:', report.assessment.natIps.join(', ')],
    ['Default gateway:', report.assessment.defaultGatewayIp],
  ] as const) {
    if (value) lines.push(`  ${label.padEnd(18)}${value}`);
  }
  lines.push(
    `  Tools:            ${report.commands.map((c) => `${c.name}:${c.available ? 'ok' : 'missing'}`).join(' ')} docker-daemon:${report.dockerDaemonReachable ? 'ok' : 'unavailable'}`,
  );
  for (const [heading, items] of [
    ['Blockers:', report.blockers],
    ['Recommended actions:', report.actions],
  ] as const) {
    if (items.length === 0) continue;
    lines.push(`  ${heading}`);
    for (const item of items) lines.push(`    - ${item}`);
  }
  return `${lines.join('\n')}\n`;
}
