/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  buttonStyles,
  createHausUiTheme,
  DEFAULT_VIEWPORT,
  dialogStyles,
  HausButton,
  HausCard,
  HausCode,
  HausDialog,
  HausDisclosure,
  HausForm,
  HausMenu,
  HausProgressBar,
  HausScrollArea,
  HausSegmentedControl,
  HausSelect,
  HausSlider,
  HausSwitch,
  HausTextArea,
  HausTextField,
  HausToastQueue,
  HausToastRegion,
  HausUiProvider,
  NativeIrHostAdapter,
  resolveInteractiveStyle,
  switchStyles,
} from '../src/index.js';

describe('@haus/ui adapter-driven TSX + pure TS style system', () => {
  it('resolves pure TypeScript stylesheets and interactive states without CSS/SCSS', () => {
    const theme = createHausUiTheme('dark');
    const primary = buttonStyles.resolve(
      theme,
      { variant: 'primary', size: 'md' },
      DEFAULT_VIEWPORT,
    );
    const pressed = resolveInteractiveStyle(primary.root, { pressed: true });
    expect(pressed.transform?.scale).toBeCloseTo(0.98);

    const glassBtn = buttonStyles.resolve(
      theme,
      { variant: 'glass', size: 'sm' },
      DEFAULT_VIEWPORT,
    );
    expect(glassBtn.root.material?.kind).toBe('shader');

    const swOn = switchStyles.resolve(theme, { checked: true, size: 'md' }, DEFAULT_VIEWPORT);
    const swOff = switchStyles.resolve(theme, { checked: false, size: 'md' }, DEFAULT_VIEWPORT);
    expect(swOn.thumb.transform?.translateX).toBeGreaterThan(0);
    expect(swOff.thumb.transform?.translateX).toBe(0);

    const glassDialog = dialogStyles.resolve(
      theme,
      { size: 'adaptive', backdrop: 'liquid-glass' },
      DEFAULT_VIEWPORT,
    );
    expect(glassDialog.panel.material?.kind).toBe('shader');
  });

  it('renders TSX components through NativeIrHostAdapter for Rust/C++ GPU engines with zero HTML output', () => {
    const nativeHost = new NativeIrHostAdapter();
    const toastQueue = new HausToastQueue(3);
    toastQueue.add('Connected to Haus Hub', 'success');

    const tree = React.createElement(
      HausUiProvider,
      { mode: 'dark', host: nativeHost },
      React.createElement(
        HausCard,
        { title: 'Network', subtitle: 'Mesh router', glass: true },
        React.createElement(HausButton, { variant: 'glass', label: 'Install update' }),
        React.createElement(HausSwitch, { checked: true, label: 'Auto updates' }),
        React.createElement(HausSlider, {
          label: 'Blur strength',
          value: 0.5,
          min: 0,
          max: 1,
          step: 0.01,
        }),
        React.createElement(HausSegmentedControl, {
          value: 'dark',
          options: [
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ],
          onChange: () => undefined,
        }),
        React.createElement(HausTextField, { value: 'Haus', label: 'Home name' }),
        React.createElement(HausTextArea, { value: '{}', label: 'JSON' }),
        React.createElement(HausCode, { block: true }, 'haus.local'),
        React.createElement(HausDisclosure, { summary: 'Details' }, 'Extra info'),
        React.createElement(HausForm, { onSubmit: () => undefined }, 'Form body'),
        React.createElement(HausProgressBar, { indeterminate: true, ariaLabel: 'Measuring' }),
        React.createElement(HausMenu, {
          open: true,
          onOpenChange: () => undefined,
          trigger: React.createElement(HausButton, { label: 'Menu' }),
          items: [{ id: 'edit', label: 'Edit', onAction: () => undefined }],
        }),
        React.createElement(HausToastRegion, { queue: toastQueue }),
        React.createElement(HausSelect, {
          value: 'dock',
          options: [{ value: 'dock', label: 'Dock' }],
          onChange: () => undefined,
        }),
        React.createElement(HausScrollArea, { orientation: 'vertical' }, 'Scrollable'),
        React.createElement(
          HausDialog,
          { title: 'Confirm', backdrop: 'liquid-glass', onClose: () => undefined },
          'Body',
        ),
      ),
    );

    const html = renderToStaticMarkup(tree);
    toastQueue.destroy();

    // NativeIrHostAdapter produces pure text fragments and zero HTML tags.
    expect(html).not.toMatch(
      /<(div|span|button|input|textarea|select|option|section|form|details|summary|pre|code|hr|img|svg)\b/i,
    );

    const records = nativeHost.takeRecords();
    const kinds = new Set(records.map((r) => r.kind));
    expect(kinds.has('box')).toBe(true);
    expect(kinds.has('heading')).toBe(true);
    expect(kinds.has('text')).toBe(true);
    expect(kinds.has('button')).toBe(true);
    expect(kinds.has('switch')).toBe(true);
    expect(kinds.has('slider')).toBe(true);
    expect(kinds.has('input')).toBe(true);
    expect(kinds.has('select')).toBe(true);
    expect(kinds.has('scroll')).toBe(true);
    expect(kinds.has('modal')).toBe(true);

    // Liquid Glass card/button/dialog compile WGSL & GLSL shader passes into the native IR.
    const shaderRecords = records.filter((r) => r.shaders.length > 0);
    expect(shaderRecords.length).toBeGreaterThan(0);
    expect(shaderRecords[0]?.shaders[0]?.wgslSource).toContain('@fragment');
    expect(shaderRecords[0]?.shaders[0]?.glslSource).toContain('void main');
  });

  it('enforces zero direct HTML/SVG elements inside every @haus/ui TSX primitive source', () => {
    const primitivesDir = resolve(import.meta.dirname, '../src/primitives');
    const files = readdirSync(primitivesDir).filter((file) => file.endsWith('.tsx'));
    expect(files.length).toBeGreaterThanOrEqual(10);
    const htmlTagPattern =
      /<(div|span|button|input|textarea|select|option|section|header|footer|main|aside|nav|article|ul|ol|li|p|h[1-6]|strong|small|em|label|form|fieldset|legend|details|summary|pre|code|hr|img|svg|canvas|video|audio|a|i|b)\b/;

    for (const file of files) {
      const source = readFileSync(resolve(primitivesDir, file), 'utf8');
      expect(
        source,
        `${file} must delegate through UiHostAdapter instead of raw HTML/SVG`,
      ).not.toMatch(htmlTagPattern);
    }
  });

  it('enforces zero direct HTML/SVG/media JSX elements across all desktop renderer TSX components', () => {
    const desktopRendererDir = resolve(
      import.meta.dirname,
      '../../../apps/desktop/src/renderer/src',
    );
    const collectTsx = (dir: string): string[] => {
      const result: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) result.push(...collectTsx(full));
        else if (full.endsWith('.tsx')) result.push(full);
      }
      return result;
    };
    const tsxFiles = collectTsx(desktopRendererDir);
    expect(tsxFiles.length).toBeGreaterThanOrEqual(200);
    const jsxHtmlOrSvgPattern =
      /<\/?(div|span|p|a|button|input|select|option|textarea|label|form|section|header|footer|main|aside|nav|article|h[1-6]|ul|ol|li|dl|dt|dd|table|thead|tbody|tr|th|td|colgroup|col|fieldset|legend|img|svg|path|circle|rect|line|polyline|polygon|g|defs|linearGradient|radialGradient|stop|clipPath|mask|text|video|canvas|audio|iframe|details|summary|dialog|hr|br|pre|code|strong|em|small|b|i|u|kbd|time|output|datalist|meter|progress)(?=[\s/>])/;

    for (const file of tsxFiles) {
      const stripped = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/`(?:\\.|[^`\\])*`/g, '');
      expect(
        stripped,
        `${file} must render through @haus/ui adapter primitives with zero raw HTML/SVG/media JSX`,
      ).not.toMatch(jsxHtmlOrSvgPattern);
    }
  });
});
