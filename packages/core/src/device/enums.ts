/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

/** Device availability state. */
export enum AvailabilityEnum {
  Online = 'online',
  Offline = 'offline',
  Unknown = 'unknown',
}
export const Availability = AvailabilityEnum;
export type Availability = AvailabilityEnum | `${AvailabilityEnum}`;

/** Communication protocol used by a device. */
export enum ProtocolEnum {
  Matter = 'matter',
  Zigbee = 'zigbee',
  Mqtt = 'mqtt',
  Thread = 'thread',
  HomeKit = 'homekit',
  Ha = 'ha',
  LocalIp = 'local_ip',
  Ble = 'ble',
  Virtual = 'virtual',
}
export const Protocol = ProtocolEnum;
export type Protocol = ProtocolEnum | `${ProtocolEnum}`;

/** Standard capability kind identifiers. */
export enum CapabilityKindEnum {
  OnOff = 'on_off',
  Brightness = 'brightness',
  ColorTemp = 'color_temp',
  ColorHsv = 'color_hsv',
  Temperature = 'temperature',
  Humidity = 'humidity',
  Lock = 'lock',
  Cover = 'cover',
  Motion = 'motion',
  Contact = 'contact',
  Event = 'event',
  Update = 'update',
  Camera = 'camera',
  Talkback = 'audio_talkback',
}
export const CapabilityKind = CapabilityKindEnum;
export type CapabilityKind = CapabilityKindEnum | `${CapabilityKindEnum}`;

/** Reading freshness state. */
export enum FreshnessEnum {
  Live = 'live',
  Cached = 'cached',
  Unknown = 'unknown',
}
export const Freshness = FreshnessEnum;
export type Freshness = FreshnessEnum | `${FreshnessEnum}`;

/** Standardized UI widget primitives for rendering extensible entities. */
export enum UiPrimitiveEnum {
  Toggle = 'toggle',
  Slider = 'slider',
  Stepper = 'stepper',
  Dropdown = 'dropdown',
  Gauge = 'gauge',
  Badge = 'badge',
  Button = 'button',
  Chart = 'chart',
  Text = 'text',
}
export const UiPrimitive = UiPrimitiveEnum;
export type UiPrimitive = UiPrimitiveEnum | `${UiPrimitiveEnum}`;

/** Command dispatch status. */
export enum CommandStatusEnum {
  Accepted = 'accepted',
  Confirmed = 'confirmed',
  Failed = 'failed',
  Unknown = 'unknown',
}
export const CommandStatus = CommandStatusEnum;
export type CommandStatus = CommandStatusEnum | `${CommandStatusEnum}`;

/** Notification priority level. */
export enum NotificationPriorityEnum {
  Normal = 'normal',
  High = 'high',
  Critical = 'critical',
}
export const NotificationPriority = NotificationPriorityEnum;
export type NotificationPriority = NotificationPriorityEnum | `${NotificationPriorityEnum}`;

/** System issue severity. */
export enum IssueSeverityEnum {
  Info = 'info',
  Warning = 'warning',
  Critical = 'critical',
}
export const IssueSeverity = IssueSeverityEnum;
export type IssueSeverity = IssueSeverityEnum | `${IssueSeverityEnum}`;
