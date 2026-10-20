import { createRequire } from 'node:module';
import type { BrowserWindow, WebContents } from 'electron';
import type { SidebarMaterial } from '../shared/native';

type Pointer = bigint | null;
type Rect = { origin: { x: number; y: number }; size: { width: number; height: number } };

/** Public AppKit only. All calls are synchronous on Electron's AppKit main thread. */
function appKitBridge() {
  const require = createRequire(import.meta.url);
  const koffi = require('koffi') as typeof import('koffi');
  const appKit = koffi.load('/System/Library/Frameworks/AppKit.framework/AppKit');
  const objc = koffi.load('/usr/lib/libobjc.A.dylib');
  const system = koffi.load('/usr/lib/libSystem.B.dylib');
  if (!system.func('int pthread_main_np(void)')())
    throw new Error('AppKit requires the main thread.');
  const klass = objc.func('void *objc_lookUpClass(const char *name)');
  const selector = objc.func('void *sel_registerName(const char *name)');
  const selectors = new Map<string, Pointer>();
  const sel = (name: string): Pointer => {
    if (!selectors.has(name)) selectors.set(name, selector(name));
    return selectors.get(name)!;
  };
  const rect = koffi.struct({
    origin: koffi.struct({ x: 'double', y: 'double' }),
    size: koffi.struct({ width: 'double', height: 'double' }),
  });
  const id = objc.func('objc_msgSend', 'void *', ['void *', 'void *']);
  const voidMessage = objc.func('objc_msgSend', 'void', ['void *', 'void *']);
  const objectMessage = objc.func('objc_msgSend', 'void', ['void *', 'void *', 'void *']);
  const idWithObject = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'void *']);
  const colorMessage = objc.func('objc_msgSend', 'void *', [
    'void *',
    'void *',
    'double',
    'double',
  ]);
  const boolMessage = objc.func('objc_msgSend', 'void', ['void *', 'void *', 'bool']);
  const integerMessage = objc.func('objc_msgSend', 'void', ['void *', 'void *', 'long']);
  const doubleMessage = objc.func('objc_msgSend', 'void', ['void *', 'void *', 'double']);
  const frameMessage = objc.func('objc_msgSend', 'void', ['void *', 'void *', rect]);
  const initFrame = objc.func('objc_msgSend', 'void *', ['void *', 'void *', rect]);
  const insert = objc.func('objc_msgSend', 'void', [
    'void *',
    'void *',
    'void *',
    'long',
    'void *',
  ]);
  // NSRect uses stret on Intel, normal aggregate return on Apple Silicon.
  const boundsMessage =
    process.arch === 'x64'
      ? objc.func('objc_msgSend_stret', 'void', [
          koffi.out(koffi.pointer(rect)),
          'void *',
          'void *',
        ])
      : objc.func('objc_msgSend', rect, ['void *', 'void *']);
  return {
    klass: (name: string): Pointer => klass(name),
    pointer: (handle: Buffer): Pointer => koffi.decode(handle, 'void *'),
    id: (object: Pointer, name: string): Pointer => id(object, sel(name)),
    send: (object: Pointer, name: string) => voidMessage(object, sel(name)),
    object: (object: Pointer, name: string, value: Pointer) =>
      objectMessage(object, sel(name), value),
    tint: (dark: boolean): Pointer =>
      dark ? colorMessage(klass('NSColor'), sel('colorWithWhite:alpha:'), 0, 0.2) : null,
    appearance: (dark: boolean): Pointer =>
      idWithObject(
        klass('NSAppearance'),
        sel('appearanceNamed:'),
        koffi.decode(
          appKit.symbol(dark ? 'NSAppearanceNameDarkAqua' : 'NSAppearanceNameAqua'),
          'void *',
        ),
      ),
    flag: (object: Pointer, name: string, value: boolean) => boolMessage(object, sel(name), value),
    integer: (object: Pointer, name: string, value: number) =>
      integerMessage(object, sel(name), value),
    double: (object: Pointer, name: string, value: number) =>
      doubleMessage(object, sel(name), value),
    frame: (object: Pointer, value: Rect) => frameMessage(object, sel('setFrame:'), value),
    init: (object: Pointer, value: Rect): Pointer =>
      initFrame(object, sel('initWithFrame:'), value),
    behind: (parent: Pointer, view: Pointer) =>
      insert(parent, sel('addSubview:positioned:relativeTo:'), view, -1, null),
    bounds: (object: Pointer): Rect => {
      if (process.arch !== 'x64') return boundsMessage(object, sel('bounds'));
      const value = {};
      boundsMessage(value, object, sel('bounds'));
      return value as Rect;
    },
  };
}

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
      this.bridge = appKitBridge();
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
      console.info('[Haus] Sidebar material: NSGlassEffectView');
    } catch (error) {
      this.failed = true;
      this.removeGlass();
      window.setVibrancy('sidebar');
      console.warn('[Haus] Liquid Glass unavailable; using sidebar vibrancy.', error);
    }
    window.on('resize', this.resize);
    this.contents.on('zoom-changed', this.resize);
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
      console.warn('[Haus] Sidebar material fell back to vibrancy.', error);
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
    this.window.removeListener('resize', this.resize);
    // BrowserWindow.webContents itself throws after the native window is destroyed.
    this.contents.removeListener('zoom-changed', this.resize);
    this.removeGlass();
  }
}
