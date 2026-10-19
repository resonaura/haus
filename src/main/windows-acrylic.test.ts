import { describe, expect, it, vi } from 'vitest';
import {
  applyWindowsAcrylicFallback,
  applyWindowsRoundedCorners,
  windowsAcrylicMode,
  decodeWindowHandle,
} from './windows-acrylic';

describe('Windows acrylic selection', () => {
  it('requests DWM rounding only on Windows 11 without replacing the acrylic region', () => {
    const handle = Buffer.alloc(8),
      window = { getNativeWindowHandle: () => handle },
      call = vi.fn(() => true);
    expect(applyWindowsRoundedCorners(window, '10.0.19045', call)).toBe(false);
    expect(applyWindowsRoundedCorners(window, 'unknown', call)).toBe(false);
    expect(call).not.toHaveBeenCalled();
    expect(applyWindowsRoundedCorners(window, '10.0.22621', call)).toBe(true);
    expect(call).toHaveBeenCalledWith(handle);
  });
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

describe('legacy HWND marshalling', () => {
  it('passes the value stored in Electron’s handle buffer, not a pointer to its bytes', () => {
    const handle = Buffer.alloc(8);
    handle.writeBigUInt64LE(0x12345678abcdefn);
    expect(decodeWindowHandle(handle)).toBe(0x12345678abcdefn);
    const x86 = Buffer.alloc(4);
    x86.writeUInt32LE(0xaabbccdd);
    expect(decodeWindowHandle(x86)).toBe(0xaabbccddn);
    expect(() => decodeWindowHandle(Buffer.alloc(3))).toThrow();
  });
  it('falls back to legacy blur when the OS rejects acrylic', () => {
    const handle = Buffer.alloc(8);
    const call = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    expect(
      applyWindowsAcrylicFallback({ getNativeWindowHandle: () => handle }, '10.0.19045', call),
    ).toBe(true);
    expect(call.mock.calls.map((args) => args[1])).toEqual([4, 3]);
  });
  it('does not claim a material was applied when both legacy paths fail', () => {
    expect(
      applyWindowsAcrylicFallback(
        { getNativeWindowHandle: () => Buffer.alloc(8) },
        '10.0.19045',
        () => false,
      ),
    ).toBe(false);
  });
});
