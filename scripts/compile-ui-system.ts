/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { emitCompiledRecipesTs, emitCompiledTokensTs } from './ui-compiler/emitters.ts';

interface ParsedThemeVars {
  readonly common: Record<string, string>;
  readonly light: Record<string, string>;
  readonly dark: Record<string, string>;
}

function parseThemeVariables(cssOrScssSource: string): ParsedThemeVars {
  const clean = cssOrScssSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const common: Record<string, string> = {};
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  for (const match of clean.matchAll(/([^{}]+)\{([^{}]+)\}/g)) {
    const rawSelector = match[1]!.trim();
    const isDark = /\.dark|data-theme=['"]dark['"]/.test(rawSelector);
    const isLight = /\.light|data-theme=['"]light['"]/.test(rawSelector);
    const target = isDark ? dark : isLight ? light : common;
    for (const propMatch of match[2]!.matchAll(/(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g)) {
      target[propMatch[1]!.trim()] = propMatch[2]!.trim();
    }
  }
  return { common, light, dark };
}

function parseTvStylesFile(tsSource: string): {
  readonly slots: Record<string, string>;
  readonly defaultVariants: Record<string, string | boolean>;
  readonly variantNames: string[];
} {
  const slots: Record<string, string> = {};
  const slotsBlock = /\bslots\s*:\s*\{([^{}]+)\}/.exec(tsSource);
  if (slotsBlock) {
    for (const m of slotsBlock[1]!.matchAll(/([a-zA-Z0-9_]+)\s*:\s*["']([^"']+)["']/g)) {
      slots[m[1]!] = m[2]!;
    }
  }
  const defaultVariants: Record<string, string | boolean> = {};
  const defaultsBlock = /\bdefaultVariants\s*:\s*\{([^{}]+)\}/.exec(tsSource);
  if (defaultsBlock) {
    for (const m of defaultsBlock[1]!.matchAll(
      /([a-zA-Z0-9_]+)\s*:\s*(?:["']([^"']+)["']|(true|false))/g,
    )) {
      defaultVariants[m[1]!] = m[3] !== undefined ? m[3] === 'true' : m[2]!;
    }
  }
  const variantNames: string[] = [];
  const variantsIdx = tsSource.indexOf('variants:');
  if (variantsIdx >= 0) {
    for (const group of tsSource.slice(variantsIdx).matchAll(/([a-zA-Z0-9_]+)\s*:\s*\{[^{}]+\}/g)) {
      const name = group[1]!;
      if (!['variants', 'defaultVariants', 'slots'].includes(name) && !variantNames.includes(name)) {
        variantNames.push(name);
      }
    }
  }
  return { slots, defaultVariants, variantNames };
}

const ROOT = resolve(import.meta.dirname, '..');
const HEROUI_STYLES_DIR = resolve(ROOT, 'apps/desktop/node_modules/@heroui/styles');
const HAUS_TOKENS_SCSS = resolve(ROOT, 'apps/desktop/src/renderer/src/styles/theme/_tokens.scss');
const HAUS_MATERIALS_SCSS = resolve(ROOT, 'apps/desktop/src/renderer/src/styles/materials.scss');
const OUT_DIR = resolve(ROOT, 'packages/ui/src/generated');

const TARGET_COMPONENTS = [
  'button',
  'card',
  'modal',
  'tabs',
  'switch',
  'slider',
  'badge',
  'chip',
  'input',
  'select',
  'alert',
  'meter',
] as const;

function readIfExists(filePath: string): string {
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
}

function main(): void {
  const hash = createHash('sha256');
  const herouiVarsCss = readIfExists(
    resolve(HEROUI_STYLES_DIR, 'dist/themes/default/variables.css'),
  );
  const hausTokensScss = readIfExists(HAUS_TOKENS_SCSS);
  const hausMaterialsScss = readIfExists(HAUS_MATERIALS_SCSS);

  hash.update(herouiVarsCss).update(hausTokensScss).update(hausMaterialsScss);

  const herouiTheme = parseThemeVariables(herouiVarsCss);
  const hausTheme = parseThemeVariables(`${hausTokensScss}\n${hausMaterialsScss}`);

  const parsedComponents: Array<{
    name: string;
    variants: readonly string[];
    defaults: Readonly<Record<string, string | boolean>>;
    slots: Readonly<Record<string, string>>;
  }> = [];

  for (const name of TARGET_COMPONENTS) {
    const cssPath = resolve(HEROUI_STYLES_DIR, `dist/components/${name}.css`);
    const tsPath = resolve(HEROUI_STYLES_DIR, `src/components/${name}/${name}.styles.ts`);
    const cssSource = readIfExists(cssPath);
    const tsSource = readIfExists(tsPath);
    hash.update(cssSource).update(tsSource);
    const tvMeta = parseTvStylesFile(tsSource);
    parsedComponents.push({
      name,
      variants: tvMeta.variantNames,
      defaults: tvMeta.defaultVariants,
      slots: tvMeta.slots,
    });
  }

  const sourceDigest = `sha256:${hash.digest('hex').slice(0, 16)}`;
  const radii = {
    radiusCard: Number.parseInt(hausTheme.common['--radius-card'] ?? '26', 10) || 26,
    radiusPanel: Number.parseInt(hausTheme.common['--radius-panel'] ?? '34', 10) || 34,
    radiusField: Number.parseInt(hausTheme.common['--radius-field'] ?? '14', 10) || 14,
    radiusControl: Number.parseInt(hausTheme.common['--radius-control'] ?? '14', 10) || 14,
  };

  const manifestLines = parsedComponents
    .map(
      (c) =>
        `  { name: '${c.name}', slots: ${JSON.stringify(Object.keys(c.slots))}, variants: ${JSON.stringify(c.variants)}, defaults: ${JSON.stringify(c.defaults)} },`,
    )
    .join('\n');

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    resolve(OUT_DIR, 'heroui-tokens.ts'),
    emitCompiledTokensTs({
      sourceDigest,
      herouiVariableCount:
        Object.keys(herouiTheme.common).length + Object.keys(herouiTheme.light).length,
      hausVariableCount:
        Object.keys(hausTheme.common).length +
        Object.keys(hausTheme.light).length +
        Object.keys(hausTheme.dark).length,
      compiledComponentCount: parsedComponents.length,
      radii,
    }),
    'utf8',
  );
  writeFileSync(
    resolve(OUT_DIR, 'heroui-recipes.ts'),
    emitCompiledRecipesTs({ sourceDigest, manifestLines, radii }),
    'utf8',
  );

  console.log(
    `[ui:compile] Compiled ${parsedComponents.length} HeroUI + Tailwind component recipes and Haus theme palettes (${sourceDigest}) -> packages/ui/src/generated/`,
  );
}

main();
