/* oxlint-disable no-control-regex -- Strip control characters from untrusted hardware metadata. */
/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import dbus from '@homebridge/dbus-native';

export interface HostServiceUnit {
  id: string;
  name: string;
  status: string;
  detail: string;
  pid: number | null;
  cpuPercent: number | null;
  memoryBytes: number | null;
  uptimeSeconds: number | null;
}

export interface HostServiceSnapshot {
  available: boolean;
  source: string;
  cpuPercentBasis?: string;
  sampledAt: string;
  services: HostServiceUnit[];
  cpuPercent?: number | null;
  memoryBytes?: number | null;
}

interface DbusBusLike {
  connection: {
    state?: string;
    stream?: {
      destroy(): void;
      unref?(): void;
      on(event: string, listener: () => void): void;
    };
    on(event: string, listener: () => void): void;
  };
  cookies?: Record<number, unknown>;
  on?(event: string, listener: () => void): void;
  invoke(message: Record<string, unknown>, callback: (error: unknown, value?: unknown) => void): void;
}

const destination = 'org.freedesktop.systemd1';
const prefix = '/org/freedesktop/systemd1/unit/';
const active = (row: { status: string }) =>
  ['active', 'activating', 'reloading'].includes(row.status);
const clean = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/[\x00-\x1f]/g, '').slice(0, 240) : '';
const integer = (value: unknown): bigint | null => {
  try {
    if (value === null || value === undefined || !/^\d+$/.test(String(value))) return null;
    const result = BigInt(String(value));
    return result >= 0n && result < 18446744073709551615n ? result : null;
  } catch {
    return null;
  }
};
const numeric = (value: bigint | null): number | null =>
  value !== null && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;

const createDbusClient = Reflect.get(dbus, 'createClient') as (options: {
  busAddress: string;
  ReturnLongjs: boolean;
}) => DbusBusLike;

const defaultBusFactory = (): DbusBusLike =>
  createDbusClient({
    busAddress: 'unix:path=/run/dbus/system_bus_socket',
    ReturnLongjs: true,
  });

/** Only public unit identity/state and explicitly named accounting properties are read. */
export class HostServiceCounters {
  factory: () => DbusBusLike;
  now: () => number;
  previous = new Map<string, { cpu: bigint | null; pid: number | null; at: number }>();
  pending = new Set<(error: unknown, value?: unknown) => void>();
  nextConnectAt = 0;
  stopped = false;
  bus: DbusBusLike | null = null;
  loading: Promise<HostServiceSnapshot | null> | null = null;
  at?: number;
  value?: HostServiceSnapshot;

  constructor({
    factory = defaultBusFactory,
    now = Date.now,
  }: {
    factory?: () => DbusBusLike;
    now?: () => number;
  } = {}) {
    this.factory = factory;
    this.now = now;
  }

  disconnect(): void {
    const bus = this.bus;
    this.bus = null;
    this.nextConnectAt = this.now() + 30000;
    for (const finish of this.pending) finish(Error('host_bus_disconnected'));
    bus?.connection.stream?.destroy();
  }

  stop(): void {
    this.stopped = true;
    this.disconnect();
  }

  request(
    path: string,
    iface: string,
    member: string,
    signature?: string,
    body?: unknown[],
  ): Promise<unknown> {
    if (this.stopped || this.now() < this.nextConnectAt)
      return Promise.reject(Error('host_bus_unavailable'));
    if (!this.bus) {
      this.bus = this.factory();
      const bus = this.bus;
      // Passive telemetry must not keep a process alive after its owner stops.
      // Individual reads have bounded, referenced deadline timers of their own.
      bus.connection.stream?.unref?.();
      const failed = () => {
        if (this.bus === bus) this.disconnect();
      };
      bus.connection.on('error', failed);
      bus.connection.on('end', failed);
      bus.connection.stream?.on('close', failed);
      bus.on?.('error', failed);
    }
    const bus = this.bus;
    return new Promise((resolve, reject) => {
      let finished = false;
      const message: {
        destination: string;
        path: string;
        interface: string;
        member: string;
        signature?: string;
        body?: unknown[];
        serial?: number;
      } = {
        destination,
        path,
        interface: iface,
        member,
        ...(signature ? { signature, body } : {}),
      };
      const finish = (error: unknown, value?: unknown) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.pending.delete(finish);
        if (message.serial && bus.cookies) delete bus.cookies[message.serial];
        if (error) reject(Error('host_bus_read_failed'));
        else resolve(value);
      };
      const timer = setTimeout(() => {
        finish(Error('host_bus_timeout'));
        if (bus.connection.state !== 'connected' && this.bus === bus) this.disconnect();
      }, 600);
      this.pending.add(finish);
      try {
        bus.invoke(message, finish);
      } catch (error) {
        finish(error);
      }
    });
  }

  async property(path: string, name: 'ControlGroup'): Promise<string | null>;
  async property(
    path: string,
    name: 'CPUUsageNSec' | 'MemoryCurrent' | 'MainPID',
  ): Promise<bigint | null>;
  async property(path: string, name: string): Promise<string | bigint | null> {
    try {
      const variant = (await this.request(
        path,
        'org.freedesktop.DBus.Properties',
        'Get',
        'ss',
        ['org.freedesktop.systemd1.Service', name],
      )) as unknown[][] | undefined;
      const value = variant?.[1]?.[0];
      return name === 'ControlGroup' ? (typeof value === 'string' ? value : null) : integer(value);
    } catch {
      return null;
    }
  }

  collect(): Promise<HostServiceSnapshot | null> {
    if (this.loading) return this.loading;
    if (this.stopped) return Promise.resolve(null);
    if (this.at !== undefined && this.now() - this.at < 1000)
      return Promise.resolve(this.value ?? null);
    this.at = this.now();
    this.loading = this.sample()
      .catch(() => null)
      .then((value) => {
        if (value) this.value = value;
        return value;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  snapshot(): HostServiceSnapshot | null {
    void this.collect();
    return this.value && this.now() - Date.parse(this.value.sampledAt) <= 30000 ? this.value : null;
  }

  async sample(): Promise<HostServiceSnapshot> {
    const listed = await this.request(
      '/org/freedesktop/systemd1',
      destination + '.Manager',
      'ListUnits',
    );
    if (!Array.isArray(listed)) throw Error('invalid_host_units');
    const started = this.now();
    const rows = listed
      .slice(0, 4096)
      .filter(
        (row): row is [string, unknown, unknown, unknown, unknown, unknown, string, ...unknown[]] =>
          Array.isArray(row) &&
          typeof row[0] === 'string' &&
          row[0].endsWith('.service') &&
          row[2] !== 'not-found' &&
          typeof row[6] === 'string' &&
          row[6].startsWith(prefix) &&
          /^\/[a-zA-Z0-9_/]+$/.test(row[6]),
      )
      .slice(0, 512);
    const services: Array<HostServiceUnit | undefined> = Array.from({ length: rows.length }),
      previous = new Map<string, { cpu: bigint | null; pid: number | null; at: number }>();
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(8, rows.length) }, async () => {
        while (cursor < rows.length && !this.stopped) {
          const index = cursor++,
            row = rows[index]!;
          const service: HostServiceUnit = {
            id: clean(row[0]),
            name: clean(row[1]) || clean(row[0]),
            status: clean(row[3]),
            detail: clean(row[4]),
            pid: null,
            cpuPercent: null,
            memoryBytes: null,
            uptimeSeconds: null,
          };
          services[index] = service;
          if (!active(service) || this.now() - started >= 1500) continue;
          const [cpu, memory, rawPid] = await Promise.all([
            this.property(row[6], 'CPUUsageNSec'),
            this.property(row[6], 'MemoryCurrent'),
            this.property(row[6], 'MainPID'),
          ]);
          const at = this.now(),
            pid = numeric(rawPid),
            prior = this.previous.get(service.id);
          service.pid = pid !== null && pid > 0 ? pid : null;
          service.memoryBytes = numeric(memory);
          // RemainAfterExit keeps one-shot units active after all their work
          // has finished. An empty cgroup confirms no current resource owner.
          const emptyGroup =
            pid === 0 &&
            service.detail === 'exited' &&
            (await this.property(row[6], 'ControlGroup')) === '';
          if (emptyGroup) service.memoryBytes = 0;
          if (
            cpu !== null &&
            prior?.cpu !== null &&
            prior?.cpu !== undefined &&
            prior.pid === pid &&
            at > prior.at &&
            at - prior.at <= 30000 &&
            cpu >= prior.cpu
          )
            service.cpuPercent = Number(cpu - prior.cpu) / ((at - prior.at) * 10000);
          if (emptyGroup) service.cpuPercent = 0;
          previous.set(service.id, { cpu, pid, at });
        }
      }),
    );
    this.previous = previous;
    const units = services.filter((item): item is HostServiceUnit => Boolean(item)),
      running = units.filter(active);
    const sum = (key: 'cpuPercent' | 'memoryBytes'): number | null =>
      running.every((row) => row[key] !== null)
        ? running.reduce((value, row) => value + (row[key] ?? 0), 0)
        : null;
    return {
      available: true,
      source: 'systemd-dbus',
      cpuPercentBasis: 'core',
      sampledAt: new Date(this.now()).toISOString(),
      services: units,
      cpuPercent: sum('cpuPercent'),
      memoryBytes: sum('memoryBytes'),
    };
  }
}
