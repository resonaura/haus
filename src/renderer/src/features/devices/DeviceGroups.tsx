import type { ReactNode, RefObject } from 'react';
import { ChevronRight, LayoutGrid } from 'lucide-react';
import type { HausAccessory, HausModel, HausRoom } from '../../model';
import type { Preferences } from '../../model/preferences';
import type { Route } from '../../app/navigation';
import { categories } from '../../model/categories';
import { titleCase } from '../../model/presentation';
import { groupNumberedLights, roomDevicePriority } from '../../model/room-devices';
import { categoryIcons, roomIconFor } from '../../components/icons/Icon';
import { VirtualSections } from '../../components/ui/VirtualSections';
import { activeLights } from '../../model/active-lights';
type Props = {
  items: HausAccessory[];
  grouping: 'category' | 'room';
  hiddenView?: boolean;
  preferences: Preferences;
  search: string;
  orderedRooms: HausRoom[];
  model: HausModel;
  scrollRef: RefObject<HTMLDivElement | null>;
  route: Route;
  go: (route: Route) => void;
  renderGrid: (
    items: HausAccessory[],
    hidden?: boolean,
    className?: string,
    scope?: string,
  ) => ReactNode;
};
export function DeviceGroups({
  items,
  grouping,
  hiddenView = false,
  preferences,
  search,
  orderedRooms,
  model,
  scrollRef,
  route,
  go,
  renderGrid,
}: Props) {
  const activeKey = 'active-lights';
  const active =
    !hiddenView && grouping === 'room' && route.kind === 'category' && route.id === 'lights'
      ? activeLights(items)
      : [];
  const activeIds = new Set(active.map((item) => item.id));
  const groups = new Map<string, HausAccessory[]>();
  if (active.length) groups.set(activeKey, active);
  for (const item of items) {
    if (activeIds.has(item.id)) continue;
    const key = grouping === 'category' ? item.category : item.areaId || 'unassigned';
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const orderedKeys =
    grouping === 'category'
      ? categories
          .map((category) => category.id)
          .filter((id) => groups.has(id))
          .sort(
            (a, b) =>
              Math.min(
                ...groups.get(a)!.map((item) => roomDevicePriority(item, preferences.favorites)),
              ) -
              Math.min(
                ...groups.get(b)!.map((item) => roomDevicePriority(item, preferences.favorites)),
              ),
          )
      : [
          ...(active.length ? [activeKey] : []),
          ...orderedRooms.map((item) => item.id).filter((id) => groups.has(id)),
          ...[...groups.keys()].filter(
            (id) => id !== activeKey && !model.rooms.some((item) => item.id === id),
          ),
        ];

  return (
    <VirtualSections
      items={orderedKeys}
      getKey={(key) => key}
      scrollRef={scrollRef}
      estimateHeight={(key, columns) =>
        74 +
        Math.ceil(
          groupNumberedLights(
            groups.get(key) ?? [],
            !hiddenView && !search && preferences.autoGroupLights !== false,
            preferences.disabledLightGroups,
          ).length / columns,
        ) *
          (hiddenView ? 196 : 137)
      }
      renderSection={(key) => {
        const groupItems = groups.get(key) ?? [];
        const category = categories.find((item) => item.id === key);
        const room = model.rooms.find((item) => item.id === key);
        const Icon =
          key === activeKey
            ? categoryIcons.lights
            : grouping === 'category'
              ? categoryIcons[key]
              : room
                ? roomIconFor(room.name, preferences.roomIcons?.[room.id])
                : undefined;
        const label =
          key === activeKey
            ? 'On Now'
            : grouping === 'category'
              ? (category?.name ?? titleCase(key))
              : (room?.name ?? 'Unassigned');

        return (
          <section
            className={`device-group ${grouping === 'category' ? `device-group--${key}` : ''}`}
            data-category={grouping === 'category' ? key : undefined}
            key={key}
          >
            <div className="device-group-heading">
              <span
                className={`device-group-icon ${grouping === 'category' ? `device-group-icon--${key}` : ''}`}
              >
                {Icon ? <Icon size={16} strokeWidth={1.7} /> : <LayoutGrid size={16} />}
              </span>
              <h2>
                {route.kind === 'category' && grouping === 'room' && room ? (
                  <button className="group-room-link" onClick={() => go({ kind: 'room', id: key })}>
                    {label}
                    <ChevronRight size={14} />
                  </button>
                ) : (
                  label
                )}
              </h2>
              <span className="device-group-count">
                {groupItems.length} {groupItems.length === 1 ? 'device' : 'devices'}
              </span>
              <span className="device-group-rule" />
            </div>
            {renderGrid(
              groupItems,
              hiddenView,
              'accessory-grid',
              key === activeKey
                ? 'category:lights:active'
                : grouping === 'category'
                  ? `category:${key}:${route.kind === 'room' ? route.id : 'global'}`
                  : `room:${key}:${route.kind === 'category' ? route.id : 'global'}`,
            )}
          </section>
        );
      }}
    />
  );
}
