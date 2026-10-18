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
  PersonStanding,
  ScanLine,
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
  Sparkles,
  BookOpen,
  Focus,
  type LucideIcon,
} from 'lucide-react';
import { securityIcon } from '../model/security-icon';
import type { HausAccessory } from '../model';
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
  'Living Room': House,
  Bedroom: BedDouble,
  Kitchen: Utensils,
  Outdoor: Trees,
  Hallway: DoorOpen,
};
export function AccessoryIcon({
  accessory,
  size = 23,
}: {
  accessory: HausAccessory;
  size?: number;
}) {
  const domain = accessory.primaryEntityId.split('.')[0];
  let Icon = categoryIcons[accessory.category] ?? CircleHelp;
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
    motion: PersonStanding,
    clear: ScanLine,
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
export function SceneIcon({ name }: { name: string }) {
  const Icon = /night|sleep/i.test(name)
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
                    : Sparkles;
  return <Icon size={20} strokeWidth={1.75} aria-hidden="true" />;
}
