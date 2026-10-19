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
  if (domain === 'camera') Icon = Camera;
  if (domain === 'fan') Icon = Wind;
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

export function BatteryLevelIcon({ level, size = 15 }: { level: number; size?: number }) {
  const fill = Math.max(0, Math.min(100, level));
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M20 5.25h.6a1.4 1.4 0 0 1 0 2.8H20v2.1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6.3a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1.4Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {fill > 0 && (
        <rect x="4" y="5" width={14 * (fill / 100)} height="4.1" rx=".9" fill="currentColor" />
      )}
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
