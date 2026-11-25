/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

const RESET_STYLE_ATTR = 'data-haus-ui-reset';

/**
 * Zero-specificity (`:where(...)`) full browser UA reset for all semantic HTML tags
 * emitted by `@haus/ui`'s DOM host adapter. Because `:where(...)` carries `(0, 0, 0)`
 * specificity, inline `@haus/ui` styles and component/utility layers always win cleanly
 * without UA margins, button chrome, list bullets, or fieldset borders leaking through.
 */
export const HAUS_DOM_RESET_CSS = `
:where(*, *::before, *::after) {
  box-sizing: border-box;
  border: 0 solid transparent;
}
:where(html, body) {
  margin: 0;
  padding: 0;
  -webkit-text-size-adjust: 100%;
}
:where(h1, h2, h3, h4, h5, h6, p, blockquote, figure, pre, dl, dd, ul, ol, hr, fieldset) {
  margin: 0;
}
:where(h1, h2, h3, h4, h5, h6) {
  font-size: inherit;
  font-weight: inherit;
}
:where(ul, ol) {
  list-style: none;
  padding: 0;
}
:where(fieldset, legend) {
  padding: 0;
}
:where(button, input, select, textarea) {
  font: inherit;
  letter-spacing: inherit;
  color: inherit;
  background-color: transparent;
  margin: 0;
  padding: 0;
}
:where(button, [role='button']) {
  appearance: none;
  -webkit-appearance: none;
  text-align: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
:where(button:disabled, input:disabled, select:disabled, textarea:disabled) {
  cursor: default;
}
:where(a) {
  color: inherit;
  text-decoration: none;
}
:where(img, svg, video, canvas, audio, iframe) {
  display: block;
  max-width: 100%;
}
:where(svg) {
  flex-shrink: 0;
}
:where(table) {
  border-collapse: collapse;
  border-spacing: 0;
}
:where(th) {
  text-align: inherit;
  font-weight: inherit;
}
:where(small) {
  font-size: inherit;
}
:where(strong, b) {
  font-weight: 600;
}
:where(i, em) {
  font-style: normal;
}
:where(summary) {
  list-style: none;
  cursor: pointer;
}
:where(summary::-webkit-details-marker) {
  display: none;
}
`.trim();

/** Idempotently prepends the zero-specificity `@haus/ui` DOM tag reset into `<head>`. */
export function ensureDomResetStyle(doc?: Document): void {
  const targetDoc = doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!targetDoc?.head) return;
  if (targetDoc.head.querySelector(`style[${RESET_STYLE_ATTR}]`)) return;
  const style = targetDoc.createElement('style');
  style.setAttribute(RESET_STYLE_ATTR, '1');
  style.textContent = HAUS_DOM_RESET_CSS;
  targetDoc.head.prepend(style);
}
