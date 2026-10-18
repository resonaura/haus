import { describe, expect, it, vi } from 'vitest';
import { applyWindowsAcrylicFallback, windowsAcrylicMode } from './windows-acrylic';

describe('Windows acrylic selection', () => {
  it('uses Electron Acrylic on Windows 11 22H2 and later', () => {
    expect(windowsAcrylicMode('10.0.22621')).toBe('electron');
    expect(windowsAcrylicMode('10.0.26100')).toBe('electron');
  });

  it('uses acrylic blur on Windows 10 and older Windows 11 builds', () => {
    expect(windowsAcrylicMode('10.0.19045')).toBe('legacy-acrylic');
    expect(windowsAcrylicMode('10.0.22000')).toBe('legacy-acrylic');
    expect(windowsAcrylicMode('10.0.15063')).toBe('legacy-blur');
  });

  it('tints the legacy acrylic fallback to the selected appearance', () => {
    const handle = Buffer.from([1, 2, 3]);
    const window = { getNativeWindowHandle: () => handle };
    const apply = vi.fn(() => true);
    expect(applyWindowsAcrylicFallback(window as never, '10.0.19045', apply, false)).toBe(true);
    expect(apply).toHaveBeenCalledWith(handle, 4, 0xccf2f2f2);
  });

  it('asks Electron to apply native Acrylic on supported Windows 11', () => {
    const setBackgroundMaterial = vi.fn();
    const window = { getNativeWindowHandle: () => Buffer.alloc(0), setBackgroundMaterial };
    const apply = vi.fn();
    expect(applyWindowsAcrylicFallback(window as never, '10.0.22621', apply)).toBe(true);
    expect(setBackgroundMaterial).toHaveBeenCalledWith('acrylic');
    expect(apply).not.toHaveBeenCalled();
  });
});
