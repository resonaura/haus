import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  detectLinuxDesktop,
  hasBlurMyShell,
  hasHyprlandBlur,
  hasKWinBlur,
  LinuxShellMaterial,
  type LinuxDesktop,
  type LinuxShellMaterialRuntime,
} from './linux-shell-material';

afterEach(() => vi.useRealTimers());

describe('Linux desktop appearance detection', () => {
  it('recognizes GNOME, KDE Plasma, and Hyprland sessions', () => {
    expect(detectLinuxDesktop({ XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' })).toBe('gnome');
    expect(detectLinuxDesktop({ XDG_CURRENT_DESKTOP: 'KDE' })).toBe('kde');
    expect(detectLinuxDesktop({ HYPRLAND_INSTANCE_SIGNATURE: 'instance-id' })).toBe('hyprland');
    expect(detectLinuxDesktop({ XDG_CURRENT_DESKTOP: 'XFCE' })).toBeNull();
  });

  it('detects compositor-specific blur only when enabled', () => {
    expect(hasBlurMyShell("['blur-my-shell@aunetx', 'dash-to-dock@micxgx.gmail.com']")).toBe(true);
    expect(hasBlurMyShell("['blur-my-shell-next@aunetx', 'other@extension']")).toBe(false);
    expect(hasKWinBlur('[Plugins]\nblurEnabled=true\n\n[Windows]\nblurEnabled=false')).toBe(true);
    expect(hasKWinBlur('[Plugins]\nblurEnabled=false')).toBe(false);
    expect(hasHyprlandBlur('{"int":1,"set":true}')).toBe(true);
    expect(hasHyprlandBlur('{"int":0,"set":true}')).toBe(false);
    expect(hasHyprlandBlur('not-json')).toBe(false);
  });

  it('updates the sidebar when the active compositor changes its blur setting', async () => {
    vi.useFakeTimers();
    let enabled = true;
    let changed: (() => void) | undefined;
    const stop = vi.fn();
    const onChange = vi.fn();
    const runtime: LinuxShellMaterialRuntime = {
      desktop: () => 'kde' satisfies LinuxDesktop,
      readEnabledExtensions: async () => '[]',
      readKWinConfiguration: async () => `[Plugins]\nblurEnabled=${enabled}`,
      readHyprlandBlurOption: async () => '{"int":0,"set":true}',
      watch: (_desktop, callback) => {
        changed = callback;
        return stop;
      },
    };
    const material = new LinuxShellMaterial(onChange, runtime);

    await material.start();
    expect(material.material).toBe('kwin-blur');
    expect(onChange).toHaveBeenCalledWith('kwin-blur');

    enabled = false;
    changed?.();
    await vi.advanceTimersByTimeAsync(120);
    expect(material.material).toBe('none');
    expect(onChange).toHaveBeenLastCalledWith('none');

    material.dispose();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('keeps unknown Linux desktop environments opaque', async () => {
    const onChange = vi.fn();
    const watch = vi.fn(() => vi.fn());
    const material = new LinuxShellMaterial(onChange, {
      desktop: () => null,
      readEnabledExtensions: async () => "['blur-my-shell@aunetx']",
      readKWinConfiguration: async () => '[Plugins]\nblurEnabled=true',
      readHyprlandBlurOption: async () => '{"int":1,"set":true}',
      watch,
    });
    await material.start();
    expect(material.material).toBe('none');
    expect(onChange).not.toHaveBeenCalled();
    expect(watch).not.toHaveBeenCalled();
  });
});
