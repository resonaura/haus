import { entityDomain } from './capabilities';
import type { HassEntity, HausAction, Snapshot } from './types';

function numberInRange(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('Enter a valid number.');
  return Math.min(max, Math.max(min, value));
}

function rgbColor(value: unknown): number[] {
  const components =
    typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
      ? [1, 3, 5].map((start) => Number.parseInt(value.slice(start, start + 2), 16))
      : value;
  if (!Array.isArray(components) || components.length !== 3)
    throw new Error('Choose an RGB color.');
  return components.map((component) => Math.round(numberInRange(component, 0, 255)));
}

/** UI intents become native HA service calls; never write states to pretend a device was controlled. */
export function buildAction(entity: HassEntity, intent: string, value?: unknown): HausAction {
  const domain = entityDomain(entity);
  if (
    entity.state === 'unavailable' ||
    (entity.state === 'unknown' && !['scene', 'button', 'input_button'].includes(domain))
  )
    throw new Error('This accessory is unavailable.');
  const attrs = entity.attributes;
  if (domain === 'water_heater' && attrs.read_only === true)
    throw new Error('This accessory is in read-only commissioning mode.');
  const target = { entity_id: entity.entity_id };
  const action = (service: string, service_data?: Record<string, unknown>): HausAction => ({
    domain,
    service,
    target,
    ...(service_data ? { service_data } : {}),
  });
  const ensure = (...domains: string[]) => {
    if (!domains.includes(domain)) throw new Error(`This accessory does not support ${intent}.`);
  };

  switch (intent) {
    case 'toggle':
      ensure('light', 'switch', 'fan', 'input_boolean', 'media_player', 'humidifier', 'automation');
      return action(['off', 'standby'].includes(entity.state) ? 'turn_on' : 'turn_off');
    case 'brightness':
      ensure('light');
      return action('turn_on', { brightness_pct: Math.round(numberInRange(value, 0, 100)) });
    case 'color':
      ensure('light');
      return action('turn_on', { rgb_color: rgbColor(value) });
    case 'temperature':
      ensure('light');
      return action('turn_on', {
        color_temp_kelvin: Math.round(
          numberInRange(
            value,
            attrs.min_color_temp_kelvin ?? 2000,
            attrs.max_color_temp_kelvin ?? 6500,
          ),
        ),
      });
    case 'climate-temperature': {
      ensure('climate');
      const min = attrs.min_temp ?? 7;
      const max = attrs.max_temp ?? 35;
      if (
        value &&
        typeof value === 'object' &&
        'target_temp_low' in value &&
        'target_temp_high' in value
      ) {
        const low = numberInRange(value.target_temp_low, min, max);
        const high = numberInRange(value.target_temp_high, min, max);
        if (low > high) throw new Error('The lower target must be below the upper target.');
        return action('set_temperature', { target_temp_low: low, target_temp_high: high });
      }
      if (entity.state === 'heat_cool')
        throw new Error('Choose both lower and upper temperatures for Heat/Cool mode.');
      return action('set_temperature', { temperature: numberInRange(value, min, max) });
    }
    case 'hvac-mode':
      ensure('climate');
      if (!Array.isArray(attrs.hvac_modes) || !attrs.hvac_modes.includes(value))
        throw new Error('This HVAC mode is not supported.');
      return action('set_hvac_mode', { hvac_mode: value });
    case 'water-temperature':
      ensure('water_heater');
      if (!Number.isFinite(attrs.min_temp) || !Number.isFinite(attrs.max_temp))
        throw new Error('Wait for the supported temperature range.');
      return action('set_temperature', {
        temperature: numberInRange(value, attrs.min_temp, attrs.max_temp),
      });
    case 'heater-mode':
      ensure('water_heater');
      if (!Array.isArray(attrs.operation_list) || !attrs.operation_list.includes(value))
        throw new Error('Choose an available operation mode.');
      return action('set_operation_mode', { operation_mode: value });
    case 'position':
      ensure('cover', 'valve');
      return action(`set_${domain}_position`, {
        position: Math.round(numberInRange(value, 0, 100)),
      });
    case 'open':
    case 'close':
    case 'stop':
      ensure('cover', 'valve');
      return action(`${intent}_${domain}`);
    case 'volume':
      ensure('media_player');
      return action('volume_set', { volume_level: numberInRange(value, 0, 1) });
    case 'play-pause':
      ensure('media_player');
      return action('media_play_pause');
    case 'lock':
    case 'unlock':
      ensure('lock');
      return action(intent);
    case 'run':
      ensure('scene', 'script');
      return action('turn_on');
    case 'percentage':
      ensure('fan');
      return action('set_percentage', { percentage: Math.round(numberInRange(value, 0, 100)) });
    case 'select':
      ensure('select', 'input_select');
      if (!Array.isArray(attrs.options) || !attrs.options.includes(value))
        throw new Error('Choose an available option.');
      return action('select_option', { option: value });
    case 'value':
      ensure('number', 'input_number');
      return action('set_value', {
        value: numberInRange(value, attrs.min ?? -Infinity, attrs.max ?? Infinity),
      });
    case 'press':
      ensure('button', 'input_button');
      return action('press');
    default:
      throw new Error(`Unsupported action: ${intent}`);
  }
}

const demoScenes: Record<
  string,
  Record<string, { state?: string; attributes?: Record<string, unknown> }>
> = {
  'scene.good_morning': {
    'light.living_room_pendant': {
      state: 'on',
      attributes: { brightness: 230, color_temp_kelvin: 3600 },
    },
    'light.bedroom_lamps': {
      state: 'on',
      attributes: { brightness: 155, color_temp_kelvin: 3000 },
    },
    'cover.living_room_blinds': { state: 'open', attributes: { current_position: 100 } },
    'climate.home': { state: 'heat', attributes: { temperature: 22 } },
  },
  'scene.movie_time': {
    'light.living_room_pendant': {
      state: 'on',
      attributes: { brightness: 35, color_temp_kelvin: 2400 },
    },
    'light.corner_lamp': {
      state: 'on',
      attributes: { brightness: 75, rgb_color: [255, 174, 94], color_mode: 'rgb' },
    },
    'cover.living_room_blinds': { state: 'closed', attributes: { current_position: 0 } },
    'media_player.living_room': { state: 'playing' },
  },
  'scene.good_night': {
    'light.living_room_pendant': { state: 'off' },
    'light.corner_lamp': { state: 'off' },
    'light.bedroom_lamps': { state: 'off' },
    'light.kitchen_pendants': { state: 'off' },
    'lock.front_door': { state: 'locked' },
    'climate.home': { state: 'heat', attributes: { temperature: 19 } },
  },
  'scene.away': {
    'light.living_room_pendant': { state: 'off' },
    'light.corner_lamp': { state: 'off' },
    'light.bedroom_lamps': { state: 'off' },
    'light.kitchen_pendants': { state: 'off' },
    'media_player.living_room': { state: 'off' },
    'lock.front_door': { state: 'locked' },
    'climate.home': { state: 'heat', attributes: { temperature: 17 } },
  },
};

/** Replays the same actions against fictional data. Live connections never use this reducer. */
export function applyDemoAction(snapshot: Snapshot, action: HausAction): Snapshot {
  const current = snapshot.states.find((entity) => entity.entity_id === action.target.entity_id);
  if (!current) throw new Error('This demo accessory was not found.');
  if (current.state === 'unavailable') throw new Error('This demo accessory is offline.');
  const data = action.service_data ?? {};
  const attributes = { ...current.attributes };
  let state = current.state;
  const timestamp = new Date().toISOString();
  const sceneChanges =
    action.domain === 'scene' && action.service === 'turn_on'
      ? (demoScenes[current.entity_id] ?? {})
      : {};

  switch (action.service) {
    case 'turn_on':
      state = action.domain === 'scene' ? timestamp : 'on';
      if (data.brightness_pct !== undefined)
        attributes.brightness = Math.round((Number(data.brightness_pct) * 255) / 100);
      if (data.brightness_pct === 0) state = 'off';
      if (data.rgb_color) {
        attributes.rgb_color = data.rgb_color;
        attributes.color_mode = 'rgb';
      }
      if (data.color_temp_kelvin) {
        attributes.color_temp_kelvin = data.color_temp_kelvin;
        attributes.color_mode = 'color_temp';
      }
      if (action.domain === 'scene') attributes.last_activated = timestamp;
      break;
    case 'turn_off':
      state = 'off';
      break;
    case 'set_temperature':
      Object.assign(attributes, data);
      break;
    case 'set_hvac_mode':
      state = String(data.hvac_mode);
      attributes.hvac_action = state === 'off' ? 'off' : 'idle';
      break;
    case 'set_operation_mode':
      state = String(data.operation_mode);
      attributes.operation_mode = state;
      break;
    case 'set_cover_position':
    case 'set_valve_position':
      attributes.current_position = data.position;
      state = Number(data.position) === 0 ? 'closed' : 'open';
      break;
    case 'open_cover':
    case 'open_valve':
      state = 'open';
      attributes.current_position = 100;
      break;
    case 'close_cover':
    case 'close_valve':
      state = 'closed';
      attributes.current_position = 0;
      break;
    case 'stop_cover':
    case 'stop_valve':
      state = Number(attributes.current_position) === 0 ? 'closed' : 'open';
      break;
    case 'volume_set':
      attributes.volume_level = data.volume_level;
      break;
    case 'media_play_pause':
      state = current.state === 'playing' ? 'paused' : 'playing';
      break;
    case 'lock':
      state = 'locked';
      break;
    case 'unlock':
      state = 'unlocked';
      break;
    case 'set_percentage':
      attributes.percentage = data.percentage;
      state = Number(data.percentage) === 0 ? 'off' : 'on';
      break;
    case 'select_option':
      state = String(data.option);
      break;
    case 'set_value':
      state = String(data.value);
      break;
    case 'press':
      state = timestamp;
      break;
    default:
      throw new Error(`This demo does not implement ${action.domain}.${action.service}.`);
  }
  return {
    ...snapshot,
    states: snapshot.states.map((entity) => {
      if (entity.entity_id === current.entity_id)
        return {
          ...entity,
          state,
          attributes,
          last_updated: timestamp,
          last_changed: state !== entity.state ? timestamp : entity.last_changed,
        };
      const patch = sceneChanges[entity.entity_id];
      if (!patch) return entity;
      return {
        ...entity,
        state: patch.state ?? entity.state,
        attributes: { ...entity.attributes, ...patch.attributes },
        last_updated: timestamp,
        last_changed: patch.state && patch.state !== entity.state ? timestamp : entity.last_changed,
      };
    }),
  };
}
