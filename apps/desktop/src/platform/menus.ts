/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ContextMenuItem } from '../shared/native.js';
import { appKitBridge, type Pointer } from './appkit.js';

const MAX_MENU_ITEMS = 64;
const MAX_MENU_DEPTH = 3;

export function sanitizeContextMenuItems(
  items: readonly ContextMenuItem[],
  depth = 0,
): ContextMenuItem[] {
  if (!Array.isArray(items) || depth > MAX_MENU_DEPTH) return [];
  const sanitized: ContextMenuItem[] = [];
  for (const item of items.slice(0, MAX_MENU_ITEMS)) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'separator') {
      if (sanitized.length > 0 && sanitized.at(-1)?.type !== 'separator') {
        sanitized.push({ id: item.id || `sep-${sanitized.length}`, label: '', type: 'separator' });
      }
      continue;
    }
    const label = typeof item.label === 'string' ? item.label.trim().slice(0, 120) : '';
    const id = typeof item.id === 'string' ? item.id.trim().slice(0, 120) : '';
    if (!label) continue;
    if (item.type === 'submenu') {
      const children = sanitizeContextMenuItems(item.items ?? [], depth + 1);
      if (children.length > 0) {
        sanitized.push({
          id: id || label,
          label,
          type: 'submenu',
          enabled: item.enabled !== false,
          items: children,
        });
      }
      continue;
    }
    if (!id) continue;
    sanitized.push({
      id,
      label,
      type: 'normal',
      enabled: item.enabled !== false,
    });
  }
  while (sanitized.at(-1)?.type === 'separator') sanitized.pop();
  return sanitized;
}

let macMenuSelectedTag = -1;
let macMenuTarget: Pointer = null;
let macMenuSelector: Pointer = null;

function ensureMacMenuTarget(koffi: typeof import('koffi')): { target: Pointer; action: Pointer } {
  if (macMenuTarget && macMenuSelector) return { target: macMenuTarget, action: macMenuSelector };
  const objc = koffi.load('/usr/lib/libobjc.A.dylib');
  const bridge = appKitBridge(koffi);
  const selector = objc.func('void *sel_registerName(const char *name)');
  const getClass = objc.func('void *objc_lookUpClass(const char *name)');
  const allocClass = objc.func(
    'void *objc_allocateClassPair(void *superclass, const char *name, size_t extraBytes)',
  );
  const registerClass = objc.func('void objc_registerClassPair(void *cls)');
  const addMethod = objc.func(
    'bool class_addMethod(void *cls, void *sel, void *imp, const char *types)',
  );
  const sel = selector('hausMenuSelect:');
  let targetClass = getClass('HausGpuiMenuTarget');
  if (!targetClass) {
    targetClass = allocClass(bridge.klass('NSObject'), 'HausGpuiMenuTarget', 0);
    if (!targetClass) throw new Error('Could not register AppKit context menu target.');
    const signature = koffi.proto('void HausMenuSelect(void *self, void *cmd, void *sender)');
    const callback = koffi.register((_self: Pointer, _cmd: Pointer, sender: Pointer) => {
      const tag = objc.func('objc_msgSend', 'long', ['void *', 'void *'])(
        sender,
        selector('tag'),
      );
      macMenuSelectedTag = Number(tag);
    }, koffi.pointer(signature));
    if (!addMethod(targetClass, sel, callback, 'v@:@')) {
      koffi.unregister(callback);
      throw new Error('Could not attach AppKit context menu handler.');
    }
    registerClass(targetClass);
  }
  const instance = bridge.id(bridge.id(targetClass, 'alloc'), 'init');
  if (!instance) throw new Error('Could not allocate AppKit context menu target.');
  macMenuTarget = instance;
  macMenuSelector = sel;
  return { target: instance, action: sel };
}

export async function showMacContextMenu(
  items: readonly ContextMenuItem[],
  koffiLoader: () => Promise<typeof import('koffi')> = () => import('koffi'),
): Promise<string | null> {
  const sanitized = sanitizeContextMenuItems(items);
  if (sanitized.length === 0) return null;

  const koffi = await koffiLoader();
  const objc = koffi.load('/usr/lib/libobjc.A.dylib');
  const bridge = appKitBridge(koffi);
  const selector = objc.func('void *sel_registerName(const char *name)');
  const nsStringWithUtf8 = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'const char *']);
  const initWithTitle = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'void *']);
  const initMenuItem = objc.func('objc_msgSend', 'void *', [
    'void *',
    'void *',
    'void *',
    'void *',
    'void *',
  ]);
  const pointType = koffi.struct({ x: 'double', y: 'double' });
  const popUp = objc.func('objc_msgSend', 'bool', [
    'void *',
    'void *',
    'void *',
    pointType,
    'void *',
  ]);
  const mouseLocation =
    process.arch === 'x64'
      ? objc.func('objc_msgSend', pointType, ['void *', 'void *'])
      : objc.func('objc_msgSend', pointType, ['void *', 'void *']);

  const { target, action } = ensureMacMenuTarget(koffi);
  const nsStringClass = bridge.klass('NSString');
  const nsMenuClass = bridge.klass('NSMenu');
  const nsMenuItemClass = bridge.klass('NSMenuItem');
  const emptyString = nsStringWithUtf8(nsStringClass, selector('stringWithUTF8String:'), '');
  const toNsString = (text: string) =>
    nsStringWithUtf8(nsStringClass, selector('stringWithUTF8String:'), text);

  const idsByTag = new Map<number, string>();
  let nextTag = 1;
  const buildMenu = (entries: readonly ContextMenuItem[], title: string): Pointer => {
    const menu = initWithTitle(bridge.id(nsMenuClass, 'alloc'), selector('initWithTitle:'), toNsString(title));
    bridge.flag(menu, 'setAutoenablesItems:', false);
    for (const entry of entries) {
      if (entry.type === 'separator') {
        const sep = bridge.id(nsMenuItemClass, 'separatorItem');
        if (sep) bridge.object(menu, 'addItem:', sep);
        continue;
      }
      if (entry.type === 'submenu') {
        const item = initMenuItem(
          bridge.id(nsMenuItemClass, 'alloc'),
          selector('initWithTitle:action:keyEquivalent:'),
          toNsString(entry.label),
          null,
          emptyString,
        );
        bridge.flag(item, 'setEnabled:', entry.enabled !== false);
        bridge.object(item, 'setSubmenu:', buildMenu(entry.items ?? [], entry.label));
        bridge.object(menu, 'addItem:', item);
        continue;
      }
      const tag = nextTag++;
      idsByTag.set(tag, entry.id);
      const item = initMenuItem(
        bridge.id(nsMenuItemClass, 'alloc'),
        selector('initWithTitle:action:keyEquivalent:'),
        toNsString(entry.label),
        action,
        emptyString,
      );
      bridge.flag(item, 'setEnabled:', entry.enabled !== false);
      bridge.integer(item, 'setTag:', tag);
      bridge.object(item, 'setTarget:', target);
      bridge.object(menu, 'addItem:', item);
    }
    return menu;
  };

  macMenuSelectedTag = -1;
  const menu = buildMenu(sanitized, 'Haus');
  const point = mouseLocation(bridge.klass('NSEvent'), selector('mouseLocation'));
  popUp(menu, selector('popUpMenuPositioningItem:atLocation:inView:'), null, point, null);
  return idsByTag.get(macMenuSelectedTag) ?? null;
}

export class NativeMenuService {
  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly macPresenter: (items: readonly ContextMenuItem[]) => Promise<string | null> = (
      items,
    ) => showMacContextMenu(items),
    private readonly fallbackPresenter?: (items: readonly ContextMenuItem[]) => Promise<string | null>,
  ) {}

  async showContextMenu(items: readonly ContextMenuItem[]): Promise<string | null> {
    const sanitized = sanitizeContextMenuItems(items);
    if (sanitized.length === 0) return null;
    if (this.platform === 'darwin') {
      try {
        return await this.macPresenter(sanitized);
      } catch {
        return this.fallbackPresenter ? this.fallbackPresenter(sanitized) : null;
      }
    }
    return this.fallbackPresenter ? this.fallbackPresenter(sanitized) : null;
  }
}
