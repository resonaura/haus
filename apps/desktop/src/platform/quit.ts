/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import * as koffi from 'koffi';
import { findAppKitWindow, type appKitBridge, type Pointer } from './appkit.js';

/** Let the window owner finish asynchronous cleanup before AppKit terminates the embedded process. */
export function installMacQuit(
  bridge: ReturnType<typeof appKitBridge>,
  title: string | undefined,
  onQuit: () => void,
): void {
  const objc = koffi.load('/usr/lib/libobjc.A.dylib');
  const selector = objc.func('void *sel_registerName(const char *name)');
  const getClass = objc.func('void *object_getClass(void *object)');
  const getMethod = objc.func('void *class_getInstanceMethod(void *cls, void *selector)');
  const addMethod = objc.func(
    'bool class_addMethod(void *cls, void *selector, void *imp, const char *types)',
  );
  const application = bridge.id(bridge.klass('NSApplication'), 'sharedApplication');
  const delegate = bridge.id(application, 'delegate');
  const delegateClass = delegate && getClass(delegate);
  const shouldTerminate = selector('applicationShouldTerminate:');
  if (!delegateClass || getMethod(delegateClass, shouldTerminate)) {
    throw new Error('Haus could not install its AppKit shutdown hook.');
  }

  const signature = koffi.proto(
    'ulong HausShouldTerminate(void *self, void *selector, void *sender)',
  );
  // The AppKit delegate and the registered callback both belong to the process lifetime.
  const callback = koffi.register(() => {
    queueMicrotask(onQuit);
    // NSTerminateCancel returns control to Bun. NSTerminateLater would enter AppKit's modal event loop.
    return 0;
  }, koffi.pointer(signature));
  if (!addMethod(delegateClass, shouldTerminate, callback, 'Q@:@')) {
    koffi.unregister(callback);
    throw new Error('Haus could not install its AppKit shutdown hook.');
  }

  if (!title) return;
  const window = findAppKitWindow(bridge, title);
  const windowDelegate = bridge.id(window, 'delegate');
  const windowClass = windowDelegate && getClass(windowDelegate);
  const shouldClose: Pointer = selector('windowShouldClose:');
  const method = windowClass && getMethod(windowClass, shouldClose);
  if (!window || !windowClass || !method) {
    throw new Error('Haus could not install its AppKit window close hook.');
  }
  const implementation = objc.func('void *method_getImplementation(void *method)');
  const encoding = objc.func('str method_getTypeEncoding(void *method)');
  const replace = objc.func(
    'void *class_replaceMethod(void *cls, void *selector, void *imp, const char *types)',
  );
  const original: Pointer = implementation(method);
  const types: string | null = encoding(method);
  if (!original || !types) throw new Error('Haus could not inspect its AppKit window delegate.');
  const closeSignature = koffi.proto(
    'bool HausWindowShouldClose(void *self, void *selector, void *sender)',
  );
  const closeCallback = koffi.register((self: Pointer, command: Pointer, sender: Pointer) => {
    const allowed = Boolean(koffi.call(original, closeSignature, self, command, sender));
    if (!allowed || sender !== window) return allowed;
    // Keep the window alive until React unmounts and stream leases are released.
    queueMicrotask(onQuit);
    return false;
  }, koffi.pointer(closeSignature));
  replace(windowClass, shouldClose, closeCallback, types);
}
