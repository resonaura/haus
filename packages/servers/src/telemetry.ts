/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as os from 'node:os';
import { readdir } from 'node:fs/promises';
import { readHostFile } from './reading.js';
import { hostHardware, sanitizeHardware } from './hardware.js';
import {
  windowsDisks,
  windowsResources,
  windowsTelemetry,
  type WindowsResourcesReport,
} from './windows.js';
import { WindowsResourceSampler, sampleCgroupSwap, reconcileBackgroundSample } from './sampler.js';
import { linuxInstalledMemory, parseMeminfo } from './memory.js';
import { wslStorageBacking } from './wsl.js';
import { sampleCpuDelta, type CpuSample } from './cpu.js';
import { sampleDarwinPlatform } from './darwin.js';
import { linuxDisks, volumeAt } from './disks.js';
import { linuxBattery, windowsBattery } from './battery.js';
import { command, dockerTelemetry, pm2Telemetry } from './services.js';
import { SystemServiceTelemetry, type SystemServiceReport } from './system-services.js';
import { unavailable } from './sanitize.js';
import { parseOsRelease, readHostReport, isContainer } from './os.js';
import type { HostDisk, HostSwap, HostMemory, HostBattery } from './types.js';

export interface HostCapacitySource {
  status: () => {
    memoryBytes: number;
    memoryCurrentBytes: number;
    cpu: number;
    cpus: number;
  };
}

/** Read-only host facts used by the sampler; no unrelated OS operations are required. */
export interface HostSystem {
  cpus(): Array<{ model?: string; times: Record<string, number> }>;
  totalmem(): number;
  freemem(): number;
  release(): string;
  hostname(): string;
  arch(): string;
  uptime(): number;
  loadavg(): number[];
}

/** Bounded cached samples keep slow host tools completely outside the media request path. */
export class HostTelemetry {
  dataPath: string;
  capacity?: HostCapacitySource;
  collectorFile?: string;
  nativeServices: boolean;
  container?: boolean;
  platform: string;
  system: HostSystem;
  read: (path: string, encoding?: string) => Promise<string | Buffer>;
  list: (path: string) => Promise<string[]>;
  run: (cmd: string, args: string[], options?: Record<string, unknown>) => Promise<string>;
  intervalMs: number;
  now: () => number;
  value: Record<string, unknown> | null = null;
  systemServices: SystemServiceTelemetry;
  stopped = false;
  timer?: ReturnType<typeof setInterval>;
  pending?: Promise<void> | null;
  inventoryRefresh?: Promise<void>;
  inventoryAt = 0;
  wslBatteryAttemptAt?: number;
  wslBattery?: HostBattery | null;
  wslBatteryAt = 0;
  windowsDiskView = false;
  hardwareAt?: number;
  hardware?: Record<string, unknown>;
  previous: CpuSample | null = null;
  windowsSampler?: WindowsResourceSampler;

  constructor({
    dataPath = '/data',
    capacity,
    collectorFile,
    nativeServices = false,
    container,
    platform = os.platform(),
    system = os,
    read = readHostFile,
    list = readdir,
    run = command,
    intervalMs = 1000,
    now = Date.now,
  }: {
    dataPath?: string;
    capacity?: HostCapacitySource;
    collectorFile?: string;
    nativeServices?: boolean;
    container?: boolean;
    platform?: string;
    system?: HostSystem;
    read?: (path: string, encoding?: string) => Promise<string | Buffer>;
    list?: (path: string) => Promise<string[]>;
    run?: (cmd: string, args: string[], options?: Record<string, unknown>) => Promise<string>;
    intervalMs?: number;
    now?: () => number;
  } = {}) {
    this.dataPath = dataPath;
    this.capacity = capacity;
    this.collectorFile = collectorFile;
    this.nativeServices = nativeServices;
    this.container = container;
    this.platform = platform;
    this.system = system;
    this.read = read;
    this.list = list;
    this.run = run;
    this.intervalMs = intervalMs;
    this.now = now;
    this.systemServices = new SystemServiceTelemetry({
      run,
      now,
      uptimeSeconds: () => system.uptime(),
    });
  }

  async initialize({ poll = true }: { poll?: boolean } = {}) {
    this.container ??= await isContainer();
    await this.sample();
    if (poll) {
      this.timer = setInterval(() => void this.sample().catch(() => {}), this.intervalMs);
      this.timer.unref();
    }
    return this;
  }

  async sample() {
    if (this.pending) return this.pending;
    this.pending = this.collect().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  async collect() {
    if (
      this.collectorFile ||
      this.container ||
      !this.value ||
      !['linux', 'win32'].includes(this.platform)
    )
      return this.collectInventory();
    await this.collectResources();
    if (!this.inventoryRefresh && this.now() - this.inventoryAt >= 10000)
      this.inventoryRefresh = this.collectInventory(true)
        .catch(() => {})
        .finally(() => {
          this.inventoryRefresh = undefined;
        });
  }

  async collectInventory(background = false) {
    if (this.stopped) return;
    if (this.collectorFile) {
      try {
        this.value = await readHostReport(this.collectorFile, this.now());
        return;
      } catch {
        /* Stale/unavailable collectors fall back to truthful local scope. */
      }
    }
    const inventoryStartedAt = (this.inventoryAt = this.now());
    const cpus = this.system.cpus();
    let usage = await this.sampleCpu(cpus);
    const resources = this.capacity?.status();
    const scope = this.container ? 'container' : 'host';
    let memory: HostMemory = {
      totalBytes: this.system.totalmem(),
      installedBytes: this.container ? null : this.system.totalmem(),
      availableBytes: this.system.freemem(),
      usedBytes: this.system.totalmem() - this.system.freemem(),
    };
    let swap: HostSwap = { supported: false, totalBytes: null, usedBytes: null },
      disks: HostDisk[] = [],
      battery: HostBattery | null = null,
      storageBacking: unknown;
    if (this.container) {
      if (resources) {
        memory = {
          totalBytes: resources.memoryBytes,
          installedBytes: null,
          usedBytes: resources.memoryCurrentBytes,
          availableBytes: Math.max(0, resources.memoryBytes - resources.memoryCurrentBytes),
        };
        usage = resources.cpu;
      }
      swap = await sampleCgroupSwap(this.read);
      try {
        disks = [await volumeAt(this.dataPath, { scope, name: 'Haus data' })];
      } catch {
        /* Storage status separately reports failures. */
      }
    } else if (this.platform === 'linux') {
      const info = parseMeminfo(String(await this.read('/proc/meminfo', 'utf8').catch(() => '')));
      const installedBytes = await linuxInstalledMemory({
        list: this.list,
        read: this.read,
      });
      memory = info.memory ? { ...info.memory, installedBytes } : { ...memory, installedBytes };
      swap = info.swap;
      disks = await linuxDisks({
        run: this.run,
        read: this.read,
        virtualized: /microsoft|wsl/i.test(this.system.release()),
      });
      battery = await linuxBattery({ list: this.list, read: this.read });
      if (/microsoft|wsl/i.test(this.system.release())) {
        const sampleAt = this.now();
        if (
          this.wslBatteryAttemptAt === undefined ||
          sampleAt - this.wslBatteryAttemptAt >= 10000
        ) {
          this.wslBatteryAttemptAt = sampleAt;
          try {
            const windows = await windowsBattery({ run: this.run, wsl: true });
            if (windows) {
              this.wslBattery = windows;
              this.wslBatteryAt = sampleAt;
            }
          } catch {
            // WSL interop may briefly fail; keep a recent native sample.
          }
        }
        if (this.wslBattery && sampleAt - this.wslBatteryAt <= 30000) battery = this.wslBattery;
        try {
          const native = await windowsDisks({ run: this.run, wsl: true });
          const root = disks.find((disk) => disk.mountpoint === '/');
          disks = [
            ...native,
            ...(root
              ? [
                  {
                    ...root,
                    id: 'wsl:root',
                    name: 'Linux filesystem (WSL)',
                    kind: 'volume',
                    type: 'container',
                    physical: false,
                    parentId: null,
                    parentIds: [],
                  },
                ]
              : []),
          ];
          this.windowsDiskView = true;
        } catch {
          if (this.windowsDiskView && this.value) return;
        }
        try {
          storageBacking = await wslStorageBacking({
            run: this.run,
            now: this.now,
          });
        } catch {
          storageBacking = this.value?.storageBacking;
        }
      }
    } else if (this.platform === 'darwin') {
      const darwin = await sampleDarwinPlatform(this.run, memory);
      disks = darwin.disks;
      swap = darwin.swap;
      memory = darwin.memory;
      battery = darwin.battery;
    } else if (this.platform === 'win32') {
      try {
        const result = await windowsTelemetry(this.run);
        memory = result.memory || memory;
        swap = result.swap;
        battery = result.battery;
        try {
          disks = await windowsDisks({ run: this.run });
        } catch {
          // Logical volumes still report truthful usage without a disk tree.
        }
      } catch {
        /* Unsupported CIM stays unavailable. */
      }
    }
    const wsl =
      !this.container && this.platform === 'linux' && /microsoft|wsl/i.test(this.system.release());
    let docker: Record<string, unknown> = unavailable('containers'),
      pm2: Record<string, unknown> = unavailable('processes'),
      systemServices: SystemServiceReport | Record<string, unknown> = unavailable('services');
    if (this.nativeServices && !this.container)
      [docker, pm2, systemServices] = await Promise.all([
        dockerTelemetry(this.run),
        pm2Telemetry({ run: this.run, read: this.read, now: this.now() }),
        this.systemServices.collect({ platform: this.platform, wsl }),
      ]);
    if (
      this.nativeServices &&
      !this.container &&
      (this.hardwareAt === undefined || this.now() - this.hardwareAt >= 60000)
    ) {
      this.hardwareAt = this.now();
      this.hardware = await hostHardware({
        platform: this.platform,
        wsl: this.platform === 'linux' && /microsoft|wsl/i.test(this.system.release()),
        run: this.run,
        now: this.now,
      }).catch(() => sanitizeHardware({}));
    }
    const { installedMemoryBytes, ...hardware } = (this.hardware ?? {}) as {
      installedMemoryBytes?: number;
      operatingSystem?: { name?: string; version?: string; platform?: string };
    };
    let nativeResources: WindowsResourcesReport | undefined;
    if (!this.container && (this.platform === 'win32' || wsl)) {
      try {
        nativeResources = await this.readWindowsResources(wsl);
      } catch {
        if (this.value?.metricsScope === 'windows') return;
      }
    }
    let value: Record<string, unknown> = {
      sampledAt: new Date(
        (nativeResources as { sampledAt?: number } | undefined)?.sampledAt ?? this.now(),
      ).toISOString(),
      scope,
      hostname: this.system.hostname(),
      platform: nativeResources ? 'win32' : this.platform,
      ...(!nativeResources && !this.container && this.platform === 'linux'
        ? parseOsRelease(String(await this.read('/etc/os-release', 'utf8').catch(() => '')))
        : {}),
      release: nativeResources ? (hardware.operatingSystem?.version ?? '') : this.system.release(),
      arch: this.system.arch(),
      ...hardware,
      ...(hardware.operatingSystem?.platform === 'win32'
        ? {
            osName: [hardware.operatingSystem.name, hardware.operatingSystem.version]
              .filter(Boolean)
              .join(' · '),
          }
        : {}),
      ...(nativeResources ? { metricsScope: 'windows' } : wsl ? { metricsScope: 'wsl' } : {}),
      ...(wsl
        ? {
            runtime: {
              kind: 'wsl',
              platform: 'linux',
              release: this.system.release(),
            },
            serviceScope: 'wsl',
          }
        : {}),
      uptimeSeconds: nativeResources ? nativeResources.uptimeSeconds : this.system.uptime(),
      ...(storageBacking ? { storageBacking } : {}),
      battery,
      cpu: nativeResources?.cpu ?? {
        model: cpus[0]?.model || 'CPU',
        logicalCores: this.container && resources ? resources.cpus : cpus.length || 1,
        usage,
        loadAverage: this.container ? [] : this.system.loadavg(),
      },
      memory: {
        ...(nativeResources?.memory ?? memory),
        ...(installedMemoryBytes ? { installedBytes: installedMemoryBytes } : {}),
      },
      swap: nativeResources?.swap ?? swap,
      disks,
      docker,
      pm2,
      systemServices,
    };
    if (this.stopped) return;
    if (background) {
      value = reconcileBackgroundSample(value, this.value, inventoryStartedAt);
    }
    this.value = value;
  }

  async sampleCpu(cpus: Array<{ times: Record<string, number>; model?: string }>) {
    const { sample, usage } = await sampleCpuDelta(cpus, this.previous, {
      platform: this.platform,
      container: this.container,
      read: (p, enc) => this.read(p, enc).then(String),
    });
    this.previous = sample;
    return usage;
  }

  async readWindowsResources(wsl: boolean): Promise<WindowsResourcesReport> {
    if (this.run !== command || !this.nativeServices)
      return windowsResources({ run: this.run, wsl });
    this.windowsSampler ??= new WindowsResourceSampler({ wsl, now: this.now });
    return this.windowsSampler.read();
  }

  async collectResources() {
    const wsl = this.platform === 'linux' && /microsoft|wsl/i.test(this.system.release());
    if (this.platform === 'win32' || wsl) {
      try {
        const native = await this.readWindowsResources(wsl);
        const sampledAt =
          typeof (native as { sampledAt?: number })?.sampledAt === 'number'
            ? (native as { sampledAt?: number }).sampledAt!
            : this.now();
        const osObj = this.value?.operatingSystem as { version?: string } | undefined;
        const memObj = this.value?.memory as { installedBytes?: number } | undefined;
        this.value = {
          ...this.value,
          sampledAt: new Date(sampledAt).toISOString(),
          platform: 'win32',
          distribution: null,
          release: osObj?.version ?? '',
          metricsScope: 'windows',
          cpu: native.cpu,
          memory: {
            ...native.memory,
            installedBytes: memObj?.installedBytes,
          },
          swap: native.swap,
          uptimeSeconds: native.uptimeSeconds,
        };
        return;
      } catch {
        if (this.value?.metricsScope === 'windows' || this.windowsDiskView) return;
      }
    }
    const usage = await this.sampleCpu(this.system.cpus());
    const info = parseMeminfo(String(await this.read('/proc/meminfo', 'utf8').catch(() => '')));
    const prevMem = this.value?.memory as { installedBytes?: number } | undefined;
    const prevCpu = this.value?.cpu as Record<string, unknown> | undefined;
    this.value = {
      ...this.value,
      sampledAt: new Date(this.now()).toISOString(),
      uptimeSeconds: this.system.uptime(),
      cpu: { ...prevCpu, usage, loadAverage: this.system.loadavg() },
      memory: {
        ...(info.memory ?? prevMem),
        installedBytes: prevMem?.installedBytes,
      },
      swap: info.swap,
    };
  }

  status() {
    return this.value;
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.windowsSampler?.stop();
  }
}
