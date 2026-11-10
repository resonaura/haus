/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { HaMqttComponentConfig, MqttEndpointBinding } from '../types.js';

type TemplateBindings = Pick<
  MqttEndpointBinding,
  | 'commandTemplate'
  | 'attributesTemplate'
  | 'valueTemplate'
  | 'modeStateTemplate'
  | 'modeCommandTemplate'
  | 'temperatureStateTemplate'
  | 'temperatureCommandTemplate'
  | 'currentTemperatureTemplate'
  | 'powerCommandTemplate'
  | 'percentageValueTemplate'
  | 'stateValueTemplate'
>;

export function templateBindings(config: HaMqttComponentConfig): TemplateBindings {
  return {
    commandTemplate: config.command_template,
    attributesTemplate: config.json_attributes_template,
    valueTemplate: config.value_template,
    modeStateTemplate: config.mode_state_template,
    modeCommandTemplate: config.mode_command_template,
    temperatureStateTemplate: config.temperature_state_template,
    temperatureCommandTemplate: config.temperature_command_template,
    currentTemperatureTemplate: config.current_temperature_template,
    powerCommandTemplate: config.power_command_template,
    percentageValueTemplate: config.percentage_value_template,
    stateValueTemplate: config.state_value_template,
  };
}
