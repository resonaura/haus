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

function nativeAcrylicCall(): AcrylicCall {
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
    'bool __stdcall SetWindowCompositionAttribute(void *window, HausWindowCompositionAttributeData *data)',
  );
  return (handle, state, tint) => {
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
    return Boolean(setAttribute(handle, koffi.as(data, 'HausWindowCompositionAttributeData *')));
  };
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
  if (mode === 'electron') {
    window.setBackgroundMaterial?.('acrylic');
    return true;
  }
  try {
    const state = mode === 'legacy-acrylic' ? 4 : 3;
    const tint = dark ? 0xcc171717 : 0xccf2f2f2;
    return (call ?? nativeAcrylicCall())(window.getNativeWindowHandle(), state, tint);
  } catch (error) {
    console.warn('[Haus] Windows acrylic fallback is unavailable.', error);
    return false;
  }
}
