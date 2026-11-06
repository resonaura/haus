/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

// Headless component QA only: no native Haus window, account, or desktop capture.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from '@playwright/test';
import { loadYuzuOSTrafficLights } from '../src/main/yuzuos-appearance.ts';

const source = resolve(process.argv[2] || '../gnome');
const { buildTrafficLights } = await import(
  pathToFileURL(join(source, 'extension/build-traffic-lights.mjs'))
);
const temporary = await mkdtemp(join(tmpdir(), 'haus-yuzuos-browser-'));
const revision = '1'.repeat(24),
  runtime = join(temporary, 'runtime', revision);
await mkdir(join(runtime, 'appearance/templates'), { recursive: true });
await mkdir(join(runtime, 'app-styles'));
await buildTrafficLights(source, runtime);
const capabilities = {
  version: 1,
  uuid: 'yuzuos@resonaura.local',
  revision,
  applicationBlur: { enabled: true },
  trafficLights: {
    enabled: true,
    style: 'glass',
    artworkDirectory: join(runtime, 'icons/titlebuttons-native'),
  },
};
const fixture = {
  name: 'yuzuos-traffic-fixture',
  configureServer(server) {
    server.middlewares.use('/__yuzuos_traffic_fixture__.html', async (req, res, next) => {
      try {
        const html = await server.transformIndexHtml(
          '/__yuzuos_traffic_fixture__.html',
          `<!doctype html><html class="native-electron native-linux"><head><style>body{margin:0;min-height:100vh;background:#3c3c3c}</style></head><body><div id="root"></div><script type="module">import React from 'react';import{createRoot}from'react-dom/client';import{WindowControls}from'/src/renderer/src/app/shell/WindowControls.tsx';import'/src/renderer/src/styles/window-chrome.scss';createRoot(document.getElementById('root')).render(React.createElement(WindowControls));</script></body></html>`,
        );
        res.setHeader('Content-Type', 'text/html');
        res.end(html);
      } catch (error) {
        next(error);
      }
    });
  },
};
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  plugins: [fixture, react()],
  server: { host: '127.0.0.1', port: 0 },
  logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.MENUBAR_BROWSER_PATH ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const reports = [];
try {
  const address = server.httpServer.address();
  for (const colorScheme of ['light', 'dark'])
    for (const deviceScaleFactor of [1, 5 / 3, 2]) {
      const renderScale = Number((2 / deviceScaleFactor).toFixed(4));
      const artwork = await loadYuzuOSTrafficLights(
        { ...capabilities, trafficLights: { ...capabilities.trafficLights, renderScale } },
        [temporary],
      );
      assert.ok(artwork);
      const context = await browser.newContext({
          colorScheme,
          deviceScaleFactor,
          viewport: { width: 240, height: 100 },
        }),
        page = await context.newPage(),
        errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript((art) => {
        window.fixtureChrome = {
          platform: 'linux',
          controls: 'traffic-left',
          maximized: false,
          fullscreen: false,
          focused: true,
          trafficLights: art,
        };
        window.fixtureCalls = [];
        window.hausNative = {
          getWindowChrome: async () => window.fixtureChrome,
          onEvent: (callback) => {
            window.fixtureUpdate = (state) => {
              window.fixtureChrome = { ...window.fixtureChrome, ...state };
              callback({ type: 'window', state: window.fixtureChrome });
            };
            return () => {};
          },
          windowAction: async (action) => window.fixtureCalls.push(action),
        };
      }, artwork);
      await page.goto(`http://127.0.0.1:${address.port}/__yuzuos_traffic_fixture__.html`);
      await page.locator('.has-native-artwork').waitFor();
      const button = page.locator('.window-control.is-close');
      const state = async (phase) => {
        const data = await button.evaluate((element) => ({
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
          image: getComputedStyle(element).backgroundImage,
          gap: getComputedStyle(element.parentElement).gap,
        }));
        const payload = artwork.images[colorScheme].close[phase].match(
          /data:image\/png;base64,([^" ]+)/,
        )[1];
        assert.ok(data.image.includes(payload), `Wrong ${colorScheme} native ${phase} artwork`);
        assert.ok(Math.abs(data.width * deviceScaleFactor - 28) < 0.04);
        assert.ok(Math.abs(data.height * deviceScaleFactor - 28) < 0.04);
        assert.ok(Math.abs((data.width + parseFloat(data.gap)) * deviceScaleFactor - 46) < 0.04);
        return createHash('sha256')
          .update(await page.screenshot())
          .digest('hex');
      };
      const idle = await state('active');
      await page.locator('.has-native-artwork').hover();
      const hover = await state('hover');
      assert.notEqual(idle, hover);
      await page.mouse.move(220, 90);
      await page.evaluate(() => window.fixtureUpdate({ focused: false }));
      await page.waitForFunction(() => document.documentElement.dataset.windowFocused === 'false');
      const inactive = await state('inactive');
      assert.notEqual(idle, inactive);
      await button.hover();
      await page.mouse.down();
      await state('pressed');
      await page.mouse.up();
      await page.locator('.window-control.is-minimize').click();
      await page.locator('.window-control.is-maximize').click();
      assert.deepEqual(await page.evaluate(() => window.fixtureCalls), [
        'close',
        'minimize',
        'maximize',
      ]);
      await page.evaluate(() => window.fixtureUpdate({ trafficLights: undefined }));
      await page.locator('.has-native-artwork').waitFor({ state: 'detached' });
      assert.equal(await button.evaluate((element) => element.getBoundingClientRect().width), 13);
      await page.evaluate(() =>
        window.fixtureUpdate({ platform: 'darwin', controls: 'native-left' }),
      );
      await page.locator('.window-controls').waitFor({ state: 'detached' });
      assert.deepEqual(errors, []);
      reports.push({
        colorScheme,
        deviceScaleFactor,
        nativeSize: [artwork.width, artwork.height],
        gap: artwork.gap,
        idle,
        hover,
        inactive,
        actionsPreserved: true,
        fallbackPreserved: true,
        nativeMacControlsPreserved: true,
      });
      await context.close();
    }
  await writeFile(
    join(source, 'test-results/haus-native-traffic-browser.json'),
    JSON.stringify({ passed: true, reports }, null, 2) + '\n',
  );
  console.log(JSON.stringify({ passed: true, cases: reports.length }));
} finally {
  await browser.close();
  await server.close();
  await rm(temporary, { recursive: true, force: true });
}
