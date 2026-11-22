/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { terminalTheme } from './theme';

export interface MountedXterm {
  readonly term: Terminal;
  readonly search: SearchAddon;
  readonly applyFit: () => void;
  readonly settledFit: () => Promise<boolean>;
  readonly dispose: () => void;
}

export function mountXterm(params: {
  readonly node: HTMLDivElement;
  readonly isActive: () => boolean;
  readonly readOnly?: boolean;
  readonly onGeometry: (geometry: { cols: number; rows: number }) => void;
  readonly onSearchResult: (result: { resultIndex: number; resultCount: number }) => void;
  readonly onOpenSearch: () => void;
  readonly onOpenLink: (uri: string) => void;
}): MountedXterm {
  const {
    node,
    isActive,
    readOnly = false,
    onGeometry,
    onSearchResult,
    onOpenSearch,
    onOpenLink,
  } = params;
  const term = new Terminal({
    allowProposedApi: true,
    allowTransparency: false,
    convertEol: false,
    disableStdin: readOnly,
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: !readOnly,
    cursorStyle: 'bar',
    cursorInactiveStyle: readOnly ? 'none' : 'outline',
    scrollback: readOnly ? 5000 : 3000,
    theme: terminalTheme(),
    drawBoldTextInBrightColors: false,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(node);

  const search = new SearchAddon({ highlightLimit: 1000 });
  term.loadAddon(search);
  const searchResults = search.onDidChangeResults(onSearchResult);
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = '11';
  term.loadAddon(
    new WebLinksAddon((event, uri) => {
      event.preventDefault();
      if (/^https?:\/\//i.test(uri)) onOpenLink(uri);
    }),
  );

  term.attachCustomKeyEventHandler((event) => {
    const command = /Mac/.test(navigator.platform) ? event.metaKey : event.ctrlKey;
    if (event.type === 'keydown' && command && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      onOpenSearch();
      return false;
    }
    if (
      event.type === 'keydown' &&
      command &&
      event.key.toLowerCase() === 'c' &&
      term.hasSelection()
    ) {
      event.preventDefault();
      void navigator.clipboard.writeText(term.getSelection());
      return false;
    }
    if (event.type === 'keydown' && event.metaKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      term.clear();
      return false;
    }
    return true;
  });

  let disposed = false;
  let frame = 0;
  let fontReady = false;
  let lastWidth = -1;
  let lastHeight = -1;

  const applyFit = () => {
    if (disposed || !isActive() || !fontReady || node.clientWidth < 32 || node.clientHeight < 32) {
      return;
    }
    const proposed = fit.proposeDimensions();
    if (!proposed || proposed.cols < 2 || proposed.rows < 1) return;
    const cols = Math.min(500, proposed.cols);
    const rows = Math.min(300, Math.max(1, proposed.rows - 1));
    if (cols !== term.cols || rows !== term.rows) term.resize(cols, rows);
    onGeometry({ cols, rows });
  };

  const settle = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (disposed || !isActive()) return;
      const width = node.clientWidth;
      const height = node.clientHeight;
      if (width < 32 || height < 32) return;
      if (width !== lastWidth || height !== lastHeight) {
        lastWidth = width;
        lastHeight = height;
        settle();
        return;
      }
      applyFit();
    });
  };

  const settledFit = async (): Promise<boolean> => {
    await document.fonts.ready;
    let width = -1;
    let height = -1;
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (disposed || !isActive()) return false;
      if (
        node.clientWidth >= 32 &&
        node.clientHeight >= 32 &&
        node.clientWidth === width &&
        node.clientHeight === height
      ) {
        fontReady = true;
        applyFit();
        return true;
      }
      width = node.clientWidth;
      height = node.clientHeight;
    }
    return false;
  };

  const observer = new ResizeObserver(settle);
  observer.observe(node);
  void document.fonts.ready.then(() => {
    if (!disposed) {
      fontReady = true;
      settle();
    }
  });
  const theme = new MutationObserver(() => {
    term.options.theme = terminalTheme();
    settle();
  });
  theme.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme'],
  });
  document.fonts.addEventListener('loadingdone', settle);
  window.addEventListener('resize', settle);

  return {
    term,
    search,
    applyFit,
    settledFit,
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      theme.disconnect();
      window.removeEventListener('resize', settle);
      document.fonts.removeEventListener('loadingdone', settle);
      searchResults.dispose();
      term.dispose();
    },
  };
}
