/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createRequire } from 'node:module';
import type { BrowserWindow, WebContents } from 'electron';
import { sidebarLog } from './logging/logger';
import type { SidebarMaterial } from '../shared/native';
import { appKitBridge, type Pointer, type Rect } from '../platform/appkit';

export class NativeSidebarMaterial {
  private bridge: ReturnType<typeof appKitBridge> | undefined;
  private glass: Pointer = null;
  private root: Pointer = null;
  private readonly contents: WebContents;
  private width = 232;
  private failed = false;
  private disposed = false;
  readonly material: SidebarMaterial;

  constructor(
    private readonly window: BrowserWindow,
    theme: 'light' | 'dark',
  ) {
    this.contents = window.webContents;
    this.material = process.platform === 'darwin' ? 'vibrancy' : 'none';
    if (process.platform !== 'darwin') return;
    // Never load a native addon on unsupported systems.
    if (Number(process.getSystemVersion().split('.')[0]) < 26) return;
    try {
      const require = createRequire(import.meta.url);
      this.bridge = appKitBridge(require('koffi') as typeof import('koffi'));
      const glassClass = this.bridge.klass('NSGlassEffectView');
      if (!glassClass) return;
      this.root = this.bridge.pointer(window.getNativeWindowHandle());
      if (!this.root) return;
      this.glass = this.bridge.init(this.bridge.id(glassClass, 'alloc'), this.frame());
      if (!this.glass) return;
      this.bridge.integer(this.glass, 'setStyle:', 0); // NSGlassEffectViewStyleRegular
      this.bridge.double(this.glass, 'setCornerRadius:', 0);
      this.setTheme(theme);
      this.bridge.behind(this.root, this.glass);
      window.setVibrancy(null);
      window.setBackgroundColor('#00000000');
      this.material = 'liquid-glass';
      sidebarLog.info('Material active: NSGlassEffectView');
    } catch (error) {
      this.failed = true;
      this.removeGlass();
      window.setVibrancy('sidebar');
      sidebarLog.warn('Liquid Glass unavailable; using sidebar vibrancy', error);
    }
    window.on('resize', this.resize);
    this.contents.on('zoom-changed', this.resize);
    window.once('close', () => this.dispose());
    window.once('closed', () => this.dispose());
  }

  update(width: unknown): SidebarMaterial {
    if (typeof width !== 'number' || !Number.isFinite(width) || width < 0 || width > 400)
      throw new Error('Invalid sidebar width.');
    this.width = width;
    this.resize();
    return this.failed ? 'vibrancy' : this.material;
  }

  setTheme(theme: 'light' | 'dark'): void {
    if (this.glass && this.bridge) {
      this.bridge.object(this.glass, 'setAppearance:', this.bridge.appearance(theme === 'dark'));
      this.bridge.object(this.glass, 'setTintColor:', this.bridge.tint(theme === 'dark'));
    }
  }

  private frame(): Rect {
    const bounds = this.bridge!.bounds(this.root);
    return {
      origin: bounds.origin,
      size: {
        width: Math.min(bounds.size.width, this.width * this.contents.getZoomFactor()),
        height: bounds.size.height,
      },
    };
  }

  private resize = (): void => {
    if (
      !this.glass ||
      !this.bridge ||
      this.disposed ||
      this.window.isDestroyed() ||
      this.contents.isDestroyed?.()
    )
      return;
    try {
      // Hiding the material must also work while a renderer is being replaced.
      if (this.width > 0) this.bridge.frame(this.glass, this.frame());
      this.bridge.flag(this.glass, 'setHidden:', this.width === 0);
    } catch (error) {
      this.failed = true;
      this.removeGlass();
      this.window.setVibrancy('sidebar');
      sidebarLog.warn('Sidebar material fell back to vibrancy', error);
    }
  };

  private removeGlass(): void {
    if (!this.glass || !this.bridge) return;
    this.bridge.send(this.glass, 'removeFromSuperview');
    this.bridge.send(this.glass, 'release');
    this.glass = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.window.removeListener('resize', this.resize);
    } catch {
      // Electron may invalidate BrowserWindow event methods during teardown.
    }
    try {
      this.contents.removeListener('zoom-changed', this.resize);
    } catch {
      // Do not let a destroyed WebContents turn window cleanup into an app crash.
    }
    try {
      this.removeGlass();
    } catch {
      // AppKit can dispose the child view with its parent window first.
      this.glass = null;
      this.root = null;
    }
  }
}
