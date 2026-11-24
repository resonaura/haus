/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { createRenderer, isTerminal, render, resetRender, startFrameLoop } from '@gpuix/react';
import type { FrameLoop, KeyEvent, PathPromptOptions, WindowOptions } from '@gpuix/react';
import type { ReactNode } from 'react';
import * as koffi from 'koffi';
import { appKitBridge } from '../platform/appkit.js';
import {
  promptOpenPaths,
  promptSaveFilePath,
  writeSavedFile,
  type SaveFileOptions,
} from '../platform/dialogs.js';
import {
  createLinuxMaterialController,
  type LinuxMaterialController,
} from '../platform/materials.js';
import { installMacQuit } from '../platform/quit.js';
import { AppKitSidebar, type SidebarBackdrop } from '../platform/sidebar.js';
import { WindowControlsController } from '../platform/window-controls.js';
import { requireGpuiBun } from './bun.js';

export class GpuiWindow {
  readonly renderer: ReturnType<typeof createRenderer>;
  readonly sidebar?: SidebarBackdrop;
  readonly controls: WindowControlsController;
  private linuxMaterial?: LinuxMaterialController;
  private readonly keyListeners = new Set<(event: KeyEvent) => void>();
  private readAppearance?: () => string | null;
  private loop?: FrameLoop;
  private cleanup?: () => Promise<void>;
  private closing?: Promise<void>;

  constructor(
    options: WindowOptions,
    private readonly exit: (code: number) => void = (code) => process.exit(code),
  ) {
    requireGpuiBun();
    this.renderer = createRenderer();
    this.renderer.init(options);
    this.controls = new WindowControlsController({
      minimizeWindow: () => this.renderer.minimizeWindow(),
      zoomWindow: () => this.renderer.zoomWindow(),
      toggleFullscreen: () => this.renderer.toggleFullscreen(),
      activateWindow: () => this.renderer.activateWindow(),
      setWindowTitle: (title) => this.renderer.setWindowTitle(title),
      closeWindow: () => this.close(),
    });
    if (process.platform === 'darwin' && !isTerminal()) {
      const bridge = appKitBridge(koffi);
      installMacQuit(bridge, options.title, () => void this.close());
      const app = bridge.id(bridge.klass('NSApplication'), 'sharedApplication');
      this.readAppearance = () =>
        bridge.string(bridge.id(bridge.id(app, 'effectiveAppearance'), 'name'));
      if (options.windowBackground === 'transparent' && options.title) {
        this.sidebar = new AppKitSidebar(bridge, options.title);
      }
    }
    if (process.platform === 'linux' && !isTerminal()) {
      this.linuxMaterial = createLinuxMaterialController(() => {
        /* Compositor material updates are queried dynamically when rendering shell surfaces. */
      });
      void this.linuxMaterial.start();
    }
  }

  onWindowKeyDown(listener: (event: KeyEvent) => void): () => void {
    this.keyListeners.add(listener);
    return () => this.keyListeners.delete(listener);
  }

  openPaths(options?: PathPromptOptions): Promise<readonly string[] | null> {
    return promptOpenPaths(this.renderer, options);
  }

  async saveFile(options: SaveFileOptions, content: string | Uint8Array): Promise<boolean> {
    const filePath = await promptSaveFilePath(options);
    if (!filePath) return false;
    await writeSavedFile(filePath, content);
    return true;
  }

  getSystemTheme(): 'light' | 'dark' {
    const name = this.readAppearance?.();
    return name && !name.includes('Dark') ? 'light' : 'dark';
  }

  mount(
    node: ReactNode,
    cleanup?: () => Promise<void>,
    renderFn: typeof render = render,
  ): void {
    if (this.closing) return;
    this.cleanup = cleanup;
    renderFn(node, {
      renderer: this.renderer,
      onKeyDown: (event) => {
        for (const listener of this.keyListeners) listener(event);
      },
    });
    this.loop ??= startFrameLoop(this.renderer, {
      onTerminated: () => void this.close(true),
    });
  }

  close(windowClosed = false): Promise<void> {
    this.closing ??= Promise.resolve()
      .then(async () => {
        try {
          this.loop?.stop();
          this.linuxMaterial?.dispose();
          this.sidebar?.close();
          if (!windowClosed) resetRender();
        } catch (error) {
          // AppKit can remove the last window before consulting its termination delegate.
          if (
            process.platform !== 'darwin' ||
            !(error instanceof Error) ||
            error.message !== 'window not found'
          )
            throw error;
        } finally {
          await this.cleanup?.();
        }
      })
      .then(
        () => this.exit(0),
        () => {
          console.error('Haus could not cleanly close its desktop window.');
          this.exit(1);
        },
      );
    return this.closing;
  }
}
