import { expect, it } from 'vitest';
import { kiwiControlsEnabled, yuzuosControlsEnabled } from './linux-window-controls';
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

it('uses traffic lights for an active YuzuOS extension when titlebar style is not off', () => {
  const enabled = "['yuzuos@resonaura.local']",
    active = "({'state': <1>},)";
  expect(yuzuosControlsEnabled(enabled, 'false', active, "'classic'")).toBe(true);
  expect(yuzuosControlsEnabled(enabled, 'false', active, "'glass'")).toBe(true);
  expect(yuzuosControlsEnabled(enabled, 'false', active, "'alternate'")).toBe(true);
  expect(yuzuosControlsEnabled(enabled, 'false', active, 'classic')).toBe(true);
  expect(yuzuosControlsEnabled(enabled, 'false', active, "'off'")).toBe(false);
  expect(yuzuosControlsEnabled(enabled, 'false', active, 'off')).toBe(false);
  expect(yuzuosControlsEnabled(enabled, 'true', active, "'classic'")).toBe(false);
  expect(yuzuosControlsEnabled("['other@extension']", 'false', active, "'classic'")).toBe(false);
});
