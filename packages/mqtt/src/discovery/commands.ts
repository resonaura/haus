/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { hsToRgb, rgbToHs } from '@haus/core';
import type { MqttEndpointBinding } from '../types.js';

type MqttCommandMessage = { topic: string; payload: string };
type Color = Record<string, unknown>;
type ColorProfile = 'hs' | 'rgb' | 'unsupported';

function isRecord(value: unknown): value is Color {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function brightnessScale(binding: MqttEndpointBinding): number {
  return binding.brightnessScale && binding.brightnessScale > 0 ? binding.brightnessScale : 255;
}

function scaledBrightness(binding: MqttEndpointBinding, value: number): number {
  return Math.round((clamp(value, 0, 255) / 255) * brightnessScale(binding));
}

function scaledValue(binding: MqttEndpointBinding, value: number): number {
  return Math.round((clamp(value, 0, 100) / 100) * brightnessScale(binding));
}

function colorProfile(binding: MqttEndpointBinding): ColorProfile {
  const modes = binding.supportedColorModes;
  if (!modes) return 'rgb';
  if (modes.includes('hs') && !modes.includes('rgb')) return 'hs';
  if (modes.some((mode) => ['rgb', 'rgbw', 'rgbww'].includes(mode))) return 'rgb';
  return 'unsupported';
}

function jsonLightColor(
  binding: MqttEndpointBinding,
  value: unknown,
): { color?: Color; brightness?: number } {
  if (!isRecord(value)) return {};
  const profile = colorProfile(binding);
  const hue = finite(value.h);
  const saturation = finite(value.s);
  const valuePercent = finite(value.v);
  if (hue !== undefined && saturation !== undefined) {
    if (profile === 'unsupported') return {};
    const hs = { h: clamp(hue, 0, 360), s: clamp(saturation, 0, 100) };
    const color = profile === 'hs' ? hs : hsToRgb(hs.h, hs.s);
    return valuePercent === undefined
      ? { color }
      : { color, brightness: scaledValue(binding, valuePercent) };
  }

  const red = finite(value.r);
  const green = finite(value.g);
  const blue = finite(value.b);
  if (red !== undefined && green !== undefined && blue !== undefined) {
    if (profile === 'unsupported') return {};
    const rgb = {
      r: clamp(red, 0, 255),
      g: clamp(green, 0, 255),
      b: clamp(blue, 0, 255),
    };
    return { color: profile === 'hs' ? rgbToHs(rgb.r, rgb.g, rgb.b) : rgb };
  }

  return binding.supportedColorModes ? {} : { color: value };
}

function colorTemperature(binding: MqttEndpointBinding, kelvin: number): number | undefined {
  if (kelvin <= 0) return undefined;
  return Math.round(binding.colorTempKelvin ? kelvin : 1_000_000 / kelvin);
}

function sceneColorValue(
  binding: MqttEndpointBinding,
  capability: string,
  parameters: Record<string, unknown> | undefined,
): { color?: Color; brightness?: number } {
  const value =
    capability === 'color_hsv' ? parameters?.value : (parameters?.color ?? parameters?.value);
  return jsonLightColor(binding, value);
}

function sceneColorTemperature(
  binding: MqttEndpointBinding,
  parameters: Record<string, unknown> | undefined,
  capability: string,
): number | undefined {
  const kelvin =
    finite(parameters?.color_temp_kelvin) ??
    finite(parameters?.color_temp) ??
    (capability === 'color_temp' ? finite(parameters?.value) : undefined);
  return kelvin === undefined ? undefined : colorTemperature(binding, kelvin);
}

export function buildCommandMessages(
  binding: MqttEndpointBinding,
  capability: string,
  command: string,
  parameters?: Record<string, unknown>,
): MqttCommandMessage[] {
  if (binding.component === 'water_heater' || binding.component === 'climate') {
    const out: MqttCommandMessage[] = [];
    const tempVal = parameters?.target_temperature ?? parameters?.temperature ?? parameters?.value;
    if (
      (capability === 'target_temperature' ||
        command === 'set_temperature' ||
        parameters?.target_temperature !== undefined ||
        parameters?.temperature !== undefined) &&
      typeof tempVal === 'number'
    ) {
      const topic = binding.temperatureCommandTopic ?? binding.commandTopic;
      if (topic) out.push({ topic, payload: String(Math.round(tempVal)) });
      return out;
    }

    if (command === 'turn_on' || command === 'turn_off') {
      if (binding.powerCommandTopic) {
        out.push({
          topic: binding.powerCommandTopic,
          payload: command === 'turn_on' ? binding.payloadOn : binding.payloadOff,
        });
      } else {
        const topic = binding.modeCommandTopic ?? binding.commandTopic;
        if (topic) {
          const defaultOnMode = binding.component === 'water_heater' ? 'electric' : 'heat';
          out.push({ topic, payload: command === 'turn_on' ? defaultOnMode : 'off' });
        }
      }
      return out;
    }

    const modeVal =
      parameters?.operation_mode ?? parameters?.hvac_mode ?? parameters?.mode ?? parameters?.value;
    if (typeof modeVal === 'string') {
      const topic = binding.modeCommandTopic ?? binding.commandTopic;
      if (topic) out.push({ topic, payload: modeVal });
      return out;
    }
  }

  if (binding.component === 'number') {
    const value = finite(parameters?.value);
    const minimum = binding.numberMinimum ?? 1;
    const maximum = binding.numberMaximum ?? 100;
    if (
      capability !== 'number' ||
      command !== 'set' ||
      value === undefined ||
      value < minimum ||
      value > maximum ||
      !binding.commandTopic
    ) {
      return [];
    }
    return [{ topic: binding.commandTopic, payload: String(value) }];
  }

  if (binding.component === 'select') {
    const value = parameters?.value;
    if (
      capability !== 'select' ||
      command !== 'set' ||
      typeof value !== 'string' ||
      !binding.enumOptions?.includes(value) ||
      !binding.commandTopic
    ) {
      return [];
    }
    return [{ topic: binding.commandTopic, payload: value }];
  }

  if (binding.component === 'button') {
    if (capability !== 'press' || command !== 'press' || !binding.commandTopic) return [];
    return [{ topic: binding.commandTopic, payload: binding.payloadOn }];
  }

  if (!binding.commandTopic) return [];

  const booleanSet =
    command === 'set' &&
    ['on_off', 'power'].includes(capability) &&
    typeof parameters?.value === 'boolean'
      ? parameters.value
      : undefined;
  if (binding.component === 'switch' && booleanSet !== undefined) {
    return [
      { topic: binding.commandTopic, payload: booleanSet ? binding.payloadOn : binding.payloadOff },
    ];
  }

  if (binding.isJsonSchema || binding.component === 'light') {
    if (command === 'turn_off' || booleanSet === false) {
      return [{ topic: binding.commandTopic, payload: JSON.stringify({ state: 'OFF' }) }];
    }

    const body: Record<string, unknown> = { state: 'ON' };
    const brightness = finite(
      parameters?.brightness ?? (capability === 'brightness' ? parameters?.value : undefined),
    );
    if (brightness !== undefined) body.brightness = scaledBrightness(binding, brightness);

    const mappedColor = sceneColorValue(binding, capability, parameters);
    if (mappedColor.color) body.color = mappedColor.color;
    if (mappedColor.brightness !== undefined) body.brightness = mappedColor.brightness;

    const colorTemp = sceneColorTemperature(binding, parameters, capability);
    if (colorTemp !== undefined) body.color_temp = colorTemp;

    const effect = parameters?.effect ?? (capability === 'effect' ? parameters?.value : undefined);
    if (typeof effect === 'string' && effect) body.effect = effect;
    const transition = finite(parameters?.transition);
    if (transition !== undefined && transition >= 0) body.transition = transition;
    return [{ topic: binding.commandTopic, payload: JSON.stringify(body) }];
  }

  let payload: string;
  if (command === 'turn_on' || command === 'press') {
    payload = binding.payloadOn;
  } else if (command === 'turn_off') {
    payload = binding.payloadOff;
  } else if (parameters?.value !== undefined) {
    payload =
      typeof parameters.value === 'string' ? parameters.value : JSON.stringify(parameters.value);
  } else {
    payload = command;
  }

  return [{ topic: binding.commandTopic, payload }];
}
