/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { px } from '../../ir/geometry.js';
import { VectorGraphic } from '../../primitives/media.js';
import { UiIcon } from '../icon.js';
import { DEVICE_ICONS, type UiIconName } from '../icons.js';
import { resolveDeviceBrandArtwork } from './device-artworks.js';
import type { DeviceBrandArtwork, DeviceBrandIconInput } from './types.js';

const SECURITY_ICON_MAP: Readonly<Record<string, UiIconName>> = {
  'door-open': 'door-open',
  'door-closed': 'door-closed',
  locked: 'lock-keyhole',
  unlocked: 'lock-keyhole-open',
  motion: 'radar',
  clear: 'radar',
  vibration: 'vibrate',
  'vibration-clear': 'vibrate',
  wet: 'droplets',
  dry: 'droplet-off',
  smoke: 'alarm-smoke',
  fire: 'flame',
  alert: 'shield-alert',
  protected: 'shield-check',
  disarmed: 'shield-off',
  unknown: 'circle-help',
};

function networkDeviceIconName(deviceType?: string): UiIconName {
  switch (deviceType) {
    case 'network_switch':
    case 'bridge':
      return 'network';
    case 'repeater':
      return 'wifi';
    case 'access_point':
      return 'radio';
    case 'modem':
      return 'globe';
    case 'firewall':
      return 'shield';
    case 'nas':
      return 'hard-drive';
    default:
      return 'router';
  }
}

export function resolveDeviceFallbackIconName(device: DeviceBrandIconInput): UiIconName {
  const domain = device.primaryEntityId?.split('.')[0] ?? '';
  const categoryKey = device.category as keyof typeof DEVICE_ICONS | undefined;
  let icon: UiIconName =
    categoryKey && Object.hasOwn(DEVICE_ICONS, categoryKey)
      ? DEVICE_ICONS[categoryKey]
      : 'circle-help';

  if (device.category === 'network' && device.deviceType) {
    icon = networkDeviceIconName(device.deviceType);
  }
  if (device.powerStrip) icon = 'circuit-board';
  if (device.buttonController) icon = 'toggle-left';
  if (device.physicalHub) icon = 'radio';
  if (domain === 'camera') icon = 'camera';
  if (domain === 'media_player' && device.deviceClass === 'tv') icon = 'tv';
  if (domain === 'fan') icon = 'wind';
  if (
    (device.category === 'lights' || device.category === 'outlets') &&
    device.name.toLowerCase().includes('lamp')
  ) {
    icon = 'lamp';
  }
  if (device.deviceClass === 'battery') icon = 'battery-medium';
  if (device.securityIconKey && SECURITY_ICON_MAP[device.securityIconKey]) {
    return SECURITY_ICON_MAP[device.securityIconKey]!;
  }
  return icon;
}

export function BathroomScaleGlyph({
  size = 19,
  color = 'currentColor',
  strokeWidth = 1.65,
  className,
}: {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
  readonly className?: string;
}) {
  return (
    <VectorGraphic
      width={size}
      height={size}
      viewWidth={24}
      viewHeight={24}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      ariaHidden
      rects={[{ x: 4, y: 3, width: 16, height: 18, rx: 4, fill: 'none', stroke: color }]}
      paths={[
        {
          d: 'M8 9a4 4 0 0 1 8 0H8ZM12 9l1.5-2.3M8.5 15.5v2M15.5 15.5v2',
          fill: 'none',
          stroke: color,
        },
      ]}
    />
  );
}

export function KettleGlyph({
  size = 19,
  color = 'currentColor',
  strokeWidth = 1.65,
  className,
}: {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
  readonly className?: string;
}) {
  return (
    <VectorGraphic
      width={size}
      height={size}
      viewWidth={24}
      viewHeight={24}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      ariaHidden
      paths={[
        {
          d: 'M6 8h10l1.5 10.5A2 2 0 0 1 15.5 21h-9a2 2 0 0 1-2-2.5L6 8Zm2-3h6v3M5.5 11 2 9l2 7M17 10h2a3 3 0 0 1 0 6h-1.2M8 2l1 1m3-1 1 1M8 18h6',
          fill: 'none',
          stroke: color,
        },
      ]}
    />
  );
}

export function WindowGlyph({
  open,
  size = 19,
  color = 'currentColor',
  strokeWidth = 1.65,
  className,
}: {
  readonly open: boolean;
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
  readonly className?: string;
}) {
  return (
    <VectorGraphic
      width={size}
      height={size}
      viewWidth={24}
      viewHeight={24}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      ariaHidden
      rects={[{ x: 4, y: 4, width: 16, height: 16, rx: 1.5, fill: 'none', stroke: color }]}
      paths={[
        { d: 'M4 12h16M12 4v16', fill: 'none', stroke: color },
        open
          ? { d: 'm12 4 6 3v10l-6 3M18 12h2', fill: 'none', stroke: color }
          : { d: 'M6.5 14.5v3h3', fill: 'none', stroke: color },
      ]}
    />
  );
}

function fitBrandArtworkBox(
  artwork: DeviceBrandArtwork,
  size: number,
): { readonly width: number; readonly height: number } {
  // Wide wordmarks (e.g. eero, Apple TV) stay crisp and readable inside the 38px orb.
  const maxWidth = artwork.aspectRatio > 1.35 ? Math.round(size * 1.32) : Math.round(size * 1.08);
  const maxHeight = Math.round(size * 1.04);
  if (artwork.aspectRatio >= 1) {
    const width = maxWidth;
    const height = Math.max(7, Math.round(width / artwork.aspectRatio));
    if (height <= maxHeight) return { width, height };
    return {
      width: Math.max(8, Math.round(maxHeight * artwork.aspectRatio)),
      height: maxHeight,
    };
  }
  const height = maxHeight;
  const width = Math.max(8, Math.round(height * artwork.aspectRatio));
  return { width, height };
}

/**
 * Shared device icon component used across Home device tiles, details modals,
 * Spotlight search, and device inventory on both Electron and GPUIX.
 */
export function DeviceBrandIcon({
  device,
  size = 19,
  color = 'currentColor',
  strokeWidth = 1.65,
  fallbackIconName,
  className,
}: {
  readonly device: DeviceBrandIconInput;
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
  readonly fallbackIconName?: UiIconName;
  readonly className?: string;
}) {
  const artwork = resolveDeviceBrandArtwork(device);
  if (artwork) {
    const box = fitBrandArtworkBox(artwork, size);
    const mergedClass = className
      ? `${className} device-state-icon device-brand-icon`
      : 'device-state-icon device-brand-icon';
    return (
      <VectorGraphic
        width={box.width}
        height={box.height}
        viewWidth={artwork.viewWidth}
        viewHeight={artwork.viewHeight}
        stroke={color}
        ariaHidden
        className={mergedClass}
        style={{ layout: { width: px(box.width), height: px(box.height), flexShrink: 0 } }}
        rawSvgMarkup={artwork.svg}
      />
    );
  }
  if (device.isScale) {
    return (
      <BathroomScaleGlyph
        size={size}
        color={color}
        strokeWidth={strokeWidth}
        className={className ? `${className} device-state-icon` : 'device-state-icon'}
      />
    );
  }
  if (device.isKettle) {
    return (
      <KettleGlyph
        size={size}
        color={color}
        strokeWidth={strokeWidth}
        className={className ? `${className} device-state-icon` : 'device-state-icon'}
      />
    );
  }
  if (device.securityIconKey === 'window-open' || device.securityIconKey === 'window-closed') {
    return (
      <WindowGlyph
        open={device.securityIconKey === 'window-open'}
        size={size}
        color={color}
        strokeWidth={strokeWidth}
        className={className ? `${className} device-state-icon` : 'device-state-icon'}
      />
    );
  }
  const iconName = fallbackIconName ?? resolveDeviceFallbackIconName(device);
  return <UiIcon name={iconName} size={size} color={color} strokeWidth={strokeWidth} />;
}
