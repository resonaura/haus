/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, copyFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { launch } from '@gpuix/react/automation';
import { sidebarWidths } from '@haus/ui/components';
import { demoLamp } from '../../src/gpui/preview.js';
import { requireGpuiBun } from '../../src/gpui/bun.js';

requireGpuiBun();
const [input, screenshot] = process.argv.slice(2);
assert(input, 'Supply a compiled Haus GPUIX executable and optionally a screenshot path.');

const directory = await mkdtemp(join(tmpdir(), 'haus-gpui-packed-'));
const binary = join(directory, process.platform === 'win32' ? 'Haus.exe' : 'Haus');
const env: NodeJS.ProcessEnv = {
  ...process.env,
  GPUIX_BACKGROUND: '1',
  GPUIX_TERMINAL: '0',
  NAPI_RS_NATIVE_LIBRARY_PATH: '',
  NODE_PATH: '',
  NODE_OPTIONS: '',
};

try {
  await copyFile(resolve(input), binary);
  await chmod(binary, 0o755);
  const { stdout } = await promisify(execFile)(binary, ['--check-native'], {
    cwd: directory,
    env,
    timeout: 10_000,
  });
  assert.equal(stdout.trim(), `Haus GPUIX native ${process.platform}/${process.arch}`);
  console.log(
    `Standalone executable loaded its native addon on ${process.platform}/${process.arch}.`,
  );

  if (screenshot) {
    const app = await launch({ command: binary, cwd: directory, env });
    let checking = 'the Home overview';
    try {
      await app.getByText('Welcome home.').waitFor({ timeoutMs: 10_000 });
      const output = resolve(screenshot);
      await app.screenshot({ path: output });
      assert((await stat(output)).size > 0, 'The standalone window did not produce a screenshot.');
      checking = 'the camera preview tile';
      await app.getByTestId('preview-camera.front_door').click();
      await app.getByTestId('camera-modal-tabs').waitFor({ timeoutMs: 5000 });
      await app.getByTestId('dialog-panel').getByText('Front door').waitFor({ timeoutMs: 5000 });
      await app.getByTestId('dialog-close').click();
      await app.getByText('Welcome home.').waitFor({ timeoutMs: 5000 });
      checking = 'the Home scene';
      const away = app.getByTestId('scene-scene.away');
      await away.getByText('Away').waitFor({ timeoutMs: 5000 });
      await away.click();
      checking = 'the demo lamp after applying Away';
      await app.getByTestId('sidebar-category:lights').click();
      const lamp = app.getByTestId(`device-${demoLamp}`);
      await lamp.getByText('Corner lamp').waitFor({ timeoutMs: 5000 });
      await lamp.getByText('Off').waitFor({ timeoutMs: 5000 });
      checking = 'the demo lamp quick control';
      await app.getByTestId(`device-${demoLamp}-quick`).click();
      await lamp.getByText('60% brightness').waitFor({ timeoutMs: 5000 });
      const sidebar = app.getByTestId('sidebar');
      const toggle = app.getByTestId('sidebar-toggle');
      const expanded = (await sidebar.bounds()).width;
      assert([215, sidebarWidths.expanded].includes(expanded));
      checking = 'sidebar navigation and collapse';
      await app.getByTestId('sidebar-scenes').click();
      await app.getByTestId('desktop-page-title').getByText('Scenes').waitFor({ timeoutMs: 5000 });
      const movie = app.getByTestId('scene-group-living_room').getByTestId('scene-scene.movie_time');
      await movie.getByText('Movie time').waitFor({ timeoutMs: 5000 });
      await movie.getByType('img').waitFor({ timeoutMs: 5000 });
      await toggle.click();
      assert.equal((await sidebar.bounds()).width, sidebarWidths.compact);
      await app.getByTestId('sidebar-home').click();
      await app.getByText('Welcome home.').waitFor({ timeoutMs: 5000 });
      await toggle.click();
      assert.equal((await sidebar.bounds()).width, expanded);
      checking = 'appearance settings';
      await app.getByTestId('home-settings').click();
      await app.getByTestId('theme-light').waitFor({ timeoutMs: 5000 });
      await app.getByTestId('theme-light').click();
      await app.getByTestId('theme-dark').click();
      checking = 'the room list';
      await sidebar.wheel(0, -1200);
      await app.getByTestId('sidebar-rooms').click();
      await app.getByTestId('create-room').waitFor({ timeoutMs: 5000 });
      checking = 'the room name editor';
      await app.getByTestId('create-room').click();
      await app.getByTestId('room-name').waitFor({ timeoutMs: 5000 });
      await app.getByTestId('room-name').fill('Fixture reading room');
      await app.getByTestId('room-save').click();
      await app
        .getByTestId('desktop-page-title')
        .getByText('Fixture reading room')
        .waitFor({ timeoutMs: 5000 });
      console.log(
        `Standalone native window rendered and accepted input. Screenshot saved to ${output}.`,
      );
    } catch (cause) {
      throw new Error(`The standalone window check failed while verifying ${checking}.`, { cause });
    } finally {
      await app.close();
    }
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
