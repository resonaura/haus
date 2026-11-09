/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

/**
 * Standard Home Assistant MQTT Discovery key abbreviations used by
 * Zigbee2MQTT, Tasmota, ESPHome, Z-Wave JS UI, Govee2MQTT, and other bridges.
 */
const COMPONENT_ABBREVIATIONS: Readonly<Record<string, string>> = {
  p: 'platform',
  o: 'origin',
  stat_t: 'state_topic',
  cmd_t: 'command_topic',
  avty_t: 'availability_topic',
  avty: 'availability',
  avty_mode: 'availability_mode',
  avty_tpl: 'availability_template',
  pl_avail: 'payload_available',
  pl_not_avail: 'payload_not_available',
  json_attr_t: 'json_attributes_topic',
  json_attr_tpl: 'json_attributes_template',
  val_tpl: 'value_template',
  cmd_tpl: 'command_template',
  uniq_id: 'unique_id',
  obj_id: 'object_id',
  dev_cla: 'device_class',
  stat_cla: 'state_class',
  unit_of_meas: 'unit_of_measurement',
  ent_cat: 'entity_category',
  pl_on: 'payload_on',
  pl_off: 'payload_off',
  pl_prs: 'payload_press',
  stat_on: 'state_on',
  stat_off: 'state_off',
  bri_scl: 'brightness_scale',
  clrm: 'color_mode',
  sup_clrm: 'supported_color_modes',
  fx: 'effect',
  fx_lst: 'effect_list',
  min_mirs: 'min_mireds',
  max_mirs: 'max_mireds',
  clr_temp_k: 'color_temp_kelvin',
  ops: 'options',
  en: 'enabled_by_default',
  ic: 'icon',
  mode_stat_t: 'mode_state_topic',
  mode_stat_tpl: 'mode_state_template',
  mode_cmd_t: 'mode_command_topic',
  temp_stat_t: 'temperature_state_topic',
  temp_stat_tpl: 'temperature_state_template',
  temp_cmd_t: 'temperature_command_topic',
  curr_temp_t: 'current_temperature_topic',
  curr_temp_tpl: 'current_temperature_template',
  pow_cmd_t: 'power_command_topic',
  pos_t: 'position_topic',
  set_pos_t: 'set_position_topic',
  pct_stat_t: 'percentage_state_topic',
  pct_val_tpl: 'percentage_value_template',
  pct_cmd_t: 'percentage_command_topic',
  pl_rst_pct: 'payload_reset_percentage',
  spd_rng_min: 'speed_range_min',
  spd_rng_max: 'speed_range_max',
  stat_val_tpl: 'state_value_template',
  sug_dsp_prc: 'suggested_display_precision',
  dev: 'device',
  cmps: 'components',
};

const DEVICE_ABBREVIATIONS: Readonly<Record<string, string>> = {
  ids: 'identifiers',
  cns: 'connections',
  mf: 'manufacturer',
  mdl: 'model',
  sw: 'sw_version',
  hw: 'hw_version',
  sn: 'serial_number',
  sa: 'suggested_area',
  mdl_id: 'model_id',
  cu: 'configuration_url',
};

const ORIGIN_ABBREVIATIONS: Readonly<Record<string, string>> = {
  name: 'name',
  sw: 'sw_version',
  url: 'support_url',
};

const TOPIC_SUFFIX_KEYS = new Set([
  'state_topic',
  'command_topic',
  'availability_topic',
  'json_attributes_topic',
  'mode_state_topic',
  'mode_command_topic',
  'temperature_state_topic',
  'temperature_command_topic',
  'current_temperature_topic',
  'power_command_topic',
  'position_topic',
  'set_position_topic',
  'percentage_state_topic',
  'percentage_command_topic',
]);

function expandDeviceBlock(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [expandKey(DEVICE_ABBREVIATIONS, key), value]),
  );
}

function expandKey(keys: Readonly<Record<string, string>>, key: string): string {
  return Object.hasOwn(keys, key) ? (keys[key] ?? key) : key;
}

/**
 * Expands official Home Assistant MQTT Discovery abbreviated keys and resolves
 * `~` base-topic prefixes recursively across single-entity and bundled payloads.
 */
export function expandHaDiscoveryPayload(
  raw: Record<string, unknown>,
  inheritedBaseTopic?: string,
): Record<string, unknown> {
  const baseTopic =
    typeof raw['~'] === 'string' ? raw['~'].replace(/\/+$/, '') : inheritedBaseTopic;

  const out: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(raw)) {
    if (key === '~') continue;
    const canonicalKey = expandKey(COMPONENT_ABBREVIATIONS, key);

    if (canonicalKey === 'device' && val && typeof val === 'object' && !Array.isArray(val)) {
      out.device = expandDeviceBlock(val as Record<string, unknown>);
      continue;
    }

    if (canonicalKey === 'origin' && val && typeof val === 'object' && !Array.isArray(val)) {
      out.origin = Object.fromEntries(
        Object.entries(val).map(([originKey, originValue]) => [
          expandKey(ORIGIN_ABBREVIATIONS, originKey),
          originValue,
        ]),
      );
      continue;
    }

    if (canonicalKey === 'availability' && Array.isArray(val)) {
      out.availability = val.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
        const expanded = Object.fromEntries(
          Object.entries(item as Record<string, unknown>).map(([itemKey, itemValue]) => [
            expandKey(
              {
                t: 'topic',
                val_tpl: 'value_template',
                pl_avail: 'payload_available',
                pl_not_avail: 'payload_not_available',
              },
              itemKey,
            ),
            itemValue,
          ]),
        );
        if (baseTopic && typeof expanded.topic === 'string' && expanded.topic.includes('~')) {
          expanded.topic = expanded.topic.replace(/^~/, baseTopic).replace(/~$/, baseTopic);
        }
        return expanded;
      });
      continue;
    }

    if (canonicalKey === 'components' && val && typeof val === 'object' && !Array.isArray(val)) {
      out.components = Object.fromEntries(
        Object.entries(val).map(([compKey, compVal]: [string, unknown]) => [
          compKey,
          compVal && typeof compVal === 'object' && !Array.isArray(compVal)
            ? expandHaDiscoveryPayload(compVal as Record<string, unknown>, baseTopic)
            : compVal,
        ]),
      );
      continue;
    }

    if (
      baseTopic &&
      typeof val === 'string' &&
      TOPIC_SUFFIX_KEYS.has(canonicalKey) &&
      val.includes('~')
    ) {
      out[canonicalKey] = val.replace(/^~/, baseTopic).replace(/~$/, baseTopic);
    } else {
      Object.defineProperty(out, canonicalKey, {
        value: val,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }

  return out;
}
