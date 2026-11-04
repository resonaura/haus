/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import type { PluginDevice } from '../contracts.js';

type NodeModule = Module & { _compile(source: string, filename: string): void; paths: string[] };
type ModuleInternals = typeof Module & {
  _load(request: string, parent: Module | undefined, isMain: boolean): unknown;
  _nodeModulePaths(directory: string): string[];
};
/** Install only inside the dedicated plugin child process, never in the Haus controller. */
export async function loadCommonJs(entry: string, sdk: object) {
  if (process.env.HAUS_KITSUNE_CHILD !== '1') throw Error('kitsune_loader_requires_child_process');
  const internals = Module as ModuleInternals,
    original = internals._load;
  const shim = new Proxy(
    { default: sdk, __esModule: true },
    {
      get(target, property) {
        return Reflect.has(target, property)
          ? Reflect.get(target, property)
          : Reflect.get(sdk, property);
      },
    },
  );
  const globals = new Map<string, PropertyDescriptor | undefined>();
  // Published plugins may bundle their SDK bootstrap and obtain managers through
  // ambient globals. Supply our implementations in this child as well as require().
  for (const [name, value] of Object.entries(sdk)) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  }
  const restore = () => {
    internals._load = original;
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  };
  internals._load = function (request, parent, isMain) {
    if (request === '@scrypted/server' || request.startsWith('@scrypted/server/'))
      throw Error('kitsune_forbidden_package');
    if (request === '@scrypted/sdk' || request.startsWith('@scrypted/sdk/')) return shim;
    return original.call(this, request, parent, isMain);
  };
  const filename = resolve(entry),
    module = new Module(filename) as NodeModule;
  module.filename = filename;
  module.paths = internals._nodeModulePaths(dirname(filename));
  // plugin.zip contains CommonJS even when its npm wrapper has ESM metadata.
  try {
    module._compile(readFileSync(filename, 'utf8'), filename);
    const exported = module.exports as { default?: unknown };
    const candidate = exported?.default ?? exported;
    const root = (await (typeof candidate === 'function'
      ? Reflect.construct(candidate, [])
      : candidate)) as PluginDevice;
    if (!root || typeof root !== 'object') throw Error('kitsune_plugin_export_unsupported');
    return { root, close: restore };
  } catch (error) {
    restore();
    throw error;
  }
}
// Explicit reference keeps Node's standard require available for plugins without a global shim.
export const requireForPlugin = (entry: string) => createRequire(entry);
