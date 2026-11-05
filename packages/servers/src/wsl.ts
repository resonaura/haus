/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { stat } from 'node:fs/promises';
import { command } from './services.js';

const windowsPowerShell = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';

export async function wslStorageBacking({
  run = command,
  inspect = stat,
  now = Date.now,
}: {
  run?: (cmd: string, args: string[], options?: Record<string, unknown>) => Promise<string>;
  inspect?: (path: string) => Promise<{ dev: number }>;
  now?: () => number;
} = {}) {
  const root = (await run('/usr/bin/wslpath', ['-w', '/'])).trim();
  const match = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\\r\n]{1,80})\\?$/i.exec(root);
  if (!match) throw new Error('wsl_distribution_unknown');
  const name = Buffer.from(match[1], 'utf8').toString('base64');
  const device = (await inspect('/')).dev;
  const sampledAt = now();
  const script = `
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';
$name=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${name}'));
$items=@(Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss' | ForEach-Object {Get-ItemProperty $_.PSPath} | Where-Object {$_.DistributionName -ceq $name});
if($items.Count -ne 1){throw 'Distribution mapping unavailable'};
$item=$items[0];$base=[string]$item.BasePath;
if(-not $base){throw 'Distribution path unavailable'};
$prefix=([char]92).ToString()+([char]92).ToString()+'?'+([char]92).ToString();
if($base.StartsWith($prefix)){$base=$base.Substring(4)};
$filename=$item.VhdFileName;if(-not $filename){$filename='ext4.vhdx'};
$file=[IO.Path]::Combine($base,$filename);
if(-not (Test-Path -LiteralPath $file -PathType Leaf)){throw 'Distribution image unavailable'};
$volumes=@(Get-Volume -FilePath $file -ErrorAction Stop);
if($volumes.Count -ne 1){throw 'Backing volume ambiguous'};
$volume=$volumes[0];
[pscustomobject]@{AvailableBytes=$volume.SizeRemaining;TotalBytes=$volume.Size;Volume=$(if($volume.DriveLetter){[string]$volume.DriveLetter+':'}else{'Windows volume'})} | ConvertTo-Json -Compress
`;
  const output = await run(
    windowsPowerShell,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    { timeout: 8000, maxBuffer: 16384 },
  );
  const value = JSON.parse(output.replace(/^\uFEFF/, ''));
  return sanitizeStorageBacking(
    {
      source: 'wsl-vhd',
      device,
      sampledAt: new Date(sampledAt).toISOString(),
      availableBytes: value.AvailableBytes,
      totalBytes: value.TotalBytes,
      volume: value.Volume,
    },
    now(),
  );
}

export function sanitizeStorageBacking(
  value: Record<string, unknown> | null | undefined,
  now = Date.now(),
) {
  const sampledAt = typeof value?.sampledAt === 'string' ? value.sampledAt : '';
  const sampled = Date.parse(sampledAt);
  const device = typeof value?.device === 'number' ? value.device : -1;
  const totalBytes = typeof value?.totalBytes === 'number' ? value.totalBytes : -1;
  const availableBytes = typeof value?.availableBytes === 'number' ? value.availableBytes : -1;
  if (
    value?.source !== 'wsl-vhd' ||
    !Number.isSafeInteger(device) ||
    device < 0 ||
    !Number.isFinite(sampled) ||
    now - sampled > 30000 ||
    sampled - now > 1000 ||
    !Number.isSafeInteger(totalBytes) ||
    totalBytes <= 0 ||
    !Number.isSafeInteger(availableBytes) ||
    availableBytes < 0 ||
    availableBytes > totalBytes
  )
    throw new Error('invalid_storage_backing');
  return {
    source: 'wsl-vhd',
    device,
    sampledAt: new Date(sampled).toISOString(),
    totalBytes,
    availableBytes,
    volume: /^[A-Z]:$/i.test(typeof value.volume === 'string' ? value.volume : '')
      ? (value.volume as string).toUpperCase()
      : 'Windows volume',
  };
}

export class StorageBacking {
  root: string;
  sample: () => Record<string, unknown> | null | undefined;
  inspect: (path: string) => Promise<{ dev: number }>;
  now: () => number;
  startedAt: number;
  confirmed: boolean;
  lastSample: number;

  constructor(
    root: string,
    sample: () => Record<string, unknown> | null | undefined,
    {
      inspect = stat,
      now = Date.now,
      required = false,
    }: {
      inspect?: (path: string) => Promise<{ dev: number }>;
      now?: () => number;
      required?: boolean;
    } = {},
  ) {
    this.root = root;
    this.sample = sample;
    this.inspect = inspect;
    this.now = now;
    this.startedAt = now();
    this.confirmed = required;
    this.lastSample = -Infinity;
  }

  async capacity() {
    const report = this.sample();
    const device = (await this.inspect(this.root)).dev;
    let backing: ReturnType<typeof sanitizeStorageBacking> | undefined;
    try {
      backing = sanitizeStorageBacking(
        report?.storageBacking as Record<string, unknown> | undefined,
        this.now(),
      );
    } catch {}
    if (backing && backing.device === device) {
      this.confirmed = true;
      const sampled = Date.parse(backing.sampledAt);
      if (sampled >= this.startedAt && sampled >= this.lastSample) {
        this.lastSample = sampled;
        return { state: 'fresh', ...backing };
      }
    }
    return this.confirmed ? { state: 'unavailable', source: 'wsl-vhd', availableBytes: 0 } : null;
  }
}
