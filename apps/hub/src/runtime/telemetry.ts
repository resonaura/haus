/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { HostTelemetry } from '@haus/servers';
export type TelemetrySource = Pick<
  HostTelemetry,
  'initialize' | 'sample' | 'status' | 'stop' | 'pending' | 'inventoryRefresh'
>;

/** A final resource sample can schedule an inventory refresh; join it after the sample settles. */
export async function stopTelemetry(telemetry: TelemetrySource): Promise<void> {
  const errors: unknown[] = [];
  try {
    telemetry.stop();
  } catch (error) {
    errors.push(error);
  }
  try {
    await telemetry.pending;
  } catch (error) {
    errors.push(error);
  }
  try {
    await telemetry.inventoryRefresh;
  } catch (error) {
    errors.push(error);
  }
  if (errors.length) throw new AggregateError(errors, 'telemetry_shutdown_incomplete');
}
