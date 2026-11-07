/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { collectorOptions, createHostCollector } from '../runtime/collector.js';
import type { Service } from '@haus/core/lifecycle';
let service: Service | undefined;
let interrupted = false;
const stop = () => {
  interrupted = true;
  void service?.stop().catch(() => {
    process.exitCode = 1;
  });
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
try {
  const options = collectorOptions(process.argv.slice(2));
  service = createHostCollector({
    ...options,
    diagnostic: (code) => console.warn(`Haus telemetry: ${code}`),
  });
  if (interrupted) await service.stop();
  else {
    await service.start();
    if (options.once) await service.stop();
  }
} catch (error) {
  if (!interrupted || error instanceof AggregateError) {
    console.error('Haus telemetry collector failed. Check --output and destination permissions.');
    process.exitCode = 1;
  }
  await service?.stop().catch(() => {
    process.exitCode = 1;
  });
}
