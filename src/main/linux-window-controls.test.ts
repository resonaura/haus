import { expect, it } from 'vitest';
import { kiwiControlsEnabled } from './linux-window-controls';
it('uses traffic lights only for an active Kiwi extension with app buttons enabled', () => {
  const enabled = "['kiwi@kemma']",
    active = "({'state': <1>},)";
  expect(kiwiControlsEnabled(enabled, 'false', active, 'true')).toBe(true);
  expect(kiwiControlsEnabled(enabled, 'false', "{'state': <1.0>}", 'true')).toBe(true);
  expect(kiwiControlsEnabled(enabled, 'false', "{'state': <uint32 1>}", 'true')).toBe(true);
  expect(kiwiControlsEnabled(enabled, 'false', "{'state': <11>}", 'true')).toBe(false);
  expect(kiwiControlsEnabled("['fake-kiwi@kemma']", 'false', active, 'true')).toBe(false);
  expect(kiwiControlsEnabled(enabled, 'true', active, 'true')).toBe(false);
  expect(kiwiControlsEnabled(enabled, 'false', "{'state': <3>}", 'true')).toBe(false);
  expect(kiwiControlsEnabled(enabled, 'false', active, 'false')).toBe(false);
});
