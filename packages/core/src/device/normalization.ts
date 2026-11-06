/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { Capability, Reading } from '../types.js';
import {
  brightnessCapability,
  colorHsvCapability,
  contactCapability,
  coverCapability,
  createColorTempCapability,
  createEventCapability,
  createTemperatureCapability,
  lockCapability,
  miredsToKelvin,
  motionCapability,
  normalizeHsv,
  onOffCapability,
  updateCapability,
} from './capability.js';
import { DeviceCategory } from './category.js';
import type { HausEndpoint } from './types.js';

export interface RawHaEntity {
  readonly entity_id: string;
  readonly state: string;
  readonly attributes: Record<string, unknown>;
}

/**
 * Normalizes legacy Home Assistant entities into Haus canonical endpoints and categories.
 * Preserves exact numerical readings, converts color units to Kelvin/HSV authority,
 * and handles multi-gang and event endpoints cleanly.
 */
export function normalizeHaEntity(entity: RawHaEntity): {
  readonly endpoint: HausEndpoint;
  readonly category: DeviceCategory;
} {
  const [domain, name] = entity.entity_id.split('.');
  const capabilities: Capability[] = [];
  const readings: Record<string, Reading> = {};
  let category: DeviceCategory = DeviceCategory.Generic;

  const now = new Date().toISOString();
  const live = (val: unknown): Reading => ({
    value: val as Reading['value'],
    observedAt: now,
    freshness: 'live',
  });

  switch (domain) {
    case 'light': {
      category = DeviceCategory.Lighting;
      capabilities.push(onOffCapability);
      readings['on_off'] = live(entity.state === 'on');

      if ('brightness' in entity.attributes) {
        capabilities.push(brightnessCapability);
        const rawBright = Number(entity.attributes.brightness) || 0;
        const pct = Math.round((rawBright / 255) * 100);
        readings['brightness'] = live(Math.min(100, Math.max(0, pct)));
      }

      if ('color_temp_kelvin' in entity.attributes) {
        capabilities.push(createColorTempCapability());
        readings['color_temp'] = live(Number(entity.attributes.color_temp_kelvin) || 2700);
      } else if ('color_temp' in entity.attributes) {
        capabilities.push(createColorTempCapability());
        const mireds = Number(entity.attributes.color_temp) || 370;
        readings['color_temp'] = live(miredsToKelvin(mireds));
      }

      if ('hs_color' in entity.attributes && Array.isArray(entity.attributes.hs_color)) {
        capabilities.push(colorHsvCapability);
        const [h, s] = entity.attributes.hs_color;
        const norm = normalizeHsv(Number(h) || 0, Number(s) || 0, 100);
        readings['color_hsv'] = live(norm);
      }
      break;
    }

    case 'switch': {
      category = DeviceCategory.Power;
      capabilities.push(onOffCapability);
      readings['on_off'] = live(entity.state === 'on');
      break;
    }

    case 'event': {
      category = DeviceCategory.Power;
      const eventTypes = Array.isArray(entity.attributes.event_types)
        ? (entity.attributes.event_types as string[])
        : ['press'];
      capabilities.push(createEventCapability(eventTypes));
      readings['event'] = live({
        eventType: String(entity.attributes.event_type ?? entity.state),
        timestamp: now,
        sequence: 1,
      });
      break;
    }

    case 'climate':
    case 'water_heater': {
      category = DeviceCategory.Climate;
      capabilities.push(createTemperatureCapability('current_temperature'));
      capabilities.push(createTemperatureCapability('target_temperature', ['set_temperature']));
      if ('current_temperature' in entity.attributes) {
        readings['current_temperature'] = live(Number(entity.attributes.current_temperature) || 0);
      }
      if ('temperature' in entity.attributes) {
        readings['target_temperature'] = live(Number(entity.attributes.temperature) || 0);
      }
      break;
    }

    case 'lock': {
      category = DeviceCategory.Security;
      capabilities.push(lockCapability);
      readings['lock'] = live(entity.state);
      break;
    }

    case 'cover': {
      category = DeviceCategory.Covers;
      capabilities.push(coverCapability);
      const rawPos =
        entity.attributes.current_position != null
          ? Number(entity.attributes.current_position)
          : null;
      const pos =
        rawPos != null && !Number.isNaN(rawPos) ? rawPos : entity.state === 'open' ? 100 : 0;
      readings['cover'] = live(pos);
      break;
    }

    case 'binary_sensor': {
      const deviceClass = String(entity.attributes.device_class ?? '');
      if (['motion', 'occupancy', 'presence'].includes(deviceClass)) {
        category = DeviceCategory.OccupancySensors;
        capabilities.push(motionCapability);
        readings['motion'] = live(entity.state === 'on');
      } else if (['door', 'window', 'opening'].includes(deviceClass)) {
        category = DeviceCategory.OccupancySensors;
        capabilities.push(contactCapability);
        readings['contact'] = live(entity.state !== 'on');
      } else if (['smoke', 'gas', 'moisture', 'carbon_monoxide'].includes(deviceClass)) {
        category = DeviceCategory.SafetySensors;
      }
      break;
    }

    case 'sensor': {
      const deviceClass = String(entity.attributes.device_class ?? '');
      const unit = String(entity.attributes.unit_of_measurement ?? '');
      if (
        ['temperature', 'humidity', 'illuminance', 'pressure', 'aqi', 'pm25'].includes(deviceClass)
      ) {
        category = DeviceCategory.EnvironmentalSensors;
      } else if (
        ['power', 'energy', 'voltage', 'current', 'battery'].includes(deviceClass) ||
        ['W', 'kWh', 'V', 'A', '%'].includes(unit)
      ) {
        category = DeviceCategory.Energy;
      }
      break;
    }

    case 'update': {
      category = DeviceCategory.Generic;
      capabilities.push(updateCapability);
      readings['update'] = live({
        installedVersion: String(entity.attributes.installed_version ?? entity.state),
        latestVersion: entity.attributes.latest_version
          ? String(entity.attributes.latest_version)
          : null,
        inProgress: Boolean(entity.attributes.in_progress),
        updatePercentage:
          typeof entity.attributes.update_percentage === 'number'
            ? entity.attributes.update_percentage
            : null,
        autoUpdate: Boolean(entity.attributes.auto_update),
      });
      break;
    }

    case 'camera': {
      category = DeviceCategory.Cameras;
      break;
    }

    case 'media_player': {
      category = DeviceCategory.Media;
      break;
    }

    case 'fan': {
      category = DeviceCategory.Climate;
      capabilities.push(onOffCapability);
      readings['on_off'] = live(entity.state === 'on');
      if ('percentage' in entity.attributes) {
        readings['speed'] = live(Number(entity.attributes.percentage) || 0);
      }
      break;
    }

    case 'humidifier': {
      category = DeviceCategory.Climate;
      capabilities.push(onOffCapability);
      readings['on_off'] = live(entity.state === 'on');
      if ('humidity' in entity.attributes) {
        readings['target_humidity'] = live(Number(entity.attributes.humidity) || 0);
      }
      break;
    }

    case 'vacuum': {
      category = DeviceCategory.Appliances;
      capabilities.push(onOffCapability);
      readings['on_off'] = live(entity.state === 'cleaning');
      readings['vacuum_state'] = live(entity.state);
      break;
    }

    case 'alarm_control_panel': {
      category = DeviceCategory.Security;
      readings['security_state'] = live(entity.state);
      break;
    }

    case 'siren': {
      category = DeviceCategory.Security;
      capabilities.push(onOffCapability);
      readings['on_off'] = live(entity.state === 'on');
      break;
    }

    case 'valve': {
      category = DeviceCategory.Power;
      capabilities.push(onOffCapability);
      readings['on_off'] = live(entity.state === 'open');
      break;
    }

    case 'lawn_mower': {
      category = DeviceCategory.Appliances;
      readings['mower_state'] = live(entity.state);
      break;
    }

    case 'button': {
      category = DeviceCategory.Power;
      readings['action'] = live(entity.state);
      break;
    }

    case 'number': {
      category = DeviceCategory.Generic;
      readings['number'] = live(Number(entity.state) || 0);
      break;
    }

    case 'select': {
      category = DeviceCategory.Generic;
      readings['select'] = live(entity.state);
      break;
    }

    case 'text': {
      category = DeviceCategory.Generic;
      readings['text'] = live(entity.state);
      break;
    }

    case 'scene': {
      category = DeviceCategory.Generic;
      readings['scene'] = live(entity.state);
      break;
    }

    case 'remote': {
      category = DeviceCategory.Media;
      readings['remote'] = live(entity.state);
      break;
    }

    case 'device_tracker': {
      category = DeviceCategory.OccupancySensors;
      readings['presence'] = live(entity.state === 'home');
      break;
    }

    case 'weather': {
      category = DeviceCategory.EnvironmentalSensors;
      readings['weather'] = live(entity.state);
      break;
    }

    case 'calendar':
    case 'todo': {
      category = DeviceCategory.Generic;
      readings['data'] = live(entity.state);
      break;
    }

    case 'notify':
    case 'stt':
    case 'conversation':
    case 'ai_task':
    case 'assist_satellite':
    case 'wake_word': {
      category = DeviceCategory.Generic;
      readings['service_state'] = live(entity.state);
      break;
    }

    case 'tts': {
      category = DeviceCategory.Media;
      readings['tts_state'] = live(entity.state);
      break;
    }

    case 'image':
    case 'image_processing': {
      category = DeviceCategory.Cameras;
      readings['image_state'] = live(entity.state);
      break;
    }

    case 'date':
    case 'datetime':
    case 'time': {
      category = DeviceCategory.Generic;
      readings['temporal'] = live(entity.state);
      break;
    }

    case 'geo_location': {
      category = DeviceCategory.OccupancySensors;
      readings['location'] = live(entity.state);
      break;
    }

    case 'infrared':
    case 'radio_frequency': {
      category = DeviceCategory.Generic;
      readings['rf_state'] = live(entity.state);
      break;
    }
  }

  const endpoint: HausEndpoint = {
    id: entity.entity_id,
    name: String(entity.attributes.friendly_name ?? name ?? entity.entity_id),
    category,
    capabilities,
    readings,
  };

  return { endpoint, category };
}
