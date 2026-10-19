import { describe, expect, it, vi } from 'vitest';
import { saveConfig } from './config-editor';
describe('configuration editing', () => {
  it('preserves advanced automation fields and never triggers the automation while saving', async () => {
    const original = {
      alias: 'Narnia',
      trigger: [{ platform: 'time', at: '23:00:00' }],
      action: [{ choose: [{ conditions: [], sequence: [] }] }],
      variables: { custom: 7 },
      mode: 'queued',
    };
    const management = vi
      .fn()
      .mockResolvedValueOnce(structuredClone(original))
      .mockResolvedValueOnce({});
    await saveConfig(
      { management },
      'automation',
      'narnia',
      { ...original, alias: 'Narnia evening' },
      original,
    );
    expect(management).toHaveBeenLastCalledWith({
      method: 'POST',
      path: 'config/automation/config/narnia',
      data: { ...original, alias: 'Narnia evening' },
    });
    expect(management).toHaveBeenCalledTimes(2);
  });
  it('refuses to overwrite an item changed in Home Assistant since it was opened', async () => {
    const original = {
      name: 'Narnia',
      entities: { 'light.narnia': { state: 'off', transition: 4 } },
    };
    const management = vi.fn().mockResolvedValue({ ...original, name: 'Edited elsewhere' });
    await expect(
      saveConfig({ management }, 'scene', 'narnia', { ...original, name: 'My edit' }, original),
    ).rejects.toThrow('changed in Home Assistant');
    expect(management).toHaveBeenCalledTimes(1);
  });
  it('saves all scene parameters while changing the title', async () => {
    const original = {
      name: 'Narnia',
      entities: {
        'light.narnia': { state: 'on', brightness: 190, rgb_color: [12, 30, 200], transition: 3 },
      },
      icon: 'mdi:moon',
    };
    const management = vi.fn().mockResolvedValueOnce(original).mockResolvedValueOnce({});
    await saveConfig({ management }, 'scene', 'narnia', { ...original, name: 'Evening' }, original);
    expect(management.mock.calls[1][0].data.entities).toEqual(original.entities);
  });
});
