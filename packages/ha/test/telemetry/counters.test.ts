/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import assert from 'node:assert/strict';
import { test } from 'vitest';
import { EventEmitter } from 'node:events';
import { HostServiceCounters } from '@haus/ha/node/host-service-counters';

type CounterOptions = NonNullable<ConstructorParameters<typeof HostServiceCounters>[0]>;
type Bus = ReturnType<NonNullable<CounterOptions['factory']>>;
type Message = { serial?: number; member?: string; body: unknown[] };
type Callback = (error: unknown, value?: unknown) => void;

class FakeStream extends EventEmitter {
  constructor(private readonly onDestroy: () => void = () => this.emit('close')) {
    super();
  }

  destroy(): void {
    this.onDestroy();
  }
}

class FakeConnection extends EventEmitter {
  readonly stream: FakeStream;

  constructor(onDestroy?: () => void) {
    super();
    this.stream = new FakeStream(onDestroy);
  }
}

interface FakeBus extends Bus {
  cookies: Record<number, Callback>;
  serial: number;
}

function fixture() {
  let at = 1000,
    cpu = 90071992547409930n,
    missing = false;
  const calls: Message[] = [],
    connection = new FakeConnection();
  const bus: FakeBus = {
    connection,
    cookies: {},
    serial: 1,
    invoke(rawMessage, callback) {
      const message = rawMessage as Message;
      message.serial = this.serial++;
      this.cookies[message.serial] = callback;
      calls.push(message);
      queueMicrotask(() => {
        if (!this.cookies[message.serial ?? 0]) return;
        delete this.cookies[message.serial ?? 0];
        if (message.member === 'ListUnits')
          return callback(null, [
            [
              'fixture.service',
              'Fixture',
              'loaded',
              'active',
              'running',
              '',
              '/org/freedesktop/systemd1/unit/fixture_2eservice',
            ],
            [
              'stopped.service',
              'Stopped',
              'loaded',
              'inactive',
              'dead',
              '',
              '/org/freedesktop/systemd1/unit/stopped_2eservice',
            ],
            [
              'ignored.socket',
              'Socket',
              'loaded',
              'active',
              'running',
              '',
              '/org/freedesktop/systemd1/unit/socket',
            ],
            ['private.service', 'Private', 'loaded', 'active', 'running', '', '/arbitrary/path'],
          ]);
        const name = message.body[1];
        const value =
          name === 'CPUUsageNSec'
            ? cpu
            : name === 'MainPID'
              ? 20n
              : missing
                ? 18446744073709551615n
                : 1048576n;
        callback(null, [[{ type: 't' }], [{ toString: () => String(value) }]]);
      });
    },
  };
  const reader = new HostServiceCounters({ factory: () => bus, now: () => at });
  return {
    reader,
    bus,
    calls,
    set: (time: number, value: bigint, unknown = false) => {
      at = time;
      cpu = value;
      missing = unknown;
    },
  };
}

test('host D-Bus counters use exact 64-bit deltas and an allowlist of public reads', async () => {
  const f = fixture();
  const first = await f.reader.collect();
  assert.ok(first);
  assert.equal(first.services.length, 2);
  assert.equal(first.services[0].cpuPercent, null);
  assert.equal(first.memoryBytes, 1048576);
  f.set(2000, 90071992647409930n);
  const next = await f.reader.collect();
  assert.ok(next);
  assert.equal(next.services[0].cpuPercent, 10);
  assert.equal(next.cpuPercentBasis, 'core');
  assert.equal(next.services[0].pid, 20);
  assert.ok(f.calls.every((call) => ['ListUnits', 'Get'].includes(call.member ?? '')));
  assert.ok(
    f.calls
      .filter((call) => call.member === 'Get')
      .every((call) => ['CPUUsageNSec', 'MemoryCurrent', 'MainPID'].includes(String(call.body[1]))),
  );
  f.set(3000, 2n, true);
  const reset = await f.reader.collect();
  assert.ok(reset);
  assert.equal(reset.services[0].cpuPercent, null);
  assert.equal(reset.services[0].memoryBytes, null);
  f.reader.stop();
});

test('concurrent polls coalesce, snapshots expire, and stop cancels the connection', async () => {
  const f = fixture();
  const a = f.reader.collect(),
    b = f.reader.collect();
  assert.equal(a, b);
  await a;
  assert.equal(f.calls.filter((call) => call.member === 'ListUnits').length, 1);
  const snapshot = f.reader.snapshot();
  assert.ok(snapshot);
  assert.equal(snapshot.available, true);
  f.set(40000, 3n);
  assert.equal(f.reader.snapshot(), null);
  f.reader.stop();
  assert.equal(await f.reader.collect(), null);
  assert.equal(f.reader.pending.size, 0);
});

test('missing or denied host bus stays unavailable without crashing or retrying each poll', async () => {
  let creations = 0;
  const reader = new HostServiceCounters({
    factory: () => {
      creations++;
      const connection = new FakeConnection(() => {});
      return {
        cookies: {},
        connection,
        invoke() {
          queueMicrotask(() => connection.emit('error', Error('denied')));
        },
      };
    },
  });
  assert.equal(await reader.collect(), null);
  assert.equal(reader.pending.size, 0);
  assert.equal(await reader.collect(), null);
  assert.equal(creations, 1);
  reader.stop();
});

test('an exited one-shot with no remaining cgroup has zero current resource use', async () => {
  const f = fixture();
  const original = f.bus.invoke;
  f.bus.invoke = function (rawMessage, callback) {
    const message = rawMessage as Message;
    if (message.member === 'ListUnits')
      return queueMicrotask(() =>
        callback(null, [
          [
            'oneshot.service',
            'Finished task',
            'loaded',
            'active',
            'exited',
            '',
            '/org/freedesktop/systemd1/unit/oneshot_2eservice',
          ],
        ]),
      );
    if (message.body[1] === 'MainPID')
      return queueMicrotask(() => callback(null, [[{ type: 'u' }], [0]]));
    if (message.body[1] === 'ControlGroup')
      return queueMicrotask(() => callback(null, [[{ type: 's' }], ['']]));
    return original.call(this, message, (error: unknown, value?: unknown) =>
      callback(
        error,
        message.body[1] === 'MemoryCurrent' ? [[{ type: 't' }], ['18446744073709551615']] : value,
      ),
    );
  };
  const report = await f.reader.collect();
  assert.ok(report);
  assert.equal(report.memoryBytes, 0);
  assert.equal(report.cpuPercent, 0);
  f.reader.stop();
});

test('a connection that never completes its handshake is closed instead of accumulating queued requests', async () => {
  let destroyed = false;
  const connection = new FakeConnection(() => {
    destroyed = true;
  });
  const bus: Pick<FakeBus, 'cookies' | 'connection' | 'invoke'> = {
    cookies: {},
    connection,
    invoke(message, callback) {
      message.serial = 1;
      this.cookies[1] = callback;
    },
  };
  const reader = new HostServiceCounters({ factory: () => bus });
  assert.equal(await reader.collect(), null);
  assert.equal(destroyed, true);
  assert.equal(reader.pending.size, 0);
  assert.equal(Object.keys(bus.cookies).length, 0);
  reader.stop();
});
