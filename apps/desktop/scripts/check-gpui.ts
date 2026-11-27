/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { createElement } from 'react';
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing';
import { GPUIX_CONTENT_HOST } from '@haus/ui/gpui';
import { HausUiProvider } from '@haus/ui/primitives';
import { demoLamp, Preview } from '../src/gpui/preview.js';
import { macPerformer } from '../src/platform/haptics.js';
import type { HapticPattern } from '../src/shared/native.js';

assert(hasNativeTestRenderer, 'GPUIX needs a native test renderer for this check');
if (process.platform === 'darwin') {
  assert.equal(typeof macPerformer(await import('koffi')), 'function');
}

const { renderer, render, unmount } = createTestRoot({ width: 1120, height: 880 });
const feedback: HapticPattern[] = [];

function click(id: string, button = 0) {
  const element = renderer.findByTestId(id);
  assert(element, `Missing ${id}`);
  let bounds = renderer.getElementBounds(element.id);
  for (
    let attempt = 0;
    attempt < 5 && bounds && (bounds.y < 80 || bounds.y + bounds.height > 700);
    attempt += 1
  ) {
    const scrollX = bounds.x + Math.max(24, bounds.width / 2);
    renderer.nativeSimulateScrollWheel(scrollX, 180, 0, -(bounds.y - 360));
    renderer.dispatchNativeEvents();
    renderer.flush();
    bounds = renderer.getElementBounds(element.id);
  }
  assert(bounds && bounds.width > 0 && bounds.height > 0, `Missing bounds for ${id}`);
  const x = button === 2 ? bounds.x + Math.min(24, bounds.width / 4) : bounds.x + bounds.width / 2;
  const y =
    button === 2 ? bounds.y + Math.min(24, bounds.height / 4) : bounds.y + bounds.height / 2;
  renderer.nativeSimulateClick(x, y, button);
  renderer.dispatchNativeEvents();
  renderer.flush();
  renderer.clockFastForward(240);
  renderer.flush();
}

async function settleDialogExit() {
  await new Promise((resolve) => setTimeout(resolve, 180));
  renderer.clockFastForward(240);
  renderer.dispatchNativeEvents();
  renderer.flush();
}

try {
  render(
    createElement(HausUiProvider, {
      contentHost: GPUIX_CONTENT_HOST,
      mode: 'dark',
      children: createElement(Preview, {
        platform: {
          hapticFeedback(pattern) {
            feedback.push(pattern);
            return true;
          },
        },
      }),
    }),
  );
  renderer.flush();
  assert(renderer.getAllText().includes('Welcome home.'));
  assert(renderer.findByType('svg').length >= 5);

  // Camera modal: Live preview -> Events sheet + recording selection -> Floating Settings drawer -> Close
  click('preview-camera.living_room');
  assert(renderer.findByTestId('dialog-panel'), 'Camera modal dialog should open');
  assert(renderer.findByTestId('camera-modal-tabs'), 'Camera modal tabs missing');
  assert(renderer.getAllText().some((t) => t.includes('DEMO · STILL IMAGE')));
  assert(renderer.findByTestId('camera-back-live'), 'Overlay timeline Live pill missing');
  const cameraLiveShot = process.argv[5];
  if (cameraLiveShot) renderer.captureScreenshot(cameraLiveShot);

  click('camera-view-events');
  assert(renderer.getAllText().some((t) => t.includes('History')));
  assert(renderer.getAllText().some((t) => t.includes('All events')));
  assert(renderer.getAllText().some((t) => t.includes('Person')));
  click('camera-event-demo-camera.living_room-0');
  const cameraEventsShot = process.argv[6];
  if (cameraEventsShot) renderer.captureScreenshot(cameraEventsShot);

  click('camera-settings-toggle');
  assert(renderer.getAllText().some((t) => t.includes('Camera settings')));
  assert(renderer.getAllText().some((t) => t.includes('Viewing & recording')));
  assert(renderer.getAllText().some((t) => t.includes('Hide from Home view')));
  const cameraSettingsShot = process.argv[7];
  if (cameraSettingsShot) renderer.captureScreenshot(cameraSettingsShot);

  click('dialog-close');
  assert(!renderer.findByTestId('dialog-panel'), 'Close button should close camera modal');

  click('sidebar-category:lights');
  click(`device-${demoLamp}-quick`);
  assert(renderer.getAllText().includes('Off'));
  assert.deepEqual(feedback, []);
  click(`device-${demoLamp}-details`);
  assert(renderer.getAllText().includes('Add to favorites'));
  const slider = renderer.findByTestId(`control-${demoLamp}-brightness-input`);
  assert(slider, 'Missing the native brightness control.');
  renderer.nativeSimulateKeystrokes(slider.id, 'right');
  renderer.dispatchNativeEvents();
  renderer.flush();
  assert(renderer.getAllText().includes('1%'));
  assert.deepEqual(feedback, ['alignment']);
  assert(renderer.findByTestId('dialog-panel'));
  click(`control-${demoLamp}-preset-0`);
  assert.equal(feedback.length, 1);
  const modalScreenshotArg = process.argv[4];
  if (modalScreenshotArg) renderer.captureScreenshot(modalScreenshotArg);
  click('device-detail-tabs-history');
  assert(renderer.getAllText().some((text) => text.includes('24 hours')));
  assert(renderer.getAllText().some((text) => text.includes('Low:')));
  click('device-detail-tabs-details');
  assert(renderer.getAllText().some((text) => text.includes('About this accessory')));
  assert(renderer.getAllText().some((text) => text.includes('light.corner_lamp')));
  click('device-detail-tabs-settings');
  assert(renderer.getAllText().some((text) => text.includes('Hide from Home view')));
  assert(renderer.getAllText().some((text) => text.includes('Save name')));
  click('device-detail-tabs-controls');
  const modalSlider = renderer.findByTestId(`control-${demoLamp}-brightness-input`);
  assert(modalSlider, 'Missing native brightness slider after returning to Controls tab.');
  renderer.nativeSimulateKeystrokes(modalSlider.id, 'escape');
  renderer.dispatchNativeEvents();
  renderer.flush();
  await settleDialogExit();
  assert(!renderer.findByTestId('dialog-panel'));

  // Right-click fallback ActionMenuDialog & submenu
  click(`device-${demoLamp}`, 2);
  assert(renderer.findByTestId('menu-item-move-room'), 'Missing context menu Move to Room');
  click('menu-item-move-room');
  assert(renderer.findByTestId('menu-back'), 'Missing submenu Back button');
  click('menu-item-move-room:living_room');
  assert(renderer.findByTestId('dialog-panel'), 'Current room item must remain disabled');
  click('menu-item-move-room:bedroom');
  await settleDialogExit();
  assert(!renderer.findByTestId('dialog-panel'));

  // Spotlight modal via topbar Search
  click('home-search');
  const searchInput = renderer.findByTestId('search-query');
  assert(searchInput, 'Missing Spotlight search input');
  assert(renderer.getAllText().includes('Search Haus'));
  renderer.writeToClipboard('Corner');
  renderer.nativeSimulateKeystrokes(searchInput.id, 'cmd-v');
  renderer.dispatchNativeEvents();
  renderer.flush();
  click(`spotlight-device-${demoLamp}`);
  assert(renderer.findByTestId('dialog-panel'), 'Spotlight selection should open device details');
  renderer.nativeSimulateKeystrokes(renderer.findByTestId('dialog-panel')!.id, 'escape');
  renderer.dispatchNativeEvents();
  renderer.flush();
  await settleDialogExit();

  // Attention alerts feed
  click('home-attention');
  assert(renderer.getAllText().includes('Bedroom sensor battery is low'));

  // Scenes library + Scene Details modal
  click('sidebar-scenes');
  assert(renderer.getAllText().includes('A different feeling. One tap away.'));
  assert(renderer.getAllText().includes('Create scene'));
  const scenesShot = process.argv[8];
  if (scenesShot) renderer.captureScreenshot(scenesShot);
  click('scene-scene.away-options');
  click('menu-item-details');
  assert(renderer.getAllText().some((text) => text.includes('SCENE DETAILS')));
  const sceneDetailsShot = process.argv[9];
  if (sceneDetailsShot) renderer.captureScreenshot(sceneDetailsShot);
  click('dialog-close');
  await settleDialogExit();
  assert(!renderer.findByTestId('dialog-panel'));

  // Automations gallery + dedicated New automation visual flow screen
  click('sidebar-automations');
  assert(renderer.getAllText().includes('Create automation'));
  assert(renderer.getAllText().includes('Switch Press'));
  assert(renderer.getAllText().includes('Good Morning'));
  const automationsShot = process.argv[10];
  if (automationsShot) renderer.captureScreenshot(automationsShot);
  click('automations-create');
  assert(!renderer.findByTestId('dialog-panel'), 'Automation editor should open as a dedicated screen, not a modal');
  assert(renderer.getAllText().includes('New automation'));
  assert(renderer.getAllText().includes('Switch / Button'));
  assert(renderer.getAllText().includes('WHEN'));
  click('automation-editor-back');
  renderer.clockFastForward(260);
  renderer.flush();
  assert(renderer.getAllText().includes('Create automation'));

  // Servers overview + detail + interactive terminal
  click('sidebar-servers');
  assert(renderer.getAllText().includes('Utility'));
  assert(renderer.getAllText().includes('Willow Hub'));
  assert(renderer.getAllText().includes('Garage NVR Node'));
  const serversShot = process.argv[17];
  if (serversShot) renderer.captureScreenshot(serversShot);
  click('server-card-haus-hub-main');
  renderer.clockFastForward(360);
  renderer.flush();
  assert(renderer.getAllText().includes('Disks'));
  assert(renderer.getAllText().includes('Services'));
  assert(renderer.getAllText().includes('Terminal'));
  click('server-tab-terminal');
  assert(renderer.findByTestId('server-terminal-xterm'), 'Missing native xterm terminal');
  const serverDetailShot = process.argv[18];
  if (serverDetailShot) renderer.captureScreenshot(serverDetailShot);
  click('server-detail-back');
  renderer.clockFastForward(360);
  renderer.flush();

  // Room detail + category bar filter
  click('sidebar-room:living_room');
  assert(renderer.findByTestId('room-cat-all'));
  assert(renderer.findByTestId('room-cat-lights'));
  click('room-cat-lights');
  const roomDetailShot = process.argv[12];
  if (roomDetailShot) renderer.captureScreenshot(roomDetailShot);
  click('room-cat-all');

  // Rooms manager
  click('sidebar-rooms');
  assert(renderer.getAllText().includes('New room'));
  assert(renderer.getAllText().includes('Living Room'));
  assert(renderer.getAllText().includes('Bedroom'));
  assert(renderer.getAllText().includes('Kitchen'));
  const roomsShot = process.argv[11];
  if (roomsShot) renderer.captureScreenshot(roomsShot);

  // Devices inventory + selection mode toggle
  click('sidebar-devices');
  assert(renderer.getAllText().includes('registered devices'));
  assert(renderer.getAllText().includes('DEVICE'));
  assert(renderer.getAllText().includes('DATA STATUS'));
  click('inventory-toggle-select');
  assert(renderer.getAllText().includes('Cancel selection'));
  const devicesShot = process.argv[13];
  if (devicesShot) renderer.captureScreenshot(devicesShot);
  click('inventory-toggle-select');

  // Integrations + Repairs + Add Device Commissioning + ConfigFlow
  click('sidebar-integrations');
  assert(renderer.getAllText().includes('Everything speaks the same language.'));
  click('integrations-open-repairs');
  assert(renderer.getAllText().includes('Repairs'));
  click('repairs-back');
  const integrationsShot = process.argv[15];
  if (integrationsShot) renderer.captureScreenshot(integrationsShot);

  click('integrations-add-device');
  assert(renderer.getAllText().includes('What are we adding?'));
  assert(renderer.getAllText().includes('Philips Hue Bridge'));
  const addDeviceShot = process.argv[19];
  if (addDeviceShot) renderer.captureScreenshot(addDeviceShot);
  click('add-device-path-code');
  assert(renderer.getAllText().includes('Add device with setup code'));
  click('commissioning-demo-pin');
  assert(renderer.getAllText().includes('HomeKit Setup PIN'));
  click('commissioning-start');
  assert(renderer.getAllText().includes('Device ready'));
  click('commissioning-finish');
  await settleDialogExit();
  assert(!renderer.findByTestId('dialog-panel'));

  click('integrations-add-device');
  click('add-device-discovered-demo-flow-hue');
  assert(renderer.getAllText().includes('Philips Hue'));
  const configFlowShot = process.argv[20];
  if (configFlowShot) renderer.captureScreenshot(configFlowShot);
  click('flow-submit');
  assert(renderer.getAllText().some((t) => t.includes('Connected Philips Hue')));
  click('flow-done');
  await settleDialogExit();
  assert(!renderer.findByTestId('dialog-panel'));

  // Apps + Catalog tab toggle
  click('sidebar-addons');
  assert(renderer.getAllText().includes('The services behind your home.'));
  click('apps-tab-catalog');
  assert(renderer.getAllText().includes('More possibilities for your home.'));
  click('apps-tab-installed');
  const appsShot = process.argv[16];
  if (appsShot) renderer.captureScreenshot(appsShot);

  // Hidden items view
  click('sidebar-hidden');
  assert(renderer.getAllText().includes('Evening Relaxation Scene Switch'));
  assert(
    renderer.getAllText().some((text) => text.includes('Restore Evening Relaxation Scene Switch')),
  );
  const hiddenShot = process.argv[14];
  if (hiddenShot) renderer.captureScreenshot(hiddenShot);

  click('sidebar-settings');
  click('theme-light');
  const lightScreenshotArg = process.argv[3];
  if (lightScreenshotArg) renderer.captureScreenshot(lightScreenshotArg);
  click('group-lights');
  click('icon-appearance-tinted');
  assert(renderer.getAllText().includes('Tint color'));
  click('liquid-glass-advanced');
  assert(renderer.getAllText().includes('Refraction strength'));
  assert(renderer.findByTestId('liquid-glass-recipe'));
  assert(renderer.getAllText().includes('Appearance'));

  // Hotkey-triggered Component Storyboard (Console + Haus ASCII logo + ANSI palette)
  const rootSearchBtn = renderer.findByTestId('home-search');
  assert(rootSearchBtn, 'Missing topbar search trigger for Storyboard shortcut test');
  renderer.nativeSimulateKeystrokes(rootSearchBtn.id, 'cmd-shift-u');
  renderer.dispatchNativeEvents();
  renderer.flush();
  assert(renderer.findByTestId('haus-component-storyboard'), 'Storyboard should open on cmd-shift-u');
  assert(renderer.findByTestId('storyboard-ascii-logo'), 'Storyboard must include Haus ASCII logo');
  assert(renderer.findByTestId('storyboard-ansi-palette'), 'Storyboard must include ANSI palette');
  assert(renderer.getAllText().some((t) => t.includes('hausfetch')));
  click('storyboard-close');
  assert(!renderer.findByTestId('haus-component-storyboard'), 'Storyboard should close cleanly');

  const screenshotArg = process.argv[2];
  if (screenshotArg) renderer.captureScreenshot(screenshotArg);
  console.log('GPUIX card rendering, actions and haptic dispatch passed.');
} finally {
  unmount();
}
