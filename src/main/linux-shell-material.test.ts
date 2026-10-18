import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasBlurMyShell, isGnomeDesktop, LinuxShellMaterial } from './linux-shell-material';

afterEach(() => vi.useRealTimers());

describe('GNOME shell blur detection', () => {
  it('detects GNOME sessions and the exact enabled Blur my Shell extension', () => {
    expect(isGnomeDesktop({ XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' })).toBe(true);
    expect(isGnomeDesktop({ XDG_CURRENT_DESKTOP: 'KDE' })).toBe(false);
    expect(hasBlurMyShell("['blur-my-shell@aunetx', 'dash-to-dock@micxgx.gmail.com']")).toBe(true);
    expect(hasBlurMyShell("['blur-my-shell-next@aunetx', 'other@extension']")).toBe(false);
  });

  it('refreshes the material when GNOME reports an extension change', async () => {
    vi.useFakeTimers();
    let extensions = "['blur-my-shell@aunetx']";
    let changed: (() => void) | undefined;
    const stop = vi.fn();
    const onChange = vi.fn();
    const material = new LinuxShellMaterial(onChange, {
      supported: () => true,
      readEnabledExtensions: async () => extensions,
      watch: (callback) => {
        changed = callback;
        return stop;
      },
    });

    await material.start();
    expect(material.enabled).toBe(true);
    expect(onChange).toHaveBeenCalledWith(true);

    extensions = "['dash-to-dock@micxgx.gmail.com']";
    changed?.();
    await vi.advanceTimersByTimeAsync(120);
    expect(material.enabled).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(false);

    material.dispose();
    expect(stop).toHaveBeenCalledOnce();
  });
});
