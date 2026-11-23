/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { readFileSync } from 'node:fs';
import Module, { createRequire, registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PluginDevice } from '../contracts.js';

type NodeModule = Module & { _compile(source: string, filename: string): void; paths: string[] };
type ModuleInternals = typeof Module & {
  _load(request: string, parent: Module | undefined, isMain: boolean): unknown;
  _nodeModulePaths(directory: string): string[];
};

const VIRTUAL_SDK_PREFIX = 'haus-virtual-scrypted:';

function unwrapPluginExport(exported: unknown): unknown {
  if (!exported || typeof exported !== 'object') return exported;
  const first = (exported as { default?: unknown }).default ?? exported;
  if (first && typeof first === 'object' && 'default' in first) {
    return (first as { default?: unknown }).default ?? first;
  }
  return first;
}

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
  (globalThis as Record<string, unknown>).__hausVirtualScryptedSdk = sdk;
  const esmHook =
    typeof registerHooks === 'function'
      ? registerHooks({
          resolve(specifier, context, nextResolve) {
            if (specifier === '@scrypted/server' || specifier.startsWith('@scrypted/server/')) {
              throw Error('kitsune_forbidden_package');
            }
            if (specifier === '@scrypted/sdk' || specifier.startsWith('@scrypted/sdk/')) {
              return { url: `${VIRTUAL_SDK_PREFIX}sdk`, shortCircuit: true };
            }
            return nextResolve(specifier, context);
          },
          load(url, context, nextLoad) {
            if (url.startsWith(VIRTUAL_SDK_PREFIX)) {
              const keys = Object.keys(sdk).filter((k) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k));
              const named = keys.map((k) => `export const ${k} = sdk.${k};`).join('\n');
              return {
                format: 'module',
                shortCircuit: true,
                source: `const sdk = globalThis.__hausVirtualScryptedSdk;\nexport default sdk;\n${named}\n`,
              };
            }
            return nextLoad(url, context);
          },
        })
      : undefined;
  const restore = () => {
    internals._load = original;
    esmHook?.deregister();
    Reflect.deleteProperty(globalThis, '__hausVirtualScryptedSdk');
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
  const filename = resolve(entry);
  try {
    let exported: unknown;
    if (filename.endsWith('.mjs')) {
      exported = await import(pathToFileURL(filename).href);
    } else {
      const module = new Module(filename) as NodeModule;
      module.filename = filename;
      module.paths = internals._nodeModulePaths(dirname(filename));
      try {
        // plugin.zip contains CommonJS even when its npm wrapper has ESM metadata.
        module._compile(readFileSync(filename, 'utf8'), filename);
        exported = module.exports;
      } catch (cjsError: unknown) {
        if (
          cjsError instanceof SyntaxError &&
          /import|export|Cannot use import statement/i.test(cjsError.message)
        ) {
          exported = await import(pathToFileURL(filename).href);
        } else {
          throw cjsError;
        }
      }
    }
    const candidate = unwrapPluginExport(exported);
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
