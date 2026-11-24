/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { App, InProcessBackend, liveRendererAsTest } from '@gpuix/react/automation';
import { CompactDashboard } from '@haus/ui/components';
import { GPUIX_CONTENT_HOST } from '@haus/ui/gpui';
import { HausUiProvider } from '@haus/ui/primitives';
import { Statistics, type StatisticsRequest } from '../../src/gpui/home/history.js';
import { GpuiWindow } from '../../src/gpui/window.js';

const output = process.argv[2];
assert(output, 'Supply a screenshot path for the recorded statistics fixture.');
const key = 'sensor.fixture_temperature';
const requests: Record<string, unknown>[] = [];
const request: StatisticsRequest = async (message) => {
  requests.push(message);
  if (message.type === 'recorder/list_statistic_ids') {
    return [
      { statistic_id: key, has_mean: true, name: 'Kitchen temperature', unit_of_measurement: '°C' },
    ];
  }
  assert.equal(message.type, 'recorder/statistics_during_period');
  assert.deepEqual(message.statistic_ids, [key]);
  const last = message.period === 'day' ? 24 : 21;
  return {
    [key]: [18, 20, 19, 22, 21, last].map((mean, index) => ({
      start: Date.UTC(2026, 5, index + 1),
      mean,
    })),
  };
};
const closed = Promise.withResolvers<number>();
const window = new GpuiWindow(
  { title: 'Haus · Recorded statistics', width: 820, height: 520, focus: false },
  closed.resolve,
);
window.mount(
  <HausUiProvider mode="dark" contentHost={GPUIX_CONTENT_HOST}>
    <CompactDashboard title="Statistics">
      <Statistics request={request} />
    </CompactDashboard>
  </HausUiProvider>,
);

let exit = 0;
try {
  const app = new App(new InProcessBackend(liveRendererAsTest(window.renderer)));
  await app.getByTestId('recorder-trend').waitFor({ timeoutMs: 5000 });
  await app.getByTestId('statistic-range-month').click();
  await app.getByText('24 °C').waitFor({ timeoutMs: 5000 });
  assert.equal(requests.at(-1)?.period, 'day');
  window.renderer.captureScreenshot(resolve(output));
  console.log('Native statistics loaded the selected range and rendered a trend chart.');
} catch (error) {
  console.error(error);
  exit = 1;
} finally {
  await window.close();
  assert.equal(await closed.promise, 0);
  process.exit(exit);
}
