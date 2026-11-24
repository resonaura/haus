/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { App, InProcessBackend, liveRendererAsTest } from '@gpuix/react/automation';
import { MediaRuntime } from '@haus/media/pipeline';
import { CompactDashboard, sidebarWidths } from '@haus/ui/components';
import { GPUIX_CONTENT_HOST } from '@haus/ui/gpui';
import { HausUiProvider, Text } from '@haus/ui/primitives';
import { useState } from 'react';
import { GpuiCameraStreams } from '../../src/gpui/camera/stream.js';
import { CameraSection } from '../../src/gpui/camera/viewer.js';
import { DesktopShell, type HomeRoute } from '../../src/gpui/shell.js';
import { GpuiWindow } from '../../src/gpui/window.js';
import { captureMovingFrames } from './capture.js';
import { closeMacFixtureWindow } from './close.js';
import { camera, openCameraFixture } from './fixture.js';

const [input, output] = process.argv.slice(2);
assert(input && output, 'Provide a local HLS fixture directory and a screenshot directory.');
const directory = resolve(output);
await mkdir(directory, { recursive: true });
const fixture = await openCameraFixture(resolve(input), { holdFirstRelease: true });
const title = 'Haus · Camera reopening';
const closed = Promise.withResolvers<number>();
const window = new GpuiWindow(
  {
    title,
    width: 720,
    height: 620,
    focus: false,
    windowBackground: process.platform === 'darwin' ? 'transparent' : 'opaque',
  },
  closed.resolve,
);
const streams = new GpuiCameraStreams(new MediaRuntime(), fixture.viewer);

function CameraFixture() {
  const [route, setRoute] = useState<HomeRoute>('home');
  return (
    <DesktopShell route={route} onSelect={setRoute} sidebar={window.sidebar}>
      {route === 'home' ? (
        <CompactDashboard title="Home">
          <Text tone="secondary">Select Cameras to open the fixture.</Text>
        </CompactDashboard>
      ) : (
        <CompactDashboard title="Camera reopening">
          <CameraSection
            hub={fixture.url}
            cameras={[{ id: camera, name: 'Fixture camera', available: true }]}
            streams={streams}
          />
        </CompactDashboard>
      )}
    </DesktopShell>
  );
}

window.mount(
  <HausUiProvider contentHost={GPUIX_CONTENT_HOST} mode="dark">
    <CameraFixture />
  </HausUiProvider>,
  async () => {
    fixture.allowRelease();
    await streams.close();
    await fixture.close();
  },
);

const app = new App(new InProcessBackend(liveRendererAsTest(window.renderer)));
const video = app.getByTestId(`stream-${camera}`);
const connecting = app.getByText('Connecting to the camera…');

async function openCamera() {
  const cameras = app.getByTestId('sidebar-cameras');
  await cameras.waitFor({ timeoutMs: 5000 });
  await cameras.click();
  const tile = app.getByTestId(`camera-${camera}-details`);
  await tile.waitFor({ timeoutMs: 5000 });
  await tile.click();
  await video.waitFor({ timeoutMs: 5000 });
  const bounds = await video.bounds();
  assert(bounds.x > sidebarWidths.expanded && bounds.width > 0 && bounds.height > 0);
}

async function capturePlayback(name: string) {
  const deadline = performance.now() + 10_000;
  const reconnecting = app.getByText('Reconnecting to the camera…');
  while ((await connecting.count()) || (await reconnecting.count())) {
    assert(performance.now() < deadline, 'The camera did not start playing.');
    await delay(50);
  }
  const stopped = app.getByText('Live playback stopped.');
  assert.equal(await stopped.count(), 0, 'Playback stopped before capture.');
  await captureMovingFrames(
    window.renderer,
    join(directory, `${name}.png`),
    join(directory, `${name}-next.png`),
    async () => {
      assert.equal(await stopped.count(), 0, 'Playback stopped during capture.');
    },
  );
}

let exit = 0;
try {
  await openCamera();
  await capturePlayback('before-reopen');
  await app.getByTestId('sidebar-home').click();
  await app.getByText('Select Cameras to open the fixture.').waitFor({ timeoutMs: 5000 });
  await Promise.race([
    fixture.firstRelease,
    delay(4000, undefined, { ref: false }).then(() => {
      throw new Error('Leaving the route did not release the old camera lease.');
    }),
  ]);
  await openCamera();
  await connecting.waitFor({ timeoutMs: 5000 });
  await delay(200);
  assert.equal(fixture.activationRequests(), 1, 'The new view tried to warm too early.');
  fixture.allowRelease();
  await capturePlayback('after-reopen');
  assert.equal(fixture.activationRequests(), 2);
  console.log('Camera playback reopened after the previous lease was released.');

  if (process.platform === 'darwin') await closeMacFixtureWindow(title);
  else await window.close();
  assert.equal(await closed.promise, 0);
  assert(fixture.verified(), 'Expected one warm owner at a time and both leases released.');
  console.log('Desktop shutdown released its camera stream.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'The GPUIX camera reopen check failed.');
  exit = 1;
} finally {
  await window.close();
  process.exit(exit);
}
