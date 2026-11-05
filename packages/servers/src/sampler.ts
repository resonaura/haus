/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { parseWindowsResources, resourceScript, type WindowsResourcesReport } from './windows.js';
import type { HostSwap } from './types.js';

export class WindowsResourceSampler {
  wsl: boolean;
  now: () => number;
  launch: typeof spawn;
  waiters: Set<{
    resolve: (val: WindowsResourcesReport & { sampledAt: number }) => void;
    reject: (err: unknown) => void;
  }>;
  retryAt = 0;
  child?: ChildProcess;
  stopped = false;
  value?: WindowsResourcesReport & { sampledAt: number };
  stopReader?: () => void;

  constructor({
    wsl = false,
    now = Date.now,
    launch = spawn,
  }: { wsl?: boolean; now?: () => number; launch?: typeof spawn } = {}) {
    this.wsl = wsl;
    this.now = now;
    this.launch = launch;
    this.waiters = new Set();
  }

  start() {
    if (this.child || this.stopped || this.now() < this.retryAt) return;
    const loop = `[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false);while([Console]::In.ReadLine() -eq 'sample'){try{$value=&{${resourceScript}};[Console]::Out.WriteLine($value)}catch{[Console]::Out.WriteLine('{"error":"native_resources_unavailable"}')};[Console]::Out.Flush()}`;
    const child = this.launch(
      this.wsl ? '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe' : 'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(loop, 'utf16le').toString('base64'),
      ],
      { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true },
    );
    this.child = child;
    let buffer = '';
    let nextTick: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let requestedAt: number;
    const clearTimers = () => {
      clearTimeout(nextTick);
      clearTimeout(deadline);
    };
    const request = () => {
      if (this.child !== child || this.stopped) return;
      requestedAt = this.now();
      child.stdin?.write('sample\n');
      deadline = setTimeout(() => child.kill(), 10000);
    };
    this.stopReader = clearTimers;
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (this.child !== child) return;
      buffer += chunk;
      if (buffer.length > 65536) {
        child.kill();
        return;
      }
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer
          .slice(0, end)
          .replace(/^\uFEFF/, '')
          .trim();
        buffer = buffer.slice(end + 1);
        if (!line) continue;
        clearTimeout(deadline);
        clearTimeout(nextTick);
        nextTick = setTimeout(request, Math.max(0, 1000 - (this.now() - requestedAt)));
        try {
          const value = parseWindowsResources(JSON.parse(line));
          this.value = { ...value, sampledAt: this.now() };
          for (const waiter of this.waiters) waiter.resolve(this.value);
          this.waiters.clear();
        } catch {
          // Never publish a partial/invalid native sample or retime an old one.
        }
      }
    });
    const closed = () => {
      if (this.child !== child) return;
      clearTimers();
      this.child = undefined;
      this.retryAt = this.now() + 5000;
      for (const waiter of this.waiters) waiter.reject(new Error('windows_resources_unavailable'));
      this.waiters.clear();
    };
    child.once('error', closed);
    child.once('exit', closed);
    child.stdin?.on?.('error', closed);
    child.stdout?.on('error', closed);
    request();
  }

  async read(): Promise<WindowsResourcesReport & { sampledAt?: number }> {
    if (this.stopped) throw new Error('windows_resources_unavailable');
    this.start();
    if (this.value && this.now() - Number(this.value.sampledAt) <= 2500) return this.value;
    if (this.value || !this.child) throw new Error('windows_resources_unavailable');
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waiter = {
        resolve: (value: WindowsResourcesReport & { sampledAt: number }) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      timer = setTimeout(() => {
        this.waiters.delete(waiter);
        this.child?.kill();
        reject(new Error('windows_resources_unavailable'));
      }, 10000);
      this.waiters.add(waiter);
    });
  }

  stop() {
    this.stopped = true;
    this.stopReader?.();
    this.child?.stdin?.end();
    this.child?.kill();
    for (const waiter of this.waiters) waiter.reject(new Error('windows_resources_unavailable'));
    this.waiters.clear();
  }
}

export async function sampleCgroupSwap(
  read: (path: string, encoding?: string) => Promise<string | Buffer>,
): Promise<HostSwap> {
  const [swapMaxRaw, swapUsedRaw] = await Promise.all([
    read('/sys/fs/cgroup/memory.swap.max', 'utf8').catch(() => ''),
    read('/sys/fs/cgroup/memory.swap.current', 'utf8').catch(() => ''),
  ]);
  const swapMax = String(swapMaxRaw);
  const swapUsed = String(swapUsedRaw);
  if (/^(?:\d+|max)\s*$/.test(swapMax) && /^\d+\s*$/.test(swapUsed)) {
    return {
      supported: true,
      totalBytes: swapMax.trim() === 'max' ? null : Number(swapMax),
      usedBytes: Number(swapUsed),
    };
  }
  return { supported: false, totalBytes: null, usedBytes: null };
}

export function reconcileBackgroundSample(
  value: Record<string, unknown>,
  latest: Record<string, unknown> | null,
  inventoryStartedAt: number,
) {
  if (
    !latest ||
    typeof latest.sampledAt !== 'string' ||
    Date.parse(latest.sampledAt) < inventoryStartedAt
  ) {
    return value;
  }
  const latestCpu = (latest.cpu ?? {}) as Record<string, unknown>;
  const latestMemory = (latest.memory ?? {}) as Record<string, unknown>;
  const valueMemory = (value.memory ?? {}) as Record<string, unknown>;
  value.sampledAt = latest.sampledAt;
  value.cpu = {
    ...((value.cpu ?? {}) as Record<string, unknown>),
    usage: latestCpu.usage,
    loadAverage: latestCpu.loadAverage,
  };
  value.memory = {
    ...latestMemory,
    installedBytes: valueMemory.installedBytes ?? latestMemory.installedBytes,
  };
  value.swap = latest.swap;
  value.uptimeSeconds = latest.uptimeSeconds;
  return value;
}
