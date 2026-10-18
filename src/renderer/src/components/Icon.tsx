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
  const deviceLabel = [
    accessory.name,
    accessory.manufacturer,
    accessory.model,
    accessory.state.attributes.friendly_name,
  ]
    .filter(Boolean)
    .join(' ');
  const mediaBrand =
    domain === 'media_player' && /home\s*pod/i.test(deviceLabel)
      ? 'homepod'
      : domain === 'media_player' && /apple\s*tv|tvos/i.test(deviceLabel)
        ? 'apple-tv'
        : domain === 'media_player' && /google|nest\s+(?:audio|mini|hub)/i.test(deviceLabel)
          ? 'google-speaker'
          : undefined;
  if (mediaBrand)
    return (
      <span className={`device-state-icon device-brand-icon device-brand-icon--${mediaBrand}`}>
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          {mediaBrand === 'apple-tv' ? (
            <path d="M20.57 17.735h-1.815l-3.34-9.203h1.633l2.02 5.987c.075.231.273.9.586 2.012l.297-.997.33-1.006 2.094-6.004H24zm-5.344-.066a5.76 5.76 0 0 1-1.55.207c-1.23 0-1.84-.693-1.84-2.087V9.646h-1.063V8.532h1.121V7.081l1.476-.602v2.062h1.707v1.113H13.38v5.805c0 .446.074.75.214.932.14.182.396.264.75.264.207 0 .495-.041.883-.115zm-7.29-5.343c.017 1.764 1.55 2.358 1.567 2.366-.017.042-.248.842-.808 1.658-.487.71-.99 1.418-1.79 1.435-.783.016-1.03-.462-1.93-.462-.89 0-1.17.445-1.913.478-.758.025-1.344-.775-1.838-1.484-.998-1.451-1.765-4.098-.734-5.88.51-.89 1.426-1.451 2.416-1.46.75-.016 1.468.512 1.93.512.461 0 1.327-.627 2.234-.536.38.016 1.452.157 2.136 1.154-.058.033-1.278.743-1.27 2.219M6.468 7.988c.404-.495.685-1.18.61-1.864-.585.025-1.294.388-1.723.883-.38.437-.71 1.138-.619 1.806.652.05 1.328-.338 1.732-.825Z" />
          ) : mediaBrand === 'google-speaker' ? (
            <path d="M22.365 8.729c.9 0 1.635-.735 1.635-1.635s-.735-1.636-1.635-1.636-1.636.735-1.636 1.636.723 1.635 1.636 1.635m-4.907 5.452a3.27 3.27 0 1 0 0-6.542 3.27 3.27 0 0 0 0 6.542m0 8.722c2.105 0 3.816-1.711 3.816-3.829s-1.711-3.816-3.829-3.816a3.82 3.82 0 0 0-3.816 3.816 3.825 3.825 0 0 0 3.829 3.83M6.542 14.18a6.542 6.542 0 1 0 0-13.084 6.542 6.542 0 1 0 0 13.084" />
          ) : (
            <>
              <path d="M7.2 4.7c0-.9 1.9-1.6 4.8-1.6s4.8.7 4.8 1.6l1.6 12.6c.2 2.2-2.4 3.7-6.4 3.7s-6.6-1.5-6.4-3.7L7.2 4.7Z" />
              <path
                d="M7.8 5c.6.5 2.1.8 4.2.8s3.6-.3 4.2-.8"
                fill="none"
                stroke="var(--canvas)"
                strokeWidth=".75"
              />
              <circle cx="9" cy="9" r=".45" fill="var(--canvas)" />
              <circle cx="12" cy="9" r=".45" fill="var(--canvas)" />
              <circle cx="15" cy="9" r=".45" fill="var(--canvas)" />
              <circle cx="8.8" cy="12" r=".45" fill="var(--canvas)" />
              <circle cx="11.8" cy="12" r=".45" fill="var(--canvas)" />
              <circle cx="14.8" cy="12" r=".45" fill="var(--canvas)" />
              <circle cx="8.5" cy="15" r=".45" fill="var(--canvas)" />
              <circle cx="11.5" cy="15" r=".45" fill="var(--canvas)" />
              <circle cx="14.5" cy="15" r=".45" fill="var(--canvas)" />
            </>
          )}
        </svg>
      </span>
    );
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
