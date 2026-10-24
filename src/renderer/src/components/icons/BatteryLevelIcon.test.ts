import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { BatteryLevelIcon } from './Icon';

it('keeps the level glyph and persistent bolt layer for animated charging transitions', () => {
  const render = (charging?: boolean) =>
    renderToStaticMarkup(createElement(BatteryLevelIcon, { level: 45, charging }));
  const idle = render(false),
    charging = render(true),
    unknown = render();
  for (const html of [idle, charging, unknown]) {
    expect(html).toContain('lucide-battery-medium');
    expect(html).toContain('battery-charge-bolt');
    expect(html).not.toContain('lucide-battery-charging');
  }
  expect(charging).toContain('battery-level-icon is-charging');
  expect(idle).not.toContain('is-charging');
  expect(unknown).not.toContain('is-charging');
});
