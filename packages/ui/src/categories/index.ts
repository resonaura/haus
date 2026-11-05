/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export type DeviceCategory =
  | 'lights'
  | 'climate'
  | 'security'
  | 'media'
  | 'water'
  | 'outlets'
  | 'covers'
  | 'printers'
  | 'network'
  | 'sensors'
  | 'appliances'
  | 'robotics'
  | 'other';

export type PrimaryControlType =
  | 'toggle'
  | 'slider'
  | 'climate-dial'
  | 'media-playback'
  | 'mode-select'
  | 'action-trigger'
  | 'read-only';

export type DeviceBadgeStatus =
  'online' | 'offline' | 'active' | 'alert' | 'warning' | 'low_battery' | 'updating';

export interface CategoryMetadata {
  readonly id: DeviceCategory;
  readonly label: string;
  readonly singularLabel: string;
  readonly iconName: string;
  readonly accentColor: string;
  readonly primaryControl: PrimaryControlType;
  readonly supportedControls: readonly PrimaryControlType[];
}

export const CATEGORY_METADATA_MAP: Readonly<Record<DeviceCategory, CategoryMetadata>> = {
  lights: {
    id: 'lights',
    label: 'Lights',
    singularLabel: 'Light',
    iconName: 'lightbulb',
    accentColor: '#eab308', // Amber/Yellow
    primaryControl: 'toggle',
    supportedControls: ['toggle', 'slider', 'mode-select'],
  },
  climate: {
    id: 'climate',
    label: 'Climate',
    singularLabel: 'Climate',
    iconName: 'thermometer',
    accentColor: '#06b6d4', // Cyan
    primaryControl: 'climate-dial',
    supportedControls: ['climate-dial', 'mode-select', 'toggle'],
  },
  security: {
    id: 'security',
    label: 'Security & Cameras',
    singularLabel: 'Security',
    iconName: 'shield',
    accentColor: '#ef4444', // Red
    primaryControl: 'toggle',
    supportedControls: ['toggle', 'action-trigger', 'mode-select'],
  },
  media: {
    id: 'media',
    label: 'Media & Audio',
    singularLabel: 'Media Player',
    iconName: 'speaker',
    accentColor: '#8b5cf6', // Violet
    primaryControl: 'media-playback',
    supportedControls: ['media-playback', 'slider', 'toggle', 'mode-select'],
  },
  water: {
    id: 'water',
    label: 'Water & Valves',
    singularLabel: 'Water Device',
    iconName: 'droplet',
    accentColor: '#3b82f6', // Blue
    primaryControl: 'toggle',
    supportedControls: ['toggle', 'read-only'],
  },
  outlets: {
    id: 'outlets',
    label: 'Outlets & Switches',
    singularLabel: 'Outlet',
    iconName: 'plug',
    accentColor: '#10b981', // Emerald
    primaryControl: 'toggle',
    supportedControls: ['toggle', 'read-only'],
  },
  covers: {
    id: 'covers',
    label: 'Blinds & Covers',
    singularLabel: 'Cover',
    iconName: 'blinds',
    accentColor: '#f97316', // Orange
    primaryControl: 'slider',
    supportedControls: ['slider', 'toggle', 'action-trigger'],
  },
  printers: {
    id: 'printers',
    label: 'Printers & 3D',
    singularLabel: 'Printer',
    iconName: 'printer',
    accentColor: '#6366f1', // Indigo
    primaryControl: 'read-only',
    supportedControls: ['read-only', 'action-trigger'],
  },
  network: {
    id: 'network',
    label: 'Network & Hubs',
    singularLabel: 'Network Node',
    iconName: 'router',
    accentColor: '#14b8a6', // Teal
    primaryControl: 'read-only',
    supportedControls: ['read-only', 'action-trigger'],
  },
  sensors: {
    id: 'sensors',
    label: 'Sensors & Meters',
    singularLabel: 'Sensor',
    iconName: 'activity',
    accentColor: '#a855f7', // Purple
    primaryControl: 'read-only',
    supportedControls: ['read-only'],
  },
  appliances: {
    id: 'appliances',
    label: 'Appliances',
    singularLabel: 'Appliance',
    iconName: 'coffee',
    accentColor: '#f59e0b', // Amber
    primaryControl: 'toggle',
    supportedControls: ['toggle', 'mode-select', 'read-only'],
  },
  robotics: {
    id: 'robotics',
    label: 'Robotics & Vacuums',
    singularLabel: 'Robot',
    iconName: 'bot',
    accentColor: '#0ea5e9', // Sky
    primaryControl: 'action-trigger',
    supportedControls: ['action-trigger', 'mode-select', 'toggle'],
  },
  other: {
    id: 'other',
    label: 'Other Devices',
    singularLabel: 'Device',
    iconName: 'cpu',
    accentColor: '#64748b', // Slate
    primaryControl: 'toggle',
    supportedControls: ['toggle', 'read-only'],
  },
};

export const ALL_DEVICE_CATEGORIES: readonly DeviceCategory[] = Object.keys(
  CATEGORY_METADATA_MAP,
) as readonly DeviceCategory[];

export function getCategoryMetadata(category: DeviceCategory): CategoryMetadata {
  return CATEGORY_METADATA_MAP[category] ?? CATEGORY_METADATA_MAP.other;
}

export function isDeviceCategory(value: unknown): value is DeviceCategory {
  return typeof value === 'string' && value in CATEGORY_METADATA_MAP;
}
