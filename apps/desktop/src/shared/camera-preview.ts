/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

const demoSceneKeys = ['entryway', 'garden', 'living-room'] as const;
export type DemoSceneKey = (typeof demoSceneKeys)[number];

export function resolveDemoSceneKey(scene: unknown, index = 0): DemoSceneKey {
  if (scene === 'front-door') return 'entryway';
  if (scene === 'garden' || scene === 'living-room') return scene;
  return demoSceneKeys[index % demoSceneKeys.length] ?? 'entryway';
}
