/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import { renderCommandTemplate } from '../src/discovery/command-template.js';

it('renders bounded scalar HA value filters and conditionals without evaluating code', () => {
  expect(renderCommandTemplate('{{ value | float | round(0) | int }}', '82.7')).toEqual({
    kind: 'value',
    payload: '83',
  });
  expect(renderCommandTemplate("{{ value if value == 'off' else 'on' }}", 'off')).toEqual({
    kind: 'value',
    payload: 'off',
  });
  expect(renderCommandTemplate('mode={{ value | lower }}', 'HEAT')).toEqual({
    kind: 'value',
    payload: 'mode=heat',
  });
  expect(renderCommandTemplate('{{ value | default("idle") }}', null)).toEqual({
    kind: 'value',
    payload: 'idle',
  });
});

it('refuses unsupported Jinja expressions, blocks, malformed syntax, and non-scalars', () => {
  expect(renderCommandTemplate('{{ value_json.state }}', 'ON')).toEqual({ kind: 'unsupported' });
  expect(renderCommandTemplate('{% if value %}ON{% endif %}', 'ON')).toEqual({
    kind: 'unsupported',
  });
  expect(renderCommandTemplate('{{ value', 'ON')).toEqual({ kind: 'unsupported' });
  expect(renderCommandTemplate('{{ value }}', { state: 'ON' })).toEqual({ kind: 'unsupported' });
  expect(renderCommandTemplate('x'.repeat(1025), 'ON')).toEqual({ kind: 'unsupported' });
  expect(renderCommandTemplate('{{ value }}', 'x'.repeat(4097))).toEqual({ kind: 'unsupported' });
});
