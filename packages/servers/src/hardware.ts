/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { command } from './services.js';
import { stripControl } from './sanitize.js';

const text = (value: unknown, length = 200) =>
  typeof value === 'string' ? stripControl(value).trim().slice(0, length) : '';

const unavailable = () => ({
  gpus: { available: false, source: 'unavailable', adapters: [] },
});

export function sanitizeHardware(value: Record<string, unknown> | null | undefined) {
  const os = value?.operatingSystem as Record<string, unknown> | undefined;
  const operatingSystem =
    os &&
    ((os.source === 'windows-cim' && os.platform === 'win32') ||
      (os.source === 'macos-system-profiler' && os.platform === 'darwin')) &&
    text(os.name)
      ? {
          name: text(os.name),
          version: text(os.version, 80),
          build: text(os.build, 80),
          architecture: text(os.architecture, 40),
          platform: os.platform === 'win32' ? ('win32' as const) : ('darwin' as const),
          source: String(os.source),
        }
      : null;
  const input = value?.gpus as Record<string, unknown> | undefined;
  const gpus =
    input?.available === true &&
    ['windows-cim', 'linux-pci', 'macos-system-profiler'].includes(String(input.source))
      ? {
          available: true,
          source: String(input.source),
          sampledAt: text(input.sampledAt, 40),
          adapters: (Array.isArray(input.adapters) ? input.adapters : [])
            .slice(0, 16)
            .filter(
              (a): a is Record<string, unknown> =>
                typeof a === 'object' &&
                a !== null &&
                Boolean(text((a as Record<string, unknown>).name)),
            )
            .map((a: Record<string, unknown>, index: number) => ({
              id: text(a.id, 80) || 'gpu:' + index,
              name: text(a.name),
              vendor: text(a.vendor, 120) || null,
              driver: text(a.driver, 120) || null,
              kind: ['integrated', 'discrete', 'external', 'software'].includes(String(a.kind))
                ? a.kind
                : null,
              memoryBytes:
                typeof a.memoryBytes === 'number' &&
                Number.isSafeInteger(a.memoryBytes) &&
                a.memoryBytes >= 0
                  ? a.memoryBytes
                  : null,
            })),
        }
      : unavailable().gpus;
  const installedMemoryBytes = value?.installedMemoryBytes;
  return {
    ...(operatingSystem ? { operatingSystem } : {}),
    ...(typeof installedMemoryBytes === 'number' &&
    Number.isSafeInteger(installedMemoryBytes) &&
    installedMemoryBytes > 0
      ? { installedMemoryBytes }
      : {}),
    gpus,
  };
}

export function parseWindowsHardware(
  input: Record<string, unknown> | null | undefined,
  sampledAt = new Date().toISOString(),
) {
  const os = input?.OperatingSystem as Record<string, unknown> | undefined;
  const gpus = Array.isArray(input?.GPUs) ? input.GPUs : [];
  return sanitizeHardware({
    installedMemoryBytes: input?.MemoryInstalled,
    operatingSystem: os
      ? {
          name: os.Caption,
          version: os.Version,
          build: os.BuildNumber,
          architecture: os.OSArchitecture,
          platform: 'win32',
          source: 'windows-cim',
        }
      : null,
    gpus: {
      available: Array.isArray(input?.GPUs),
      source: 'windows-cim',
      sampledAt,
      adapters: gpus.map((gpu: Record<string, unknown>, index: number) => ({
        id: 'windows-gpu:' + index,
        name: gpu.Name,
        vendor: gpu.AdapterCompatibility,
        driver: gpu.DriverVersion,
        kind: null,
        memoryBytes: null,
      })),
    },
  });
}

export function parseLinuxGpus(output: string, sampledAt = new Date().toISOString()) {
  const adapters = String(output)
    .split(/\n\s*\n/)
    .flatMap((block) => {
      const fields = Object.fromEntries(
        block.split('\n').flatMap((line) => {
          const match = /^([A-Za-z]+):\s*(.*)$/.exec(line);
          return match ? [[match[1], match[2]]] : [];
        }),
      );
      if (!/\[03(?:00|02|80)\]/.test(fields.Class ?? '') || !fields.Device) return [];
      return [
        {
          id: text(fields.Slot, 80),
          name: text(fields.Device),
          vendor: text(fields.Vendor),
          driver: text(fields.Driver),
          kind: null,
          memoryBytes: null,
        },
      ];
    });
  return sanitizeHardware({
    gpus: { available: true, source: 'linux-pci', sampledAt, adapters },
  }).gpus;
}

export async function hostHardware({
  platform,
  wsl = false,
  run = command,
  now = Date.now,
}: {
  platform: string;
  wsl?: boolean;
  run?: (cmd: string, args: string[], options?: Record<string, unknown>) => Promise<string>;
  now?: () => number;
}) {
  const sampledAt = new Date(now()).toISOString();
  if (platform === 'win32' || wsl) {
    const script =
      "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$os=$null;try{$os=Get-CimInstance Win32_OperatingSystem -OperationTimeoutSec 3 | Select-Object Caption,Version,BuildNumber,OSArchitecture}catch{};$m=$null;try{$m=(Get-CimInstance Win32_PhysicalMemory -OperationTimeoutSec 2 | Measure-Object -Property Capacity -Sum).Sum}catch{};$g=$null;try{$g=@(Get-CimInstance Win32_VideoController -OperationTimeoutSec 3 | Select-Object -First 16 Name,AdapterCompatibility,DriverVersion)}catch{};[pscustomobject]@{OperatingSystem=$os;MemoryInstalled=$m;GPUs=$g}|ConvertTo-Json -Depth 4 -Compress";
    const output = await run(
      wsl ? '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe' : 'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { timeout: 10000, maxBuffer: 64 * 1024 },
    );
    return parseWindowsHardware(JSON.parse(output.replace(/^\uFEFF/, '')), sampledAt);
  }
  if (platform === 'linux') {
    const output = await run('lspci', ['-vmm', '-D', '-nn', '-k'], {
      timeout: 3000,
      maxBuffer: 64 * 1024,
    });
    return { gpus: parseLinuxGpus(output, sampledAt) };
  }
  return unavailable();
}
