/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { mergeStyleSpecs, type UiStyleSpec } from '../ir/index.js';
import { TailwindAstCompiler } from './tailwind-parser.js';

export interface ParsedHeroUiBlock {
  readonly selector: string;
  readonly applyClasses: readonly string[];
  readonly customProperties: Readonly<Record<string, string>>;
  readonly compiledStyle: UiStyleSpec;
}

export interface ParsedHeroUiThemeVariables {
  readonly common: Readonly<Record<string, string>>;
  readonly light: Readonly<Record<string, string>>;
  readonly dark: Readonly<Record<string, string>>;
}

export interface ParsedHeroUiTvRecipe {
  readonly componentName: string;
  readonly baseClass?: string;
  readonly slots: Readonly<Record<string, string>>;
  readonly defaultVariants: Readonly<Record<string, string | boolean>>;
  readonly variantClassMap: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/**
 * Pure TypeScript OOP compiler that ingests HeroUI v3 `.css` / `.styles.ts` and
 * Haus theme SCSS sources, converting their `@apply` Tailwind directives, CSS variables,
 * and `tv({...})` variant trees into `@haus/ui` `UiStyleSpec` and `StyleRecipe` definitions.
 */
export class HeroUiSourceCompiler {
  private readonly tailwind: TailwindAstCompiler;

  constructor(tailwind = new TailwindAstCompiler()) {
    this.tailwind = tailwind;
  }

  /** Extracts `@apply` classes and `--custom-prop` tokens per selector from HeroUI CSS. */
  compileComponentCss(cssSource: string): ReadonlyMap<string, ParsedHeroUiBlock> {
    const blocks = new Map<string, ParsedHeroUiBlock>();
    const clean = cssSource.replace(/\/\*[\s\S]*?\*\//g, '');
    const ruleRegex = /([.#][a-zA-Z0-9_-]+)\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;

    for (const match of clean.matchAll(ruleRegex)) {
      const selector = match[1]!.trim();
      const body = match[2]!;
      const topLevelLines = body.replace(/&[^{]*\{[^{}]*\}/g, '').split(';');
      const applyClasses: string[] = [];
      const customProperties: Record<string, string> = {};

      for (const rawLine of topLevelLines) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith('@apply ')) {
          const classes = line
            .slice('@apply '.length)
            .split(/\s+/)
            .map((token) => token.trim())
            .filter(Boolean);
          applyClasses.push(...classes);
        } else {
          const propMatch = /^(--[a-zA-Z0-9_-]+)\s*:\s*(.+)$/.exec(line);
          if (propMatch) {
            customProperties[propMatch[1]!] = propMatch[2]!.trim();
          }
        }
      }

      const compiledStyle = this.tailwind.compileClassList(applyClasses);
      const existing = blocks.get(selector);
      blocks.set(selector, {
        selector,
        applyClasses: existing ? [...existing.applyClasses, ...applyClasses] : applyClasses,
        customProperties: existing
          ? { ...existing.customProperties, ...customProperties }
          : customProperties,
        compiledStyle: existing
          ? mergeStyleSpecs(existing.compiledStyle, compiledStyle)
          : compiledStyle,
      });
    }

    return blocks;
  }

  /** Extracts common, light, and dark CSS variables from HeroUI or Haus theme files. */
  parseThemeVariables(cssOrScssSource: string): ParsedHeroUiThemeVariables {
    const clean = cssOrScssSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const common: Record<string, string> = {};
    const light: Record<string, string> = {};
    const dark: Record<string, string> = {};

    const blockRegex = /([^{}]+)\{([^{}]+)\}/g;
    for (const match of clean.matchAll(blockRegex)) {
      const rawSelector = match[1]!.trim();
      const body = match[2]!;
      const isDark = /\.dark|data-theme=['"]dark['"]/.test(rawSelector);
      const isLight = /\.light|data-theme=['"]light['"]/.test(rawSelector);
      const target = isDark ? dark : isLight ? light : common;

      for (const propMatch of body.matchAll(/(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g)) {
        target[propMatch[1]!.trim()] = propMatch[2]!.trim();
      }
    }

    return { common, light, dark };
  }

  /** Parses HeroUI `tv({...})` TypeScript source files into structured variant/slot metadata. */
  parseTvStylesFile(componentName: string, tsSource: string): ParsedHeroUiTvRecipe {
    const baseMatch = /\bbase\s*:\s*["']([^"']+)["']/.exec(tsSource);
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

    const variantClassMap: Record<string, Record<string, string>> = {};
    const variantsIdx = tsSource.indexOf('variants:');
    if (variantsIdx >= 0) {
      const slice = tsSource.slice(variantsIdx);
      const groupRegex = /([a-zA-Z0-9_]+)\s*:\s*\{([^{}]+)\}/g;
      for (const group of slice.matchAll(groupRegex)) {
        const groupName = group[1]!;
        if (groupName === 'variants' || groupName === 'defaultVariants' || groupName === 'slots') {
          continue;
        }
        const entries: Record<string, string> = {};
        for (const item of group[2]!.matchAll(
          /(?:["']([^"']+)["']|([a-zA-Z0-9_]+))\s*:\s*["']([^"']*)["']/g,
        )) {
          const key = item[1] ?? item[2];
          if (key) entries[key] = item[3]!;
        }
        if (Object.keys(entries).length > 0) {
          variantClassMap[groupName] = entries;
        }
      }
    }

    return {
      componentName,
      ...(baseMatch?.[1] ? { baseClass: baseMatch[1] } : {}),
      slots,
      defaultVariants,
      variantClassMap,
    };
  }
}
