/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { App, InProcessBackend, liveRendererAsTest } from '@gpuix/react/automation';
import { createDemoSnapshot } from '@haus/ha/view/demo/snapshot';
import { defaults } from '@haus/ha/view/preferences';
import { MediaRuntime } from '@haus/media/pipeline';
import { GPUIX_CONTENT_HOST } from '@haus/ui/gpui';
import { HausUiProvider } from '@haus/ui/primitives';
import { useEffect, useState } from 'react';
import sharp from 'sharp';
import { GpuiCameraModal } from '../../src/gpui/camera/modal.js';
import { GpuiCameraStreams } from '../../src/gpui/camera/stream.js';
import { GpuiWindow } from '../../src/gpui/window.js';
import { camera, openCameraFixture } from './fixture.js';

const [input, output] = process.argv.slice(2);
assert(input && output, 'Supply an HLS fixture directory and an output directory.');
const directory = resolve(output);
await mkdir(directory, { recursive: true });
const fixture = await openCameraFixture(resolve(input));
const closed = Promise.withResolvers<number>();
const window = new GpuiWindow(
  { title: 'Haus · Camera modal fixture', width: 900, height: 620 },
  closed.resolve,
);
let presentedFrames = 0;
class MeasuredStreams extends GpuiCameraStreams {
  override async *open(...args: Parameters<GpuiCameraStreams['open']>) {
    for await (const frame of super.open(...args)) {
      yield frame;
      presentedFrames++;
    }
  }
}
const streams = new MeasuredStreams(new MediaRuntime(), fixture.viewer);
const snapshot = createDemoSnapshot();
snapshot.states.push({
  entity_id: camera,
  state: 'idle',
  attributes: { friendly_name: 'Fixture camera' },
  last_changed: '',
});
const preferences = defaults;
let updates = 0;

function Fixture() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setRevision((value) => value + 1), 140);
    return () => clearInterval(timer);
  }, []);
  updates = revision;
  return (
    <GpuiCameraModal
      cameraId={camera}
      allAccessories={[]}
      snapshot={{ ...snapshot }}
      preferences={preferences}
      streaming={{ hub: fixture.url, streams }}
      disabled={false}
      onControl={() => {
        throw new Error('Unexpected fixture device command.');
      }}
      onClose={() => void window.close()}
    />
  );
}

window.mount(
  <HausUiProvider
    contentHost={GPUIX_CONTENT_HOST}
    mode="dark"
    reducedTransparency={process.argv.includes('--reduced-transparency')}
  >
    <Fixture />
  </HausUiProvider>,
  async () => {
    await streams.close();
    await fixture.close();
  },
);

let exit = 0;
try {
  const app = new App(new InProcessBackend(liveRendererAsTest(window.renderer)));
  await app.getByTestId(`stream-${camera}`).waitFor({ timeoutMs: 5000 });
  const deadline = performance.now() + 12_000;
  while (await app.getByText('CONNECTING').count()) {
    assert(performance.now() < deadline, 'Camera did not start while the Home snapshot updated.');
    await delay(50);
  }
  await delay(170);
  const firstUpdate = updates;
  const started = performance.now();
  const firstFrame = presentedFrames;
  await delay(1500);
  const frameRate = ((presentedFrames - firstFrame) * 1000) / (performance.now() - started);
  console.log(
    `Camera modal uploaded ${frameRate.toFixed(1)} frames per second during Home updates.`,
  );
  assert(
    frameRate >= 15,
    `Native playback fell to ${frameRate.toFixed(1)} frame uploads per second.`,
  );
  const frames = new Set<string>();
  for (let index = 0; index < 3; index++) {
    const path = join(directory, `modal-${index}.png`);
    window.renderer.captureScreenshot(path);
    const screenshot = sharp(path);
    const { width, height } = await screenshot.metadata();
    const region = await screenshot
      .extract({
        left: Math.floor(width * 0.22),
        top: Math.floor(height * 0.32),
        width: Math.floor(width * 0.56),
        height: Math.floor(height * 0.32),
      })
      .removeAlpha()
      .raw()
      .toBuffer();
    assert(
      region.some((value) => value > 180),
      'The live image disappeared while the modal remained open.',
    );
    frames.add(createHash('sha256').update(region).digest('hex'));
    await delay(110);
  }
  assert(updates - firstUpdate >= 4, 'The fixture did not update Home during playback.');
  assert.equal(frames.size, 3, 'One or more of the three captured frames stopped advancing.');
  assert.equal(fixture.activeLeasesTaken(), 1, 'Refreshing Home reopened the camera stream.');
  await window.close();
  assert.equal(await closed.promise, 0);
  assert(fixture.verified(), 'Closing the modal did not release the camera lease.');
  console.log(
    `Camera modal painted ${frames.size} changing frames with one lease. Captures at ${directory}.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  exit = 1;
} finally {
  await window.close();
  process.exit(exit);
}
