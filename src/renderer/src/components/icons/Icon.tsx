import { useId } from 'react';
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
  BatteryMedium,
  MoonStar,
  Sun,
  Sunrise,
  Sunset,
  Clapperboard,
  Armchair,
  DoorOpen,
  DoorClosed,
  ShieldAlert,
  ShieldOff,
  LockKeyhole,
  LockKeyholeOpen,
  Radar,
  DropletOff,
  AlarmSmoke,
  Flame,
  Lamp,
  Wind,
  Utensils,
  BedDouble,
  Trees,
  CircleHelp,
  Printer,
  Router,
  PawPrint,
  CarFront,
  Sparkles,
  BookOpen,
  Focus,
  Vibrate,
  Radio,
  CircuitBoard,
  ToggleLeft,
  Bath,
  Tv,
  type LucideIcon,
} from 'lucide-react';
import { mediaArtwork } from '../../model/media-artwork';
import { securityIcon } from '../../model/security-icon';
import { isScaleReading } from '../../model/device-telemetry';
import { BathroomScaleIcon } from './BathroomScaleIcon';
import { KettleIcon } from './KettleIcon';
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
export function AccessoryIcon({
  accessory,
  size = 23,
}: {
  accessory: HausAccessory;
  size?: number;
}) {
  const domain = accessory.primaryEntityId.split('.')[0];
  const artwork = mediaArtwork(accessory);
  if (artwork)
    return (
      <span
        className="device-state-icon device-brand-icon"
        dangerouslySetInnerHTML={{ __html: artwork }}
      />
    );
  let Icon = categoryIcons[accessory.category] ?? CircleHelp;
  if (accessory.powerStrip) Icon = CircuitBoard;
  if (accessory.buttonController) Icon = ToggleLeft;
  if (accessory.physicalHub) Icon = Radio;
  if (
    isScaleReading(accessory.state, {
      id: accessory.deviceId ?? '',
      name: accessory.name,
      model: accessory.model,
    })
  )
    Icon = BathroomScaleIcon;
  if (domain === 'camera') Icon = Camera;
  if (domain === 'fan') Icon = Wind;
  if (domain === 'water_heater' && isKettle(accessory)) Icon = KettleIcon;
  if (accessory.name.toLowerCase().includes('lamp')) Icon = Lamp;
  if (accessory.state.attributes.device_class === 'battery') Icon = BatteryMedium;
  const stateIcon = securityIcon(accessory.state);
  const icons: Record<string, LucideIcon> = {
    'door-open': DoorOpen,
    'door-closed': DoorClosed,
    locked: LockKeyhole,
    unlocked: LockKeyholeOpen,
    motion: Radar,
    clear: Radar,
    vibration: Vibrate,
    'vibration-clear': Vibrate,
    wet: Droplets,
    dry: DropletOff,
    smoke: AlarmSmoke,
    fire: Flame,
    alert: ShieldAlert,
    protected: ShieldCheck,
    disarmed: ShieldOff,
    unknown: CircleHelp,
  };
  if (stateIcon?.startsWith('window-'))
    return (
      <span className="device-state-icon" key={stateIcon}>
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="4" y="4" width="16" height="16" rx="1.5" />
          <path d="M4 12h16M12 4v16" />
          {stateIcon === 'window-open' ? (
            <path d="m12 4 6 3v10l-6 3M18 12h2" />
          ) : (
            <path d="M6.5 14.5v3h3" />
          )}
        </svg>
      </span>
    );
  Icon = stateIcon ? (icons[stateIcon] ?? Icon) : Icon;
  return (
    <span className="device-state-icon" key={stateIcon ?? Icon.displayName}>
      <Icon size={size} strokeWidth={1.65} aria-hidden="true" />
    </span>
  );
}

// Geometry matched to the running macOS 27 menu-bar indicator at Retina scale.
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
    <svg
      className={`battery-level-icon ${charging || powerConnected ? 'is-charging' : ''} ${typeof level === 'number' && level <= 20 ? 'is-low' : ''}`}
      viewBox="0 0 26 15"
      style={{ width: (size * 26) / 15, height: size }}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={`${id}-level`}>
          <path d={batteryBodyPath} />
        </clipPath>
        <mask id={`${id}-charge`} maskUnits="userSpaceOnUse" x="0" y="0" width="26" height="15">
          <rect width="26" height="15" fill="white" />
          <path
            className="battery-charge-cutout"
            d={batteryBoltPath}
            fill="black"
            stroke="black"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </mask>
      </defs>
      <g mask={`url(#${id}-charge)`}>
        <g transform="translate(0 1.5)">
          <path className="battery-level-shell" d={batteryBodyPath} />
          <rect
            className="battery-level-fill"
            x="0"
            y="0"
            height="12"
            clipPath={`url(#${id}-level)`}
            style={{ width: fillWidth }}
          />
        </g>
        <path className="battery-level-terminal" d="M24 5.5a2 2 0 0 1 0 4Z" />
      </g>
      <path className="battery-charge-bolt" d={batteryBoltPath} />
    </svg>
  );
}
export function SceneIcon({ name, icon }: { name: string; icon?: string }) {
  const custom: Record<string, LucideIcon> = {
    'mdi:weather-night': MoonStar,
    'mdi:white-balance-sunny': Sun,
    'mdi:sofa': Armchair,
    'mdi:movie-open': Clapperboard,
    'mdi:book-open-variant': BookOpen,
    'mdi:home': House,
    'mdi:sparkles': Sparkles,
  };
  const Icon =
    custom[icon ?? ''] ??
    (/night|sleep/i.test(name)
      ? MoonStar
      : /movie|cinema|netflix/i.test(name)
        ? Clapperboard
        : /away|leave/i.test(name)
          ? DoorOpen
          : /relax|chill/i.test(name)
            ? Armchair
            : /read/i.test(name)
              ? BookOpen
              : /concentrate|focus/i.test(name)
                ? Focus
                : /energ/i.test(name)
                  ? Sunrise
                  : /dim|sunset/i.test(name)
                    ? Sunset
                    : /bright|day|morning/i.test(name)
                      ? Sun
                      : Sparkles);
  return <Icon size={20} strokeWidth={1.75} aria-hidden="true" />;
}
