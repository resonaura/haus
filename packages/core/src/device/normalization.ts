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

  switch (domain) {
    case 'light': {
      category = DeviceCategory.Lighting;
      capabilities.push(onOffCapability);
      readings['on_off'] = {
        value: entity.state === 'on',
        observedAt: now,
        freshness: 'live',
      };

      if ('brightness' in entity.attributes) {
        capabilities.push(brightnessCapability);
        const rawBright = Number(entity.attributes.brightness) || 0;
        const pct = Math.round((rawBright / 255) * 100);
        readings['brightness'] = {
          value: Math.min(100, Math.max(0, pct)),
          observedAt: now,
          freshness: 'live',
        };
      }

      if ('color_temp_kelvin' in entity.attributes) {
        capabilities.push(createColorTempCapability());
        readings['color_temp'] = {
          value: Number(entity.attributes.color_temp_kelvin) || 2700,
          observedAt: now,
          freshness: 'live',
        };
      } else if ('color_temp' in entity.attributes) {
        capabilities.push(createColorTempCapability());
        const mireds = Number(entity.attributes.color_temp) || 370;
        readings['color_temp'] = {
          value: miredsToKelvin(mireds),
          observedAt: now,
          freshness: 'live',
        };
      }

      if ('hs_color' in entity.attributes && Array.isArray(entity.attributes.hs_color)) {
        capabilities.push(colorHsvCapability);
        const [h, s] = entity.attributes.hs_color;
        const norm = normalizeHsv(Number(h) || 0, Number(s) || 0, 100);
        readings['color_hsv'] = {
          value: norm,
          observedAt: now,
          freshness: 'live',
        };
      }
      break;
    }

    case 'switch': {
      category = DeviceCategory.Power;
      capabilities.push(onOffCapability);
      readings['on_off'] = {
        value: entity.state === 'on',
        observedAt: now,
        freshness: 'live',
      };
      break;
    }

    case 'event': {
      category = DeviceCategory.Power;
      const eventTypes = Array.isArray(entity.attributes.event_types)
        ? (entity.attributes.event_types as string[])
        : ['press'];
      capabilities.push(createEventCapability(eventTypes));
      readings['event'] = {
        value: {
          eventType: String(entity.attributes.event_type ?? entity.state),
          timestamp: now,
          sequence: 1,
        },
        observedAt: now,
        freshness: 'live',
      };
      break;
    }

    case 'climate':
    case 'water_heater': {
      category = DeviceCategory.Climate;
      capabilities.push(createTemperatureCapability('current_temperature'));
      capabilities.push(createTemperatureCapability('target_temperature', ['set_temperature']));
      if ('current_temperature' in entity.attributes) {
        readings['current_temperature'] = {
          value: Number(entity.attributes.current_temperature) || 0,
          observedAt: now,
          freshness: 'live',
        };
      }
      if ('temperature' in entity.attributes) {
        readings['target_temperature'] = {
          value: Number(entity.attributes.temperature) || 0,
          observedAt: now,
          freshness: 'live',
        };
      }
      break;
    }

    case 'lock': {
      category = DeviceCategory.Security;
      capabilities.push(lockCapability);
      readings['lock'] = {
        value: entity.state,
        observedAt: now,
        freshness: 'live',
      };
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
      readings['cover'] = {
        value: pos,
        observedAt: now,
        freshness: 'live',
      };
      break;
    }

    case 'binary_sensor': {
      const deviceClass = String(entity.attributes.device_class ?? '');
      if (['motion', 'occupancy', 'presence'].includes(deviceClass)) {
        category = DeviceCategory.OccupancySensors;
        capabilities.push(motionCapability);
        readings['motion'] = {
          value: entity.state === 'on',
          observedAt: now,
          freshness: 'live',
        };
      } else if (['door', 'window', 'opening'].includes(deviceClass)) {
        category = DeviceCategory.OccupancySensors;
        capabilities.push(contactCapability);
        readings['contact'] = {
          value: entity.state !== 'on', // on = open (not contact)
          observedAt: now,
          freshness: 'live',
        };
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
      readings['update'] = {
        value: {
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
        },
        observedAt: now,
        freshness: 'live',
      };
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
