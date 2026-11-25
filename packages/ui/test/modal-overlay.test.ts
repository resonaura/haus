/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HausModalOverlay, HausUiProvider } from '../src/index.js';

function renderOverlay(node: React.ReactElement): string {
  return renderToStaticMarkup(React.createElement(HausUiProvider, null, node));
}

describe('HausModalOverlay container size propagation', () => {
  it('propagates size="cover" to full-viewport container, dialog, and overlay close trigger without clobbering className padding', () => {
    const html = renderOverlay(
      React.createElement(
        HausModalOverlay.Backdrop,
        { isOpen: true, onOpenChange: () => {} },
        React.createElement(
          HausModalOverlay.Container,
          { size: 'cover', className: 'camera-modal-container' },
          React.createElement(
            HausModalOverlay.Dialog,
            { className: 'camera-dialog camera-viewer' },
            React.createElement(HausModalOverlay.CloseTrigger, null),
            React.createElement('div', null, 'Camera body'),
          ),
        ),
      ),
    );

    const containerMatch = /<div class="modal__container camera-modal-container"([^>]*)>/.exec(html);
    expect(containerMatch).not.toBeNull();
    expect(containerMatch?.[1]).toContain('position:fixed');
    expect(containerMatch?.[1]).toContain('width:100%');
    expect(containerMatch?.[1]).toContain('height:100%');
    expect(containerMatch?.[1]).toContain('align-items:stretch');
    expect(containerMatch?.[1]).not.toContain('padding-top');

    const dialogMatch = /<section[^>]*class="modal__dialog camera-dialog camera-viewer"([^>]*)>/.exec(
      html,
    );
    expect(dialogMatch).not.toBeNull();
    expect(dialogMatch?.[1]).toContain('width:100%');
    expect(dialogMatch?.[1]).toContain('height:100%');
    expect(dialogMatch?.[1]).toContain('max-height:100%');

    const closeMatch = /<button[^>]*class="modal__close-trigger"([^>]*)>/.exec(html);
    expect(closeMatch).not.toBeNull();
    expect(closeMatch?.[1]).toContain('z-index:12');
    expect(closeMatch?.[1]).toContain('width:38px');
    expect(closeMatch?.[1]).toContain('height:38px');
    expect(closeMatch?.[1]).toContain('top:22px');
    expect(closeMatch?.[1]).toContain('right:24px');
  });

  it('propagates size="lg" from ModalContainer to ModalDialog', () => {
    const html = renderOverlay(
      React.createElement(
        HausModalOverlay.Backdrop,
        { isOpen: true, onOpenChange: () => {} },
        React.createElement(
          HausModalOverlay.Container,
          { size: 'lg' },
          React.createElement(
            HausModalOverlay.Dialog,
            null,
            React.createElement('div', null, 'Large dialog'),
          ),
        ),
      ),
    );

    const dialogMatch = /<section[^>]*class="modal__dialog"([^>]*)>/.exec(html);
    expect(dialogMatch).not.toBeNull();
    expect(dialogMatch?.[1]).toContain('clamp(520px, 86vw, 780px)');
  });
});
