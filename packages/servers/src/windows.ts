/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { command } from './services.js';
import { storageMedia } from './storage.js';
import { parseWindowsBattery } from './battery.js';
import { stripControl } from './sanitize.js';
import type { HostDisk } from './types.js';

const nonnegative = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

const count = (value: unknown) =>
  value !== null &&
  value !== undefined &&
  String(value).trim() !== '' &&
  Number.isSafeInteger(Number(value)) &&
  Number(value) >= 0
    ? Number(value)
    : null;

const text = (value: unknown) =>
  typeof value === 'string' ? stripControl(value).trim().slice(0, 240) : '';

const positive = (value: unknown) =>
  value !== null &&
  value !== undefined &&
  !(typeof value === 'string' && !value.trim()) &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0
    ? Number(value)
    : null;

const rows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? (value as Record<string, unknown>[])
    : value
      ? [value as Record<string, unknown>]
      : [];

const partitionRoles: Record<string, [string, string | null]> = {
  'c12a7328-f81f-11d2-ba4b-00a0c93ec93b': ['efi', 'EFI System Partition'],
  'e3c9e316-0b5c-4db8-817d-f92df00215ae': ['reserved', 'Microsoft Reserved'],
  'de94bba4-06d1-4d40-a16a-bfd50179d6ac': ['recovery', 'Windows Recovery'],
  'ebd0a0a2-b9e5-4433-87c0-68b6b72699c7': ['data', null],
};

const diskScript = `
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';
$drives=@(Get-CimInstance Win32_DiskDrive -OperationTimeoutSec 3 | Select-Object -First 32);
$allPhysical=@();try{$allPhysical=@(Get-PhysicalDisk -ErrorAction Stop | Select-Object -First 32)}catch{};
$disks=@(foreach($drive in $drives){
  $native=$null;try{$native=Get-Disk -Number $drive.Index -ErrorAction Stop}catch{};
  $size=$(if($native -and $native.Size -gt 0){$native.Size}else{$drive.Size});
  $physical=@($allPhysical | Where-Object {[string]$_.DeviceId -ceq [string]$drive.Index -and [double]$_.Size -eq [double]$size});
  $parts=@();try{$parts=@(Get-Partition -DiskNumber $drive.Index -ErrorAction Stop | Select-Object -First 128)}catch{};
  if($parts.Count -eq 0){$parts=@(Get-CimAssociatedInstance -InputObject $drive -Association Win32_DiskDriveToDiskPartition -OperationTimeoutSec 3 | Select-Object -First 128)};
  [pscustomobject]@{Index=$drive.Index;Model=$drive.Model;Size=$size;BusType=[string]$native.BusType;MediaType=$(if($physical.Count -eq 1){[string]$physical[0].MediaType}else{''});Removable=$(if($drive.MediaType -eq 'Removable Media'){$true}else{$null});Partitions=@(foreach($part in $parts){
    if($part.PartitionNumber){
      $volume=$null;try{$volume=Get-Volume -Partition $part -ErrorAction Stop | Select-Object -First 1}catch{};
      $volumes=@();if($part.DriveLetter -and [int]$part.DriveLetter -gt 0 -and $volume){$volumes=@([pscustomobject]@{DeviceID=([string]$part.DriveLetter+':');VolumeName=$volume.FileSystemLabel;FileSystem=$volume.FileSystem;Size=$volume.Size;FreeSpace=$volume.SizeRemaining})};
      [pscustomobject]@{Index=($part.PartitionNumber-1);Number=$part.PartitionNumber;Size=$part.Size;GptType=$part.GptType;ReadOnly=$part.IsReadOnly;FileSystem=$volume.FileSystem;VolumeSize=$volume.Size;FreeSpace=$volume.SizeRemaining;Volumes=$volumes}
    }else{
      $volumes=@(Get-CimAssociatedInstance -InputObject $part -Association Win32_LogicalDiskToPartition -OperationTimeoutSec 3 | Select-Object DeviceID,VolumeName,FileSystem,Size,FreeSpace);
      [pscustomobject]@{Index=$part.Index;Number=($part.Index+1);Size=$part.Size;Volumes=$volumes}
    }
  })}
});
[pscustomobject]@{Disks=$disks} | ConvertTo-Json -Depth 7 -Compress
`;

export function parseWindowsDisks(value: Record<string, unknown> | null | undefined): HostDisk[] {
  const disks = new Map<string, HostDisk>();
  for (const drive of rows(value?.Disks).slice(0, 32)) {
    const index = count(drive?.Index);
    if (index === null || !drive || typeof drive !== 'object') continue;
    const id = `windows-disk:${index}`,
      model = text(drive.Model);
    disks.set(id, {
      id,
      name: model || `Disk ${index}`,
      kind: 'disk',
      type: 'disk',
      physical: model ? !/(?:virtual|vhd|qemu|vmware|virtio|xen|storage space)/i.test(model) : null,
      parentId: null,
      parentIds: [],
      mountpoint: null,
      filesystem: null,
      totalBytes: count(drive.Size),
      usedBytes: null,
      availableBytes: null,
      scope: 'host',
      ...storageMedia({
        transport: typeof drive.BusType === 'string' ? drive.BusType : undefined,
        nativeMedia: drive.MediaType as Record<string, unknown> | undefined,
        removable: typeof drive.Removable === 'boolean' ? drive.Removable : undefined,
      }),
    });
    for (const part of rows(drive.Partitions).slice(0, 128)) {
      const partition = count(part?.Index);
      if (partition === null) continue;
      const partId = `${id}:partition:${partition}`;
      const purpose =
        partitionRoles[
          String(part.GptType ?? '')
            .toLowerCase()
            .replace(/[{}]/g, '')
        ];
      const volumeSize = count(part.VolumeSize),
        free = count(part.FreeSpace);
      disks.set(partId, {
        id: partId,
        name: purpose?.[1] || `Partition ${count(part.Number) || partition + 1}`,
        kind: 'volume',
        type: 'partition',
        physical: false,
        parentId: id,
        parentIds: [id],
        mountpoint: null,
        filesystem: text(part.FileSystem) || null,
        partitionNumber: count(part.Number) || partition + 1,
        ...(purpose ? { partitionRole: purpose[0] } : {}),
        ...(typeof part.ReadOnly === 'boolean' ? { readOnly: part.ReadOnly } : {}),
        totalBytes: count(part.Size),
        usedBytes: volumeSize === null || free === null ? null : Math.max(0, volumeSize - free),
        availableBytes: free,
        scope: 'host',
      });
      for (const row of rows(part.Volumes).slice(0, 128)) {
        if (!/^[A-Z]:$/i.test(String(row?.DeviceID ?? ''))) continue;
        const letter = String(row.DeviceID).toUpperCase(),
          volumeId = `windows-volume:${letter}`;
        const existing = disks.get(volumeId);
        if (existing) {
          if (!existing.parentIds.includes(partId)) existing.parentIds.push(partId);
          continue;
        }
        const totalBytes = count(row.Size),
          availableBytes = count(row.FreeSpace);
        disks.set(volumeId, {
          id: volumeId,
          name: text(row.VolumeName) ? `${text(row.VolumeName)} (${letter})` : letter,
          kind: 'volume',
          type: 'volume',
          physical: false,
          parentId: partId,
          parentIds: [partId],
          mountpoint: `${letter}\\`,
          filesystem: text(row.FileSystem) || null,
          totalBytes,
          availableBytes,
          usedBytes:
            totalBytes === null || availableBytes === null
              ? null
              : Math.max(0, totalBytes - availableBytes),
          scope: 'host',
        });
      }
    }
  }
  return [...disks.values()].slice(0, 128);
}

export async function windowsDisks({
  run = command,
  wsl = false,
}: {
  run?: (cmd: string, args: string[], options?: Record<string, unknown>) => Promise<string>;
  wsl?: boolean;
} = {}): Promise<HostDisk[]> {
  const output = await run(
    wsl ? '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe' : 'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(diskScript, 'utf16le').toString('base64'),
    ],
    { timeout: 8000, maxBuffer: 512 * 1024 },
  );
  const disks = parseWindowsDisks(JSON.parse(output.replace(/^\uFEFF/, '')));
  if (!disks.some((disk) => disk.type === 'disk' && (disk.totalBytes ?? 0) > 0))
    throw new Error('windows_disks_unavailable');
  return disks;
}

export function parseWindowsResources(value: Record<string, unknown> | null | undefined) {
  const total = nonnegative(value?.MemoryTotal);
  const available = nonnegative(value?.MemoryAvailable);
  const processors = rows(value?.Processors).slice(0, 128);
  const counts = processors.map((cpu) => cpu.NumberOfLogicalProcessors);
  if (
    !total ||
    available === null ||
    available > total ||
    !counts.length ||
    !counts.every((c) => typeof c === 'number' && Number.isSafeInteger(c) && c > 0)
  )
    throw new Error('windows_resources_unavailable');
  const usage = nonnegative(value?.CpuPercent);
  const pagefile = value?.PageFileAvailable === true;
  const swapTotal = pagefile ? nonnegative(value?.SwapTotal) : null;
  const swapUsed = pagefile ? nonnegative(value?.SwapUsed) : null;
  return {
    cpu: {
      model:
        [...new Set(processors.map((cpu) => text(cpu.Name)).filter(Boolean))].join(' · ') || null,
      logicalCores: (counts as number[]).reduce((sum: number, c: number) => sum + c, 0),
      usage: usage !== null && usage <= 100 ? usage / 100 : null,
      loadAverage: [] as number[],
    },
    memory: {
      totalBytes: total,
      availableBytes: available,
      usedBytes: total - available,
    },
    swap: {
      supported: pagefile && swapTotal !== null && swapUsed !== null && swapUsed <= swapTotal,
      totalBytes: swapTotal,
      usedBytes: swapTotal !== null && swapUsed !== null && swapUsed <= swapTotal ? swapUsed : null,
    },
    uptimeSeconds: nonnegative(value?.UptimeSeconds),
  };
}

export const resourceScript =
  "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$o=Get-CimInstance Win32_OperatingSystem -Property TotalVisibleMemorySize,FreePhysicalMemory,LastBootUpTime -OperationTimeoutSec 2;$mt=$null;$ma=$null;if($null-ne$o.TotalVisibleMemorySize){$mt=[double]$o.TotalVisibleMemorySize*1024};if($null-ne$o.FreePhysicalMemory){$ma=[double]$o.FreePhysicalMemory*1024};$p=@(Get-CimInstance Win32_Processor -Property Name,NumberOfLogicalProcessors -OperationTimeoutSec 2 | Select-Object Name,NumberOfLogicalProcessors);$c=$null;try{$c=(Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter \"Name='_Total'\" -Property PercentProcessorTime -OperationTimeoutSec 2).PercentProcessorTime}catch{};$page=$null;$pageOk=$false;try{$page=@(Get-CimInstance Win32_PageFileUsage -Property AllocatedBaseSize,CurrentUsage -OperationTimeoutSec 2);$pageOk=$true}catch{};$st=$null;$su=$null;if($pageOk){$st=[double](($page|Measure-Object -Property AllocatedBaseSize -Sum).Sum)*1048576;$su=[double](($page|Measure-Object -Property CurrentUsage -Sum).Sum)*1048576};$up=$null;if($null-ne$o.LastBootUpTime){$up=[Math]::Floor(([DateTime]::UtcNow-$o.LastBootUpTime.ToUniversalTime()).TotalSeconds)};[pscustomobject]@{MemoryTotal=$mt;MemoryAvailable=$ma;Processors=$p;CpuPercent=$c;PageFileAvailable=$pageOk;SwapTotal=$st;SwapUsed=$su;UptimeSeconds=$up}|ConvertTo-Json -Depth 4 -Compress";

export async function windowsResources({
  run = command,
  wsl = false,
}: {
  run?: (cmd: string, args: string[], options?: Record<string, unknown>) => Promise<string>;
  wsl?: boolean;
} = {}) {
  const output = await run(
    wsl ? '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe' : 'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(resourceScript, 'utf16le').toString('base64'),
    ],
    { timeout: 10000, maxBuffer: 64 * 1024 },
  );
  return parseWindowsResources(JSON.parse(output.replace(/^\uFEFF/, '')));
}

export async function windowsTelemetry(
  run: (
    cmd: string,
    args: string[],
    options?: Record<string, unknown>,
  ) => Promise<string> = command,
) {
  const script =
    "$ErrorActionPreference='Stop'; $o=Get-CimInstance Win32_OperatingSystem; $m=Get-CimInstance Win32_PhysicalMemory | Measure-Object -Property Capacity -Sum; $p=@(Get-CimInstance Win32_PageFileUsage); $allocated=($p | Measure-Object AllocatedBaseSize -Sum).Sum; $used=($p | Measure-Object CurrentUsage -Sum).Sum; $d=@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,VolumeName,FileSystem,Size,FreeSpace); $b=@(Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus); $bs=@();try{$bs=@(Get-CimInstance -Namespace root\\wmi -ClassName BatteryStatus -OperationTimeoutSec 3 | Select-Object -First 16 Active,Charging,Discharging,PowerOnline)}catch{}; [pscustomobject]@{MemoryTotal=([double]$o.TotalVisibleMemorySize*1024);MemoryInstalled=([double]$m.Sum);MemoryFree=([double]$o.FreePhysicalMemory*1024);SwapTotal=([double]$allocated*1048576);SwapFree=([double]($allocated-$used)*1048576);Disks=$d;Battery=$b;BatteryStatus=$bs} | ConvertTo-Json -Depth 4 -Compress";
  const value = JSON.parse(
    await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script]),
  );
  const total = positive(value.MemoryTotal),
    installed = positive(value.MemoryInstalled),
    free = positive(value.MemoryFree);
  const swapTotal = positive(value.SwapTotal),
    swapFree = positive(value.SwapFree);
  return {
    memory:
      total === null || free === null
        ? null
        : {
            totalBytes: total,
            installedBytes: installed,
            availableBytes: Math.min(total, free),
            usedBytes: Math.max(0, total - free),
          },
    swap: {
      supported: swapTotal !== null,
      totalBytes: swapTotal,
      usedBytes: swapTotal !== null && swapFree !== null ? Math.max(0, swapTotal - swapFree) : null,
    },
    battery: parseWindowsBattery(value),
    disks: (Array.isArray(value.Disks)
      ? (value.Disks as Record<string, unknown>[])
      : [value.Disks as Record<string, unknown>]
    )
      .filter(Boolean)
      .slice(0, 128)
      .map((row) => {
        const totalBytes = positive(row.Size);
        const availableBytes = positive(row.FreeSpace);
        return {
          id: `volume:${row.DeviceID}`,
          name: text(row.VolumeName || row.DeviceID),
          kind: 'volume',
          type: 'volume',
          physical: false,
          parentId: null,
          parentIds: [],
          mountpoint: text(row.DeviceID ? String(row.DeviceID) + '\\' : null),
          filesystem: text(row.FileSystem),
          totalBytes,
          availableBytes,
          usedBytes:
            totalBytes === null || availableBytes === null
              ? null
              : Math.max(0, totalBytes - availableBytes),
          scope: 'host',
        };
      }),
  };
}

export type WindowsResourcesReport = ReturnType<typeof parseWindowsResources>;
