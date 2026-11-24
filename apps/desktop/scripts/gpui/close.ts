/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { appKitBridge, findAppKitWindow } from '../../src/platform/appkit.js';

/** Click the standard close control of this process's test window without focusing it. */
export async function closeMacFixtureWindow(title: string): Promise<void> {
  const bridge = appKitBridge(await import('koffi'));
  const window = findAppKitWindow(bridge, title);
  if (!window) throw new Error('The AppKit fixture window could not be found.');
  bridge.object(window, 'performClose:', null);
}
