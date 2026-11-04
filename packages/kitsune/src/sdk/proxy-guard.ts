/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import type { Diagnostic } from '../contracts.js';

/** A bounded warning contains call names only: arguments may contain camera passwords/tokens. */
export function compatibilityGuard(pluginId: string, diagnostic: (event: Diagnostic) => void) {
  const seen = new Set<string>();
  const warn = (target: string) => {
    if (seen.has(target) || seen.size >= 256) return;
    seen.add(target);
    diagnostic({
      component: 'kitsune:compat',
      event: 'unimplemented_sdk_call',
      pluginId,
      target,
      message: `[kitsune:compat] Unimplemented SDK call: ${target}(...)`,
    });
  };
  const fallback = (path: string): unknown =>
    new Proxy(function () {}, {
      get(target, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (descriptor && !descriptor.configurable && 'value' in descriptor && !descriptor.writable)
          return descriptor.value;
        if (property === 'then')
          return (resolve: (value: undefined) => unknown) =>
            Promise.resolve().then(() => resolve(undefined));
        if (property === Symbol.toPrimitive) return () => undefined;
        if (property === Symbol.iterator) return function* () {};
        if (property === 'toJSON') return () => undefined;
        return fallback(`${path}.${String(property)}`);
      },
      apply() {
        warn(path);
        return fallback(path);
      },
      construct() {
        warn(path);
        return fallback(path) as object;
      },
    });
  return <T extends object>(target: T, name: string): T =>
    new Proxy(target, {
      get(object, property, receiver) {
        // Ordinary async detection and JS inspection must not turn managers into thenables.
        if (property === 'then' && !Reflect.has(object, property)) return undefined;
        if (typeof property === 'symbol' || Reflect.has(object, property))
          return Reflect.get(object, property, receiver);
        const path = `${name}.${property}`;
        warn(path);
        return fallback(path);
      },
    });
}
