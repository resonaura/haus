/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type DemoSceneKey = 'entryway' | 'garden' | 'living-room';

const embeddedDemoAssets: Partial<Record<DemoSceneKey, string>> = {};
const cachedAssets = new Map<DemoSceneKey, string>();

const fallbackSvgs: Record<DemoSceneKey, string> = {
  entryway:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#2c241d"/><stop offset="55%" stop-color="#473422"/><stop offset="100%" stop-color="#141312"/></linearGradient><radialGradient id="l" cx="52%" cy="32%" r="48%"><stop offset="0%" stop-color="#f6c786" stop-opacity="0.48"/><stop offset="100%" stop-color="#f6c786" stop-opacity="0"/></radialGradient></defs><rect width="320" height="180" fill="url(#g)"/><rect width="320" height="180" fill="url(#l)"/></svg>',
  garden:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#13221c"/><stop offset="55%" stop-color="#1f3a2c"/><stop offset="100%" stop-color="#0e1412"/></linearGradient><radialGradient id="l" cx="72%" cy="28%" r="55%"><stop offset="0%" stop-color="#8ec7a6" stop-opacity="0.38"/><stop offset="100%" stop-color="#8ec7a6" stop-opacity="0"/></radialGradient></defs><rect width="320" height="180" fill="url(#g)"/><rect width="320" height="180" fill="url(#l)"/></svg>',
  'living-room':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#1b2029"/><stop offset="55%" stop-color="#312b28"/><stop offset="100%" stop-color="#111216"/></linearGradient><radialGradient id="l" cx="38%" cy="35%" r="52%"><stop offset="0%" stop-color="#f1b47b" stop-opacity="0.42"/><stop offset="100%" stop-color="#f1b47b" stop-opacity="0"/></radialGradient></defs><rect width="320" height="180" fill="url(#g)"/><rect width="320" height="180" fill="url(#l)"/></svg>',
};

function candidateImagePath(key: DemoSceneKey): string | undefined {
  const filename = `${key}.jpg`;
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(moduleDir, '../../renderer/public/images', filename),
    resolve(process.cwd(), 'apps/desktop/src/renderer/public/images', filename),
    resolve(process.cwd(), 'src/renderer/public/images', filename),
    join(dirname(process.execPath), 'images', filename),
  ];
  return candidates.find((path) => existsSync(path));
}

export function resolveDemoSceneKey(
  demoScene: string | undefined,
  index = 0,
): DemoSceneKey {
  if (demoScene === 'front-door') return 'entryway';
  if (demoScene === 'garden') return 'garden';
  if (demoScene === 'living-room') return 'living-room';
  return (['entryway', 'garden', 'living-room'] as const)[index % 3];
}

export function demoCameraPreviewSrc(demoScene: string | undefined, index = 0): string {
  const key = resolveDemoSceneKey(demoScene, index);
  const embedded = embeddedDemoAssets[key];
  if (embedded) return embedded;
  const cached = cachedAssets.get(key);
  if (cached) return cached;
  const assetPath = candidateImagePath(key);
  if (assetPath) {
    try {
      const encoded = `data:image/jpeg;base64,${readFileSync(assetPath).toString('base64')}`;
      cachedAssets.set(key, encoded);
      return encoded;
    } catch {
      /* Fall back cleanly to synthesized preview gradient when asset is external or unreadable. */
    }
  }
  const fallback = `data:image/svg+xml,${encodeURIComponent(fallbackSvgs[key])}`;
  cachedAssets.set(key, fallback);
  return fallback;
}
