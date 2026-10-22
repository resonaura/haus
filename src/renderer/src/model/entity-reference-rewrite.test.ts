import { describe, expect, it } from 'vitest';
import { entityReferenceHits, rewriteEntityReferences } from './entity-reference-rewrite';

describe('Home Assistant entity reference rewrite', () => {
  it('finds IDs in nested config and template strings and preserves unrelated data', () => {
    const input = {
      trigger: [{ entity_id: ['water_heater.kitchen_kettle_2'] }],
      action: [{ data: { value: "{{ states('water_heater.kitchen_kettle_2') }}" } }],
      other: 'water_heater.kitchen_kettle',
    };
    expect(entityReferenceHits(input, 'water_heater.kitchen_kettle_2')).toHaveLength(2);
    expect(
      rewriteEntityReferences(
        input,
        'water_heater.kitchen_kettle_2',
        'water_heater.kitchen_kettle',
      ),
    ).toEqual({
      trigger: [{ entity_id: ['water_heater.kitchen_kettle'] }],
      action: [{ data: { value: "{{ states('water_heater.kitchen_kettle') }}" } }],
      other: 'water_heater.kitchen_kettle',
    });
  });
  it('does not rewrite a different entity sharing an ID prefix or a lookalike domain separator', () => {
    const input = {
      samePrefix: 'water_heater.kitchen_kettle_20',
      suffix: 'water_heater.kitchen_kettle_2_backup',
      lookalike: 'water_heaterXkitchen_kettle_2',
      template: '{{ states.water_heater.kitchen_kettle_2.state }}',
    };
    expect(entityReferenceHits(input, 'water_heater.kitchen_kettle_2')).toHaveLength(1);
    expect(
      rewriteEntityReferences(
        input,
        'water_heater.kitchen_kettle_2',
        'water_heater.kitchen_kettle',
      ),
    ).toEqual({ ...input, template: '{{ states.water_heater.kitchen_kettle.state }}' });
  });

  it('migrates scene entity keys and nested templates without changing the original config', () => {
    const input = { entities: { 'water_heater.kitchen_kettle_2': { state: 'off' } } };
    expect(entityReferenceHits(input, 'water_heater.kitchen_kettle_2')).toHaveLength(1);
    expect(
      rewriteEntityReferences(
        input,
        'water_heater.kitchen_kettle_2',
        'water_heater.kitchen_kettle',
      ),
    ).toEqual({ entities: { 'water_heater.kitchen_kettle': { state: 'off' } } });
    expect(input.entities).toHaveProperty('water_heater.kitchen_kettle_2');
  });

  it('refuses to overwrite existing scene settings at the destination ID', () => {
    const input = {
      entities: {
        'water_heater.kitchen_kettle_2': { state: 'off' },
        'water_heater.kitchen_kettle': { state: 'heat' },
      },
    };
    expect(() =>
      rewriteEntityReferences(
        input,
        'water_heater.kitchen_kettle_2',
        'water_heater.kitchen_kettle',
      ),
    ).toThrow('Both');
    expect(Object.keys(input.entities)).toHaveLength(2);
  });
});
