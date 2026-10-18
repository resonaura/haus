import { describe, expect, it } from 'vitest';
import { schemaDefaults, translationStrings } from './management';

describe('server form defaults', () => {
  it('reads both nested and flattened translation resources from Home Assistant', () => {
    expect(
      translationStrings({
        component: { hue: { title: 'Philips Hue' } },
        'component.ipp.title': 'Internet Printing Protocol',
      }),
    ).toEqual({
      'component.hue.title': 'Philips Hue',
      'component.ipp.title': 'Internet Printing Protocol',
    });
  });
  it('keeps false, zero and list defaults, and leaves optional fields unset', () => {
    expect(
      schemaDefaults([
        { name: 'enabled', type: 'boolean', default: false },
        { name: 'port', type: 'integer', default: 0 },
        { name: 'devices', selector: { device: { multiple: true } }, default: ['one'] },
        { name: 'optional', type: 'string' },
        { name: 'required_flag', required: true, selector: { boolean: {} } },
        { name: 'suggested', description: { suggested_value: 'local-device' } },
        { name: 'nested', schema: [{ name: 'count', default: 3 }] },
      ]),
    ).toEqual({
      enabled: false,
      port: 0,
      devices: ['one'],
      required_flag: false,
      suggested: 'local-device',
      nested: { count: 3 },
    });
  });
});
