/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export type Pointer = bigint | null;
export type Rect = { origin: { x: number; y: number }; size: { width: number; height: number } };

// All callers must run on the AppKit main thread.
export function appKitBridge(koffi: typeof import('koffi')) {
  const appKit = koffi.load('/System/Library/Frameworks/AppKit.framework/AppKit');
  const objc = koffi.load('/usr/lib/libobjc.A.dylib');
  const system = koffi.load('/usr/lib/libSystem.B.dylib');
  if (!system.func('int pthread_main_np(void)')())
    throw new Error('AppKit requires the main thread.');
  const klass = objc.func('void *objc_lookUpClass(const char *name)');
  const selector = objc.func('void *sel_registerName(const char *name)');
  const selectors = new Map<string, Pointer>();
  const sel = (name: string): Pointer => {
    const cached = selectors.get(name);
    if (cached !== undefined) return cached;
    const value: Pointer = selector(name);
    selectors.set(name, value);
    return value;
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
  const readBool = objc.func('objc_msgSend', 'bool', ['void *', 'void *']);
  const count = objc.func('objc_msgSend', 'size_t', ['void *', 'void *']);
  const element = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'size_t']);
  const string = objc.func('objc_msgSend', 'str', ['void *', 'void *']);
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
    readFlag: (object: Pointer, name: string): boolean => readBool(object, sel(name)),
    string: (object: Pointer): string | null => string(object, sel('UTF8String')),
    objects: function* (array: Pointer): Generator<Pointer> {
      const length: number = count(array, sel('count'));
      for (let i = 0; i < length; i++) yield element(array, sel('objectAtIndex:'), i);
    },
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

export function findAppKitWindow(bridge: ReturnType<typeof appKitBridge>, title: string): Pointer {
  const app = bridge.id(bridge.klass('NSApplication'), 'sharedApplication');
  for (const window of bridge.objects(bridge.id(app, 'windows'))) {
    if (bridge.string(bridge.id(window, 'title')) === title) return window;
  }
  return null;
}
