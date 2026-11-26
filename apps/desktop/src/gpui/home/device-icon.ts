/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useMemo } from 'react';
import { resolveIconStyle, sanitizeIconStyle } from '@haus/icons';
import { securityIcon } from '@haus/ha/view/device-state';
import { isScaleReading } from '@haus/ha/view/device-telemetry';
import type { Preferences } from '@haus/ha/view/preferences';
import type { HausAccessory } from '@haus/ha/view/types';
import { isKettle } from '@haus/ha/view/water-heater';
import {
  resolveDeviceFallbackIconName,
  type BrandIconPort,
  type DeviceBrandIconInput,
  type UiIconName,
} from '@haus/ui/components';
import { createGpuiStandaloneBrandIconPort } from './brand-service.js';

export function toDeviceBrandIconInput(accessory: HausAccessory): DeviceBrandIconInput {
  return {
    name: accessory.name,
    primaryEntityId: accessory.primaryEntityId,
    category: accessory.category,
    manufacturer: accessory.manufacturer,
    model: accessory.model,
    deviceType: accessory.deviceType,
    deviceClass:
      typeof accessory.state.attributes.device_class === 'string'
        ? accessory.state.attributes.device_class
        : undefined,
    powerStrip: Boolean(accessory.powerStrip),
    buttonController: Boolean(accessory.buttonController),
    physicalHub: Boolean(accessory.physicalHub),
    securityIconKey: securityIcon(accessory.state) ?? undefined,
    isScale: isScaleReading(accessory.state, {
      id: accessory.deviceId ?? '',
      name: accessory.name,
      model: accessory.model,
    }),
    isKettle: accessory.primaryEntityId.startsWith('water_heater.') && isKettle(accessory),
  };
}

export function resolveAccessoryIconName(accessory: HausAccessory): UiIconName {
  return resolveDeviceFallbackIconName(toDeviceBrandIconInput(accessory));
}

const DEFAULT_GPUI_BRAND_PORT: BrandIconPort = createGpuiStandaloneBrandIconPort();

/** Merges optional runtime brand resolvers with user icon-style preferences and local Skia fallback. */
export function resolveGpuiBrandIconPort(
  runtimePort: BrandIconPort | undefined,
  preferences: Preferences,
  dark: boolean,
): BrandIconPort {
  const iconStyle = resolveIconStyle(
    sanitizeIconStyle({
      appearance: preferences.iconAppearance,
      variation: preferences.iconVariation,
      tintColor: preferences.iconTintColor,
    }),
    dark,
  );
  return {
    ...(runtimePort ?? DEFAULT_GPUI_BRAND_PORT),
    iconStyle,
  };
}

/** Memoized GPUIX `BrandIconPort` reacting cleanly to theme & icon-style preferences. */
export function useGpuiBrandIconPort(
  runtimePort: BrandIconPort | undefined,
  preferences: Preferences,
  dark: boolean,
): BrandIconPort {
  return useMemo(
    () => resolveGpuiBrandIconPort(runtimePort, preferences, dark),
    [
      runtimePort,
      preferences.iconAppearance,
      preferences.iconVariation,
      preferences.iconTintColor,
      dark,
    ],
  );
}
