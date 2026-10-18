import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

const load = vi.hoisted(() => vi.fn());
vi.mock('node:module', () => ({ createRequire: () => () => ({ load }) }));
import { NativeSidebarMaterial } from './sidebar-material';

afterEach(() => {
  vi.unstubAllGlobals();
  load.mockReset();
});

function windowStub() {
  return {
    setVibrancy: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
    webContents: { on: vi.fn(), removeListener: vi.fn() },
  };
}

describe('native sidebar fallback', () => {
  it('leaves non-macOS platforms alone without loading native libraries', () => {
    vi.stubGlobal('process', { platform: 'win32' });
    const window = windowStub();
    const material = new NativeSidebarMaterial(window as unknown as BrowserWindow, 'dark');
    expect(material.update(232)).toBe('none');
    expect(load).not.toHaveBeenCalled();
    expect(window.setVibrancy).not.toHaveBeenCalled();
  });

  it('keeps vibrancy on older macOS without requiring Koffi', () => {
    vi.stubGlobal('process', { platform: 'darwin', getSystemVersion: () => '15.7.1' });
    const window = windowStub();
    const material = new NativeSidebarMaterial(window as unknown as BrowserWindow, 'dark');
    expect(material.update(215)).toBe('vibrancy');
    expect(load).not.toHaveBeenCalled();
  });

  it('retains a working sidebar when loading the native module fails', () => {
    vi.stubGlobal('process', { platform: 'darwin', getSystemVersion: () => '26.0' });
    load.mockImplementation(() => {
      throw new Error('Native module unavailable');
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const window = windowStub();
    const material = new NativeSidebarMaterial(window as unknown as BrowserWindow, 'dark');
    expect(window.setVibrancy).toHaveBeenCalledWith('sidebar');
    expect(material.update(232)).toBe('vibrancy');
    expect(() => material.update(Number.NaN)).toThrow('Invalid sidebar width');
    expect(() => material.update(-1)).toThrow('Invalid sidebar width');
    expect(() => material.update(5000)).toThrow('Invalid sidebar width');
    material.dispose();
    material.dispose();
    warning.mockRestore();
  });
});
