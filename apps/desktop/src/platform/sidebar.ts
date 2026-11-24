/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { SidebarMaterial } from '../shared/native.js';
import { findAppKitWindow, type appKitBridge, type Pointer } from './appkit.js';

export interface SidebarBackdrop {
  subscribe(listener: () => void): () => void;
  getSnapshot(): boolean;
  update(width: number, dark: boolean): void;
  dispose(): void;
  close(): void;
}

export class AppKitSidebar implements SidebarBackdrop {
  private readonly listeners = new Set<() => void>();
  private root: Pointer = null;
  private effect: Pointer = null;
  private width = 0;
  private dark = true;
  private timer?: ReturnType<typeof setInterval>;
  private material: SidebarMaterial = 'none';
  private unavailable = false;

  constructor(
    private readonly bridge: ReturnType<typeof appKitBridge>,
    private readonly title: string,
  ) {}

  getSnapshot = (): boolean => this.material !== 'none';

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  update(width: number, dark: boolean): void {
    if (this.unavailable) return;
    const widthChanged = this.width !== width;
    const themeChanged = this.dark !== dark;
    this.width = width;
    this.dark = dark;
    if (width === 0) {
      this.dispose();
      return;
    }
    this.refresh(widthChanged, themeChanged);
    if (!this.unavailable) this.timer ??= setInterval(() => this.refresh(), 400).unref();
  }

  dispose(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.detach();
  }

  close(): void {
    this.unavailable = true;
    this.listeners.clear();
    this.dispose();
  }

  private refresh(widthChanged = false, themeChanged = false): void {
    const bridge = this.bridge;
    try {
      const workspace = bridge.id(bridge.klass('NSWorkspace'), 'sharedWorkspace');
      if (bridge.readFlag(workspace, 'accessibilityDisplayShouldReduceTransparency')) {
        this.detach();
        return;
      }
      if (!this.root) {
        const root = bridge.id(findAppKitWindow(bridge, this.title), 'contentView');
        if (!root) return;
        bridge.send(root, 'retain');
        this.root = root;
      }
      if (this.effect) {
        if (widthChanged) bridge.frame(this.effect, this.frame(this.root));
        if (themeChanged) this.appearance(this.material);
        return;
      }

      const frame = this.frame(this.root);
      const glass = bridge.klass('NSGlassEffectView');
      this.effect = bridge.init(bridge.id(glass, 'alloc'), frame);
      const material = this.effect ? 'liquid-glass' : 'vibrancy';
      if (this.effect) {
        bridge.integer(this.effect, 'setStyle:', 0); // NSGlassEffectViewStyleRegular
        bridge.double(this.effect, 'setCornerRadius:', 0);
      } else {
        this.effect = bridge.init(bridge.id(bridge.klass('NSVisualEffectView'), 'alloc'), frame);
        if (!this.effect) throw new Error('AppKit could not create a sidebar material.');
        bridge.integer(this.effect, 'setMaterial:', 7); // NSVisualEffectMaterialSidebar
        bridge.integer(this.effect, 'setBlendingMode:', 0); // NSVisualEffectBlendingModeBehindWindow
        bridge.integer(this.effect, 'setState:', 1); // NSVisualEffectStateActive
      }
      this.appearance(material);
      bridge.behind(this.root, this.effect);
      bridge.integer(this.effect, 'setAutoresizingMask:', 16); // NSViewHeightSizable
      this.setMaterial(material);
    } catch (error) {
      this.unavailable = true;
      this.dispose();
      console.warn('Sidebar material unavailable. Using an opaque background.', error);
    }
  }

  private frame(root: NonNullable<Pointer>) {
    const bounds = this.bridge.bounds(root);
    return {
      origin: bounds.origin,
      size: { width: Math.min(this.width, bounds.size.width), height: bounds.size.height },
    };
  }

  private appearance(material: SidebarMaterial): void {
    const bridge = this.bridge;
    bridge.object(this.effect, 'setAppearance:', bridge.appearance(this.dark));
    if (material === 'liquid-glass')
      bridge.object(this.effect, 'setTintColor:', bridge.tint(this.dark));
  }

  private detach(): void {
    if (this.effect) {
      this.bridge.send(this.effect, 'removeFromSuperview');
      this.bridge.send(this.effect, 'release');
      this.effect = null;
    }
    if (this.root) {
      this.bridge.send(this.root, 'release');
      this.root = null;
    }
    this.setMaterial('none');
  }

  private setMaterial(material: SidebarMaterial): void {
    const wasActive = this.getSnapshot();
    this.material = material;
    if (this.getSnapshot() !== wasActive) for (const listener of this.listeners) listener();
  }
}
