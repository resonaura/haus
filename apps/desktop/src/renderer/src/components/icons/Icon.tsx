/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useId } from 'react';
import { DeviceBrandIcon, px, VectorGraphic } from '@haus/ui';
import {
  House,
  Lightbulb,
  Thermometer,
  ShieldCheck,
  Speaker,
  Droplets,
  Plug,
  Blinds,
  LayoutGrid,
  Camera,
  Armchair,
  DoorOpen,
  Utensils,
  BedDouble,
  Trees,
  Printer,
  Router,
  Network,
  Wifi,
  Globe,
  Shield,
  HardDrive,
  PawPrint,
  CarFront,
  Sparkles,
  Radio,
  Bath,
  Tv,
  CookingPot,
  Activity,
  Bot,
  type LucideIcon,
} from 'lucide-react';
import { securityIcon } from '../../model/security-icon';
import { isScaleReading } from '../../model/device-telemetry';
import { isKettle } from '../../model/water-heater';
import type { HausAccessory } from '../../model';
export const categoryIcons: Record<string, LucideIcon> = {
  lights: Lightbulb,
  climate: Thermometer,
  security: ShieldCheck,
  media: Speaker,
  water: Droplets,
  outlets: Plug,
  covers: Blinds,
  printers: Printer,
  network: Router,
  sensors: Activity,
  appliances: CookingPot,
  robotics: Bot,
  other: LayoutGrid,
};
export const roomIcons: Record<string, LucideIcon> = {
  'Living Room': Armchair,
  'Guinea Pigs': PawPrint,
  Narnia: Sparkles,
  'TV Place': Tv,
  Bathroom: Bath,
  Michael: BedDouble,
  Bedroom: BedDouble,
  Kitchen: Utensils,
  Outdoor: Trees,
  Hallway: DoorOpen,
};
export const roomIconOptions: Array<{ id: string; label: string; icon: LucideIcon }> = [
  { id: 'auto', label: 'Automatic', icon: LayoutGrid },
  { id: 'home', label: 'Home', icon: House },
  { id: 'living', label: 'Living room', icon: Armchair },
  { id: 'bedroom', label: 'Bedroom', icon: BedDouble },
  { id: 'kitchen', label: 'Kitchen', icon: Utensils },
  { id: 'outdoor', label: 'Outdoors', icon: Trees },
  { id: 'hallway', label: 'Hallway', icon: DoorOpen },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'lights', label: 'Lighting', icon: Lightbulb },
  { id: 'climate', label: 'Climate', icon: Thermometer },
  { id: 'water', label: 'Water', icon: Droplets },
  { id: 'media', label: 'Media', icon: Speaker },
  { id: 'camera', label: 'Camera', icon: Camera },
  { id: 'printer', label: 'Printer', icon: Printer },
  { id: 'network', label: 'Network', icon: Router },
  { id: 'bathroom', label: 'Bathroom', icon: Bath },
  { id: 'retreat', label: 'Retreat', icon: Sparkles },
  { id: 'tv', label: 'TV room', icon: Tv },
  { id: 'pets', label: 'Pets', icon: PawPrint },
  { id: 'garage', label: 'Garage', icon: CarFront },
];
export function roomIconFor(name: string, customId?: string): LucideIcon {
  return (
    roomIconOptions.find((item) => item.id === customId && item.id !== 'auto')?.icon ??
    roomIcons[name] ??
    LayoutGrid
  );
}
export function networkDeviceIcon(deviceType?: string): LucideIcon {
  switch (deviceType) {
    case 'network_switch':
    case 'bridge':
      return Network;
    case 'repeater':
      return Wifi;
    case 'access_point':
      return Radio;
    case 'modem':
      return Globe;
    case 'firewall':
      return Shield;
    case 'nas':
      return HardDrive;
    default:
      return Router;
  }
}

export function AccessoryIcon({
  accessory,
  size = 23,
}: {
  accessory: HausAccessory;
  size?: number;
}) {
  return (
    <DeviceBrandIcon
      size={size}
      device={{
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
      }}
    />
  );
}

// Independently reconstructed geometry matched to the menu-bar battery indicator.
// No system image, symbol or asset-catalog resources are bundled with the app.
// Its filled continuous-corner body is 23×12, with a 1pt gap before the half-circle cap.
const batteryBodyPath =
  'M17.865 0c1.1017 0 1.6525 0 2.1071.1091a3.95 3.95 0 0 1 2.9188 2.9188C23 3.4825 23 4.0333 23 5.135v1.73c0 1.1017 0 1.6525-.1091 2.1071a3.95 3.95 0 0 1-2.9188 2.9188C19.5175 12 18.9667 12 17.865 12H5.135c-1.1017 0-1.6525 0-2.1071-.1091A3.95 3.95 0 0 1 .1091 8.9721C0 8.5175 0 7.9667 0 6.865v-1.73c0-1.1017 0-1.6525.1091-2.1071A3.95 3.95 0 0 1 3.0279.1091C3.4825 0 4.0333 0 5.135 0Z';
const batteryBoltPath =
  'M13.23.87c.35-.43.99-.16.81.36l-1.65 4.72h3.45c.46 0 .67.53.37.88l-6.13 7.29c-.36.43-.99.16-.81-.36l1.66-4.71H7.47c-.47 0-.67-.53-.37-.88Z';

export function BatteryLevelIcon({
  level,
  charging = false,
  powerConnected = false,
  size = 15,
}: {
  level?: number;
  charging?: boolean;
  powerConnected?: boolean;
  size?: number;
}) {
  const id = useId().replace(/:/g, '');
  const fillWidth =
    typeof level === 'number' && Number.isFinite(level)
      ? (23 * Math.max(0, Math.min(100, level))) / 100
      : 0;
  return (
    <VectorGraphic
      className={`battery-level-icon ${charging || powerConnected ? 'is-charging' : ''} ${typeof level === 'number' && level <= 20 ? 'is-low' : ''}`}
      viewWidth={26}
      viewHeight={15}
      style={{ layout: { width: px((size * 26) / 15), height: px(size) } }}
      ariaHidden
      focusable={false}
      clipPaths={[{ id: `${id}-level`, path: batteryBodyPath }]}
      masks={[
        {
          id: `${id}-charge`,
          width: 26,
          height: 15,
          cutoutPath: batteryBoltPath,
          cutoutClassName: 'battery-charge-cutout',
          cutoutStrokeWidth: 2.3,
        },
      ]}
      groupMaskId={`${id}-charge`}
      innerGroupTransform="translate(0 1.5)"
      rects={[
        {
          className: 'battery-level-fill',
          x: 0,
          y: 0,
          height: 12,
          clipPathId: `${id}-level`,
          styleWidth: fillWidth,
          inGroup: true,
        },
      ]}
      paths={[
        { className: 'battery-level-shell', d: batteryBodyPath, inGroup: true },
        { className: 'battery-level-terminal', d: 'M24 5.5a2 2 0 0 1 0 4Z', inGroup: false },
        { className: 'battery-charge-bolt', d: batteryBoltPath, afterGroup: true },
      ]}
    />
  );
}
export { SceneIcon } from '@haus/ui';
