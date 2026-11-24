/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { App, InProcessBackend, liveRendererAsTest } from '@gpuix/react/automation';
import { MediaRuntime } from '@haus/media/pipeline';
import { CompactDashboard, sidebarWidths } from '@haus/ui/components';
import { GPUIX_CONTENT_HOST } from '@haus/ui/gpui';
import { colorToken, pct, px, SolidMaterial } from '@haus/ui/ir';
import { HausUiProvider, Text, VideoSurface } from '@haus/ui/primitives';
import { useState } from 'react';
import { GpuiCameraStreams } from '../../src/gpui/camera/stream.js';
import { DesktopShell, type HomeRoute } from '../../src/gpui/shell.js';
import { GpuiWindow } from '../../src/gpui/window.js';
import { captureMovingFrames } from './capture.js';
import { closeMacFixtureWindow } from './close.js';
import { camera, openCameraFixture } from './fixture.js';

const [input, output] = process.argv.slice(2);
assert(input && output, 'Provide a local HLS fixture directory and a screenshot directory.');
const recover = process.argv.includes('--recover');
const directory = resolve(output);
await mkdir(directory, { recursive: true });
const fixture = await openCameraFixture(resolve(input), { stallFirst: recover });

const title = 'Haus · HLS playback';
const closed = Promise.withResolvers<number>();
const window = new GpuiWindow(
  {
    title,
    width: 700,
    height: 450,
    focus: false,
    windowBackground: process.platform === 'darwin' ? 'transparent' : 'opaque',
  },
  closed.resolve,
);
const streams = new GpuiCameraStreams(new MediaRuntime(), fixture.viewer);
const firstFrame = Promise.withResolvers<void>();
const recoveredFrame = Promise.withResolvers<void>();
const statuses: string[] = [];
let stoppedBeforeCapture = false;
const videoHeight = 360;

function VideoFixture() {
  const [route, setRoute] = useState<HomeRoute>('home');
  return (
    <DesktopShell route={route} onSelect={setRoute} sidebar={window.sidebar}>
      {route === 'home' ? (
        <CompactDashboard title="Home">
          <Text tone="secondary">Select Cameras to open the fixture.</Text>
        </CompactDashboard>
      ) : (
        <CompactDashboard title="HLS playback">
          <VideoSurface
            id="fixture-video"
            frameSource={(signal) =>
              streams.open(fixture.url, camera, signal, (status) => {
                statuses.push(status);
                if (status === 'playing' && statuses.includes('reconnecting'))
                  recoveredFrame.resolve();
              })
            }
            style={{
              layout: { width: pct(100), height: px(videoHeight) },
              material: new SolidMaterial(colorToken('surface')),
            }}
            onPlaying={() => firstFrame.resolve()}
            onEnded={() => {
              stoppedBeforeCapture = true;
            }}
            onError={() => {
              stoppedBeforeCapture = true;
              firstFrame.reject(new Error('GPUIX could not paint the HLS fixture.'));
            }}
          />
        </CompactDashboard>
      )}
    </DesktopShell>
  );
}

window.mount(
  <HausUiProvider contentHost={GPUIX_CONTENT_HOST} mode="dark">
    <VideoFixture />
  </HausUiProvider>,
  async () => {
    await streams.close();
    await fixture.close();
  },
);

let exit = 0;
try {
  const app = new App(new InProcessBackend(liveRendererAsTest(window.renderer)));
  const cameras = app.getByTestId('sidebar-cameras');
  await cameras.waitFor({ timeoutMs: 5000 });
  await cameras.click();
  const video = app.getByTestId('fixture-video');
  await video.waitFor({ timeoutMs: 5000 });
  const bounds = await video.bounds();
  assert(bounds.x > sidebarWidths.expanded && bounds.width > 0 && bounds.height > 0);
  await Promise.race([
    firstFrame.promise,
    delay(12_000).then(() => {
      throw new Error('Timed out waiting for an HLS frame.');
    }),
  ]);
  const assertPlaying = () => assert(!stoppedBeforeCapture, 'Playback stopped during capture.');
  await captureMovingFrames(
    window.renderer,
    join(directory, 'first.png'),
    join(directory, 'second.png'),
    assertPlaying,
  );
  console.log(`Captured changing HLS frames in ${directory}`);
  if (recover) {
    await Promise.race([
      recoveredFrame.promise,
      delay(16_000).then(() => {
        throw new Error('The stalled camera stream did not recover.');
      }),
    ]);
    assert.deepEqual(statuses, ['playing', 'reconnecting', 'playing']);
    await captureMovingFrames(
      window.renderer,
      join(directory, 'recovered-first.png'),
      join(directory, 'recovered-second.png'),
      assertPlaying,
    );
    console.log('A stalled HLS stream recovered in the same window.');
  }
  if (process.platform === 'darwin') await closeMacFixtureWindow(title);
  else await window.close();
  const code = await Promise.race([
    closed.promise,
    delay(10_000).then(() => {
      throw new Error('The desktop shutdown did not finish.');
    }),
  ]);
  assert.equal(code, 0);
  assert(
    fixture.verified(),
    'The requested playback did not release its authenticated warm lease.',
  );
  console.log('Desktop shutdown released its camera stream.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'The live GPUIX video check failed.');
  exit = 1;
} finally {
  await window.close();
  process.exit(exit);
}
