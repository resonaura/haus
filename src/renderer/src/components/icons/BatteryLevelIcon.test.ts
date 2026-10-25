import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { BatteryLevelIcon } from './Icon';

it('renders a horizontal battery and keeps its bolt layer for charging transitions', () => {
  const render = (charging?: boolean) =>
    renderToStaticMarkup(createElement(BatteryLevelIcon, { level: 45, charging }));
  const idle = render(false),
    charging = render(true),
    unknown = render();
  for (const html of [idle, charging, unknown]) {
    expect(html).toContain('battery-level-shell');
    expect(html).toContain('battery-level-fill');
    expect(html).toContain('battery-level-terminal');
    expect(html).toContain('battery-charge-bolt');
    expect(html).not.toContain('battery-level-percentage');
    expect(html).not.toContain('lucide-battery');
  }
  expect(charging).toContain('battery-level-icon is-charging');
  expect(idle).not.toContain('is-charging');
  expect(unknown).not.toContain('is-charging');
});

it('shows external power even after a full battery stops actively charging', () => {
  const html = renderToStaticMarkup(
    createElement(BatteryLevelIcon, { level: 100, charging: false, powerConnected: true }),
  );
  expect(html).toContain('battery-level-icon is-charging');
});
