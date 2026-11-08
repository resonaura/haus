/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

const root = resolve('apps/desktop/src');

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory() ? walk(resolve(directory, entry.name)) : [resolve(directory, entry.name)],
    ),
  );
  return nested.flat();
}

const errors: string[] = [];
const files = await walk(root);

for (const file of files) {
  const path = relative(root, file).replaceAll('\\', '/');
  if (/\.module\.(css|scss)$/.test(path)) errors.push(`${path}: use global SCSS, not CSS modules`);
  if (
    path.startsWith('renderer/src/') &&
    path.endsWith('.css') &&
    path !== 'renderer/src/styles/vendor.css'
  ) {
    errors.push(`${path}: author Haus styles in SCSS`);
  }
  if (!/\.tsx?$/.test(file)) continue;
  const source = await readFile(file, 'utf8');
  const imports = [
    ...source.matchAll(
      /(?:\b(?:import|export)\s+(?:[^;'"()]*?\s+from\s*)?|\bimport\s*\(\s*)['"]([^'"]+)['"]/g,
    ),
  ];
  for (const match of imports) {
    const specifier = match[1];
    if (!specifier) continue;
    const target = specifier.startsWith('.')
      ? relative(root, resolve(dirname(file), specifier)).replaceAll('\\', '/')
      : specifier;
    if (
      path.startsWith('renderer/') &&
      (target.startsWith('main/') ||
        target.startsWith('preload/') ||
        specifier === 'electron' ||
        specifier.startsWith('node:'))
    ) {
      errors.push(`${path}: renderer must use the native bridge instead of ${specifier}`);
    }
    if (
      path.startsWith('renderer/src/model/') &&
      !path.endsWith('.test.ts') &&
      !specifier.startsWith('@haus/core/') &&
      !/^@haus\/ha\/(?:view\/|types$|light-(?:profile|color|memory)$|optimistic$|kettle-confirmation$)/.test(
        specifier,
      ) &&
      (!specifier.startsWith('.') ||
        (!target.startsWith('renderer/src/model/') &&
          !/^renderer\/src\/assets\/.*\.svg\?raw$/.test(target)))
    ) {
      errors.push(`${path}: pure model must not depend on ${specifier}`);
    }
    if (
      path.startsWith('renderer/src/components/') &&
      /^renderer\/src\/(app|features)\//.test(target)
    ) {
      errors.push(`${path}: shared components must not import application features (${specifier})`);
    }
    if (path.startsWith('main/') && /^renderer\/src\/(?!model\/)/.test(target)) {
      errors.push(`${path}: native code may share pure model code, not UI (${specifier})`);
    }
  }
}

for (const file of await walk(resolve('packages/core/src'))) {
  const source = await readFile(file, 'utf8');
  const imports = [
    ...source.matchAll(
      /(?:\b(?:import|export)\s+(?:[^;'"()]*?\s+from\s*)?|\bimport\s*\(\s*)['"]([^'"]+)['"]/g,
    ),
  ];
  for (const match of imports) {
    const specifier = match[1];
    if (specifier && !specifier.startsWith('.')) {
      errors.push(
        `${relative(resolve('.'), file)}: platform-neutral core cannot import ${specifier}`,
      );
    }
  }
}

for (const file of await walk(resolve('packages/ha/src'))) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(
    /(?:\b(?:import|export)\s+(?:[^;'"()]*?\s+from\s*)?|\bimport\s*\(\s*)['"]([^'"]+)['"]/g,
  )) {
    const specifier = match[1];
    if (!specifier) continue;
    if (/^(?:\.{1,2}\/)*(?:apps\/|.*\/apps\/)/.test(specifier) || specifier === 'electron') {
      errors.push(
        `${relative(resolve('.'), file)}: adapter must inject platform services instead of importing ${specifier}`,
      );
    }
  }
}

for (const file of await walk(resolve('packages/state/src'))) {
  const source = await readFile(file, 'utf8');
  const imports = [
    ...source.matchAll(
      /(?:\b(?:import|export)\s+(?:[^;'"()]*?\s+from\s*)?|\bimport\s*\(\s*)['"]([^'"]+)['"]/g,
    ),
  ];
  for (const match of imports) {
    const specifier = match[1];
    if (
      specifier &&
      !specifier.startsWith('.') &&
      !specifier.startsWith('@haus/core/') &&
      !['zustand/vanilla', 'zustand/middleware'].includes(specifier)
    ) {
      errors.push(
        `${relative(resolve('.'), file)}: shared state can import core and Zustand vanilla only, not ${specifier}`,
      );
    }
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `Architecture boundaries passed (${files.filter((file) => /\.tsx?$/.test(file)).length} source files).`,
  );
}
