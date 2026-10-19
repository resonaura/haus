import { createRequire } from 'node:module';
import type { BrowserWindow } from 'electron';

type Koffi = typeof import('koffi');
type AcrylicCall = (handle: Buffer, state: 3 | 4, tint: number) => boolean;

/** Electron's native acrylic is available on Windows 11 22H2+. */
export function windowsAcrylicMode(version: string): 'electron' | 'legacy-acrylic' | 'legacy-blur' {
  const [, major = '0', , build = '0'] = version.match(/^(\d+)\.(\d+)\.(\d+)/) ?? [];
  const majorVersion = Number(major);
  const buildNumber = Number(build);
  if (majorVersion >= 10 && buildNumber >= 22621) return 'electron';
  if (majorVersion >= 10 && buildNumber >= 17134) return 'legacy-acrylic';
  return 'legacy-blur';
}

let cachedNativeCall: AcrylicCall | undefined;

export function decodeWindowHandle(handle: Buffer): bigint {
  if (handle.length === 8) return handle.readBigUInt64LE();
  if (handle.length === 4) return BigInt(handle.readUInt32LE());
  throw new Error('Invalid native window handle.');
}

function nativeAcrylicCall(): AcrylicCall {
  if (cachedNativeCall) return cachedNativeCall;
  const require = createRequire(import.meta.url);
  const koffi = require('koffi') as Koffi;
  const user32 = koffi.load('user32.dll');
  const accentPolicy = koffi.struct('HausAccentPolicy', {
    accentState: 'int32_t',
    accentFlags: 'uint32_t',
    gradientColor: 'uint32_t',
    animationId: 'int32_t',
  });
  koffi.struct('HausWindowCompositionAttributeData', {
    attribute: 'int32_t',
    data: 'void *',
    size: 'size_t',
  });
  const setAttribute = user32.func(
    'int __stdcall SetWindowCompositionAttribute(void *window, HausWindowCompositionAttributeData *data)',
  );
  cachedNativeCall = (handle, state, tint) => {
    const policy = {
      accentState: state,
      accentFlags: 2,
      gradientColor: tint,
      animationId: 0,
    };
    const data = {
      attribute: 19, // WCA_ACCENT_POLICY
      data: koffi.as(policy, 'HausAccentPolicy *'),
      size: koffi.sizeof(accentPolicy),
    };
    // Electron returns bytes containing HWND, not the HWND address itself.
    return setAttribute(decodeWindowHandle(handle), data) !== 0;
  };
  return cachedNativeCall;
}

/** Use the Electron/DWM path on supported Windows 11, with an acrylic fallback on Windows 10. */
export function applyWindowsAcrylicFallback(
  window: Pick<BrowserWindow, 'getNativeWindowHandle'> &
    Partial<Pick<BrowserWindow, 'setBackgroundMaterial'>>,
  version: string,
  call?: AcrylicCall,
  dark = true,
): boolean {
  const mode = windowsAcrylicMode(version);
  if (mode === 'electron' && window.setBackgroundMaterial) {
    try {
      window.setBackgroundMaterial('acrylic');
      return true;
    } catch {
      /* Older Electron/DWM may still need the composition path. */
    }
  }
  try {
    const state = mode === 'legacy-blur' ? 3 : 4;
    const tint = dark ? 0xcc171717 : 0xccf2f2f2;
    const apply = call ?? nativeAcrylicCall();
    const handle = window.getNativeWindowHandle();
    if (apply(handle, state, tint)) return true;
    return state === 4 && apply(handle, 3, tint);
  } catch (error) {
    console.warn('[Haus] Windows acrylic fallback is unavailable.', error);
    return false;
  }
}
