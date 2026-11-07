/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HostTelemetry, sanitizeHostReport } from '@haus/servers';
import { Service } from '@haus/core/lifecycle';
import { isErrCode } from '../nvr/blob-readers.js';

import { stopTelemetry, type TelemetrySource } from './telemetry.js';
export interface CollectorOptions {
  output: string;
  once?: boolean;
  telemetry?: TelemetrySource;
  diagnostic?: (code: string) => void;
}

async function save(output: string, telemetry: TelemetrySource): Promise<void> {
  const report = sanitizeHostReport(telemetry.status());
  const temporary = `${output}.${randomUUID()}.tmp`;
  let handle;
  const errors: unknown[] = [];
  try {
    handle = await open(temporary, 'wx', 0o640);
    await handle.writeFile(JSON.stringify(report) + '\n');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, output);
  } catch (error) {
    errors.push(error);
  }
  try {
    await handle?.close();
  } catch (error) {
    errors.push(error);
  }
  try {
    await unlink(temporary);
  } catch (error) {
    if (!isErrCode(error, 'ENOENT')) errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, 'telemetry_publish_failed');
}

/** Serial collection publishes complete sanitized reports; stopping joins the in-flight write. */
export function createHostCollector(options: CollectorOptions): Service {
  return new Service(async ({ signal, scope }) => {
    const telemetry = options.telemetry ?? new HostTelemetry({ nativeServices: true });
    const output = resolve(options.output);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: Promise<void> | undefined;
    let stopping = false;
    let closing: Promise<void> | undefined;
    const close = () =>
      (closing ??= (async () => {
        stopping = true;
        clearTimeout(timer);
        const results = await Promise.allSettled([stopTelemetry(telemetry), pending]);
        const errors = results.flatMap((value) =>
          value.status === 'rejected' ? [value.reason] : [],
        );
        if (errors.length) throw new AggregateError(errors, 'collector_shutdown_incomplete');
      })());
    scope.defer(close);
    try {
      signal.throwIfAborted();
      await mkdir(dirname(output), { recursive: true, mode: 0o750 });
      signal.throwIfAborted();
      await telemetry.initialize({ poll: false });
      signal.throwIfAborted();
      await save(output, telemetry);
      signal.throwIfAborted();
      const tick = async () => {
        if (stopping) return;
        const started = Date.now();
        try {
          await telemetry.sample();
          if (!stopping) await save(output, telemetry);
        } catch {
          options.diagnostic?.('host_sample_unavailable');
        }
        if (!stopping) timer = setTimeout(schedule, Math.max(0, 1000 - (Date.now() - started)));
      };
      const schedule = () => {
        pending = tick();
      };
      if (!options.once) timer = setTimeout(schedule, 1000);
      return { close };
    } catch (error) {
      try {
        await close();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], 'collector_start_failed');
      }
      throw error;
    }
  });
}

export function collectorOptions(args: string[]): { output: string; once: boolean } {
  let output: string | undefined;
  let once = false;
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === '--once' && !once) once = true;
    else if (name === '--output' && output === undefined) {
      output = args[++index];
      if (!output || output.startsWith('--')) throw Error('invalid_collector_arguments');
    } else throw Error('invalid_collector_arguments');
  }
  if (!output) throw Error('invalid_collector_arguments');
  return { output, once };
}
