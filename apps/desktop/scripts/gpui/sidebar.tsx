/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import * as koffi from 'koffi';
import { sidebarWidths } from '@haus/ui/components';
import { GPUIX_CONTENT_HOST } from '@haus/ui/gpui';
import { HausUiProvider } from '@haus/ui/primitives';
import { Preview } from '../../src/gpui/preview.js';
import { GpuiWindow } from '../../src/gpui/window.js';
import { appKitBridge, findAppKitWindow } from '../../src/platform/appkit.js';
import { AppKitSidebar } from '../../src/platform/sidebar.js';
import { closeMacFixtureWindow } from './close.js';

assert.equal(process.platform, 'darwin', 'AppKit sidebar verification requires macOS.');
const title = 'Haus · Sidebar fixture';
const closed = Promise.withResolvers<number>();
const window = new GpuiWindow(
  {
    title,
    width: 720,
    height: 580,
    focus: false,
    windowBackground: 'transparent',
    titlebarTransparent: true,
    trafficLightX: 14,
    trafficLightY: 16,
  },
  closed.resolve,
);
assert(window.sidebar);
const bridge = appKitBridge(koffi);
const glassClass = bridge.klass('NSGlassEffectView');
const vibrancyClass = bridge.klass('NSVisualEffectView');
const defaultClass = glassClass ?? vibrancyClass;
const appKitWindow = findAppKitWindow(bridge, title);
assert(appKitWindow, 'GPUIX did not create an AppKit window.');
assert.equal(bridge.readFlag(appKitWindow, 'isOpaque'), false);
assert.equal(bridge.readFlag(appKitWindow, 'titlebarAppearsTransparent'), true);
const root = bridge.id(bridge.id(appKitWindow, 'contentView'), 'retain');
assert(root);

let reduceTransparency = false;
const vibrancy = new AppKitSidebar(
  {
    ...bridge,
    klass: (name) => (name === 'NSGlassEffectView' ? null : bridge.klass(name)),
    readFlag: (object, name) =>
      name === 'accessibilityDisplayShouldReduceTransparency'
        ? reduceTransparency
        : bridge.readFlag(object, name),
  },
  title,
);

function verifyAttachedMaterial(expectedClass: bigint | null, width: number, dark: boolean) {
  const [effect] = bridge.objects(bridge.id(root, 'subviews'));
  assert(effect, 'AppKit did not attach a sidebar effect behind the GPU content.');
  assert.equal(bridge.id(effect, 'class'), expectedClass);
  assert.equal(bridge.id(effect, 'superview'), root);
  assert.equal(bridge.id(effect, 'appearance'), bridge.appearance(dark));
  const bounds = bridge.bounds(effect);
  assert.equal(bounds.size.width, width);
  assert.equal(bounds.size.height, bridge.bounds(root).size.height);
}

function verifyDetached() {
  const children = [...bridge.objects(bridge.id(root, 'subviews'))];
  assert(
    children.every((view) => ![glassClass, vibrancyClass].includes(bridge.id(view, 'class'))),
    'The native sidebar effect remained attached.',
  );
}

let exit = 0;
try {
  const workspace = bridge.id(bridge.klass('NSWorkspace'), 'sharedWorkspace');
  window.mount(
    <HausUiProvider contentHost={GPUIX_CONTENT_HOST} mode="dark">
      <Preview platform={{}} sidebar={window.sidebar} />
    </HausUiProvider>,
  );
  if (bridge.readFlag(workspace, 'accessibilityDisplayShouldReduceTransparency')) {
    assert.equal(window.sidebar.getSnapshot(), false);
    verifyDetached();
  } else {
    assert(window.sidebar.getSnapshot());
    verifyAttachedMaterial(defaultClass, sidebarWidths.expanded, true);
  }
  window.sidebar.dispose();
  verifyDetached();

  vibrancy.update(sidebarWidths.expanded, true);
  verifyAttachedMaterial(vibrancyClass, sidebarWidths.expanded, true);
  vibrancy.update(sidebarWidths.compact, false);
  verifyAttachedMaterial(vibrancyClass, sidebarWidths.compact, false);

  // Resize only the local fixture window through AppKit.
  const objc = koffi.load('/usr/lib/libobjc.A.dylib');
  const selector = objc.func('void *sel_registerName(const char *name)');
  const size = koffi.struct({ width: 'double', height: 'double' });
  const resize = objc.func('objc_msgSend', 'void', ['void *', 'void *', size]);
  const height = bridge.bounds(root).size.height;
  resize(appKitWindow, selector('setContentSize:'), { width: 640, height: 460 });
  assert.notEqual(bridge.bounds(root).size.height, height);
  verifyAttachedMaterial(vibrancyClass, sidebarWidths.compact, false);

  reduceTransparency = true;
  await delay(500);
  assert.equal(vibrancy.getSnapshot(), false);
  verifyDetached();
  reduceTransparency = false;
  await delay(500);
  assert(vibrancy.getSnapshot());
  verifyAttachedMaterial(vibrancyClass, sidebarWidths.compact, false);
  vibrancy.dispose();

  if (!bridge.readFlag(workspace, 'accessibilityDisplayShouldReduceTransparency')) {
    window.sidebar.update(sidebarWidths.expanded, true);
    verifyAttachedMaterial(defaultClass, sidebarWidths.expanded, true);
  }
  await closeMacFixtureWindow(title);
  const code = await Promise.race([
    closed.promise,
    delay(5000, undefined, { ref: false }).then(() => {
      throw new Error('The sidebar fixture did not finish closing.');
    }),
  ]);
  assert.equal(code, 0);
  verifyDetached();
  console.log('Native AppKit sidebar attachment, vibrancy, resize, theme and cleanup passed.');
} catch (error) {
  console.error(error);
  exit = 1;
} finally {
  vibrancy.dispose();
  await window.close();
  bridge.send(root, 'release');
  process.exit(exit);
}
