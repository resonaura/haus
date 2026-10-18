import type { HassEntity, Snapshot } from './types';
import { lightProfile } from './light-profile';

export function entityDomain(entity: HassEntity | string): string {
  return (typeof entity === 'string' ? entity : entity.entity_id).split('.')[0] ?? '';
}

/** Flags mirror HA's per-domain feature enums; service availability alone is not device support. */
export function resolveCapabilities(entity: HassEntity, services: Snapshot['services']): string[] {
  const domain = entityDomain(entity);
  const attrs = entity.attributes;
  const features = Number(attrs.supported_features ?? 0);
  const hasFeature = (flag: number) => (features & flag) === flag;
  const hasService = (service: string) => Boolean(services[domain]?.[service]);
  const add: string[] = [];
  const when = (enabled: boolean, capability: string) => {
    if (enabled) add.push(capability);
  };

  if (['light', 'switch', 'fan', 'input_boolean', 'humidifier', 'automation'].includes(domain)) {
    when(hasService('turn_on') && hasService('turn_off'), 'toggle');
  }
  if (domain === 'light') {
    const profile = lightProfile(entity);
    when(profile.brightness && hasService('turn_on'), 'brightness');
    when(profile.color && hasService('turn_on'), 'color');
    when(profile.temperature && hasService('turn_on'), 'temperature');
  }
  if (domain === 'climate') {
    when((hasFeature(1) || hasFeature(2)) && hasService('set_temperature'), 'climate-temperature');
    when(
      Array.isArray(attrs.hvac_modes) && attrs.hvac_modes.length > 0 && hasService('set_hvac_mode'),
      'hvac-mode',
    );
  }
  if (domain === 'cover' || domain === 'valve') {
    when(hasFeature(1) && hasService(`open_${domain}`), 'open');
    when(hasFeature(2) && hasService(`close_${domain}`), 'close');
    when(hasFeature(4) && hasService(`set_${domain}_position`), 'position');
    when(hasFeature(8) && hasService(`stop_${domain}`), 'stop');
  }
  if (domain === 'media_player') {
    when(hasFeature(4) && hasService('volume_set'), 'volume');
    when(hasFeature(1) && hasFeature(16384) && hasService('media_play_pause'), 'play-pause');
    when(
      hasFeature(128) && hasFeature(256) && hasService('turn_on') && hasService('turn_off'),
      'toggle',
    );
  }
  if (domain === 'lock') {
    when(hasService('lock'), 'lock');
    when(hasService('unlock'), 'unlock');
  }
  if (domain === 'scene') when(hasService('turn_on'), 'run');
  if (domain === 'script') when(hasService('turn_on'), 'run');
  if (domain === 'fan') when(hasFeature(1) && hasService('set_percentage'), 'percentage');
  if (['select', 'input_select'].includes(domain))
    when(hasService('select_option') && Array.isArray(attrs.options), 'select');
  if (['number', 'input_number'].includes(domain)) when(hasService('set_value'), 'value');
  if (['button', 'input_button'].includes(domain)) when(hasService('press'), 'press');
  if (domain === 'camera') {
    when(hasFeature(2), 'live');
    // No generic HA camera flag establishes duplex audio. A camera adapter must confirm it.
    when(attrs.haus_talk_confirmed === true && typeof attrs.haus_talk_service === 'string', 'talk');
  }
  return add;
}
