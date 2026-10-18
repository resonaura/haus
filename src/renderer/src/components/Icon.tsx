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
  return <Icon size={size} strokeWidth={1.65} />;
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
