/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { readFile, readdir } from 'node:fs/promises';
import { command } from './services.js';

const objectRows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value : value ? [value as Record<string, unknown>] : [];

const boolValue = (value: unknown) => {
  if (value === true || value === 1 || /^(?:true|1)$/i.test(String(value))) return true;
  if (value === false || value === 0 || /^(?:false|0)$/i.test(String(value))) return false;
  return null;
};

const positive = (value: unknown) =>
  value !== null &&
  value !== undefined &&
  !(typeof value === 'string' && !value.trim()) &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0
    ? Number(value)
    : null;

export async function linuxBattery({
  list = readdir,
  read = ((p: string, enc?: string) => readFile(p, (enc ?? 'utf8') as BufferEncoding)) as (
    path: string,
    encoding?: string,
  ) => Promise<string | Buffer>,
}: {
  list?: (path: string) => Promise<string[]>;
  read?: (path: string, encoding?: string) => Promise<string | Buffer>;
} = {}) {
  let entries: string[];
  try {
    entries = await list('/sys/class/power_supply');
  } catch {
    return null;
  }
  const names = entries
    .map((entry: unknown) =>
      typeof entry === 'string' ? entry : (entry as { name?: string })?.name,
    )
    .filter(
      (name: unknown): name is string =>
        typeof name === 'string' && /^(?:BAT\d*|battery\d*)$/i.test(name),
    );
  if (!names.length) return null;
  const supplyNames = entries
    .map((entry: unknown) =>
      typeof entry === 'string' ? entry : (entry as { name?: string })?.name,
    )
    .filter((name: unknown): name is string => typeof name === 'string' && !names.includes(name))
    .slice(0, 32);
  const supplies = await Promise.all(
    supplyNames.map(async (name: string) => {
      const base = `/sys/class/power_supply/${name}`;
      const [type, online] = await Promise.all([
        read(`${base}/type`, 'utf8').catch(() => ''),
        read(`${base}/online`, 'utf8').catch(() => ''),
      ]);
      if (!/^(?:mains|usb(?:[-_a-z0-9]*)?)$/i.test(String(type).trim())) return null;
      const value = String(online).trim();
      return value === '1' ? true : value === '0' ? false : null;
    }),
  );
  const powerStates = supplies.filter((value): value is boolean => value !== null);
  const batteries = await Promise.all(
    names.map(async (name: string) => {
      const directory = `/sys/class/power_supply/${name}`;
      const [capacity, status, energyNow, energyFull] = await Promise.all([
        read(`${directory}/capacity`, 'utf8').catch(() => ''),
        read(`${directory}/status`, 'utf8').catch(() => ''),
        read(`${directory}/energy_now`, 'utf8').catch(() => ''),
        read(`${directory}/energy_full`, 'utf8').catch(() => ''),
      ]);
      const capacityValue = positive(String(capacity).trim() || null);
      const nowValue = positive(String(energyNow).trim() || null);
      const fullValue = positive(String(energyFull).trim() || null);
      const level =
        capacityValue !== null && capacityValue <= 100
          ? capacityValue
          : nowValue !== null && fullValue !== null && fullValue > 0
            ? Math.max(0, Math.min(100, (nowValue / fullValue) * 100))
            : null;
      const normalizedStatus = String(status).trim().toLowerCase();
      return {
        level,
        charging:
          normalizedStatus === 'charging'
            ? true
            : ['full', 'discharging', 'not charging'].includes(normalizedStatus)
              ? false
              : null,
      };
    }),
  );
  const levels = batteries
    .map((battery) => battery.level)
    .filter((l): l is number => typeof l === 'number' && Number.isFinite(l));
  const chargingStates = batteries
    .map((battery) => battery.charging)
    .filter((value) => value !== null);
  return {
    level: levels.length ? levels.reduce((sum, level) => sum + level, 0) / levels.length : null,
    ...(powerStates.length ? { powerConnected: powerStates.includes(true) } : {}),
    charging: chargingStates.includes(true) ? true : chargingStates.length ? false : null,
  };
}

export function parseMacBattery(output: string) {
  const readings = [...String(output).matchAll(/(\d{1,3})%;\s*([^;\n]+)/g)]
    .map((match) => ({
      level: Math.min(100, Number(match[1])),
      status: match[2].trim().toLowerCase(),
    }))
    .filter((item) => Number.isFinite(item.level));
  if (!readings.length) return null;
  const power = /Now drawing from '(AC Power|Battery Power)'/i.exec(String(output));
  return {
    ...(power ? { powerConnected: power[1].toLowerCase() === 'ac power' } : {}),
    level: readings.reduce((sum, item) => sum + item.level, 0) / readings.length,
    charging: readings.some(
      (item) => item.status === 'charging' || item.status === 'finishing charge',
    )
      ? true
      : false,
  };
}

export function parseWindowsBattery(value: Record<string, unknown> | null | undefined) {
  const batteries = objectRows(value?.Battery).filter(Boolean);
  const statuses = objectRows(value?.BatteryStatus).filter(Boolean);
  if (!batteries.length && !statuses.length) return null;
  const levels = batteries
    .map((battery) => positive(battery.EstimatedChargeRemaining))
    .filter((level): level is number => level !== null && level <= 100);
  const activeStatuses = statuses.filter((status) => boolValue(status.Active) !== false);
  const wmiCharging = activeStatuses.map((status) => {
    const charging = boolValue(status.Charging);
    const discharging = boolValue(status.Discharging);
    return charging === true ? true : discharging === true ? false : charging;
  });
  const knownWmiStates = wmiCharging.filter((state): state is boolean => state !== null);
  const batteryStates = batteries
    .map((battery) => positive(battery.BatteryStatus))
    .filter((status): status is number => status !== null);
  const powerStates = activeStatuses
    .map((status) => boolValue(status.PowerOnline))
    .filter((state): state is boolean => state !== null);
  const powerConnected = powerStates.length
    ? powerStates.includes(true)
    : batteryStates.includes(2)
      ? true
      : null;
  const charging = knownWmiStates.includes(true)
    ? true
    : knownWmiStates.length
      ? false
      : batteryStates.some((status: number) => [6, 7, 8, 9].includes(status))
        ? true
        : batteryStates.some((status: number) => [3, 4, 5, 11].includes(status))
          ? false
          : null;
  return {
    level: levels.length
      ? levels.reduce((sum: number, level: number) => sum + level, 0) / levels.length
      : null,
    charging,
    ...(powerConnected === null ? {} : { powerConnected }),
  };
}

const windowsBatteryScript = `
$ErrorActionPreference='SilentlyContinue';$ProgressPreference='SilentlyContinue';
$b=@();try{$b=@(Get-CimInstance Win32_Battery -OperationTimeoutSec 3 | Select-Object -First 16 EstimatedChargeRemaining,BatteryStatus)}catch{};
$s=@();try{$s=@(Get-CimInstance -Namespace root\\wmi -ClassName BatteryStatus -OperationTimeoutSec 3 | Select-Object -First 16 Active,Charging,Discharging,RemainingCapacity,PowerOnline)}catch{};
[pscustomobject]@{Battery=$b;BatteryStatus=$s} | ConvertTo-Json -Depth 4 -Compress
`;

export async function windowsBattery({
  run = command,
  wsl = false,
}: {
  run?: (file: string, args: string[], options?: Record<string, unknown>) => Promise<string>;
  wsl?: boolean;
} = {}) {
  const output = await run(
    wsl ? '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe' : 'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(windowsBatteryScript, 'utf16le').toString('base64'),
    ],
    { timeout: 8000, maxBuffer: 32 * 1024 },
  );
  return parseWindowsBattery(JSON.parse(output.replace(/^\uFEFF/, '')));
}
