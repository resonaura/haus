import { useCallback, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { HausAccessory, HausRoom } from '../../model';
import type { Preferences } from '../../model/preferences';
import { orderRoomDevices, groupNumberedLights } from '../../model/room-devices';
import { AccessoryTile } from './AccessoryTile';
import { triggerHaptic } from '../../components/ui/haptics';
type Props = {
  items: HausAccessory[];
  children?: ReactNode;
  hiddenView?: boolean;
  className?: string;
  scopeKey: string;
  isHomeOverview: boolean;
  search: string;
  preferences: Preferences;
  rooms: HausRoom[];
  appHidden: (item: HausAccessory) => boolean;
  homeHidden: (item: HausAccessory) => boolean;
  isFavorite: (item: HausAccessory) => boolean;
  savePreferences: (patch: Partial<Preferences>) => void;
  onContextMenu: (event: MouseEvent, item: HausAccessory) => void;
  onRestore: (item: HausAccessory) => void;
  onOpen: (item: HausAccessory) => void;
  onQuick: (item: HausAccessory) => Promise<void>;
};
export function AccessoryGrid({
  items,
  children,
  hiddenView = false,
  className = 'accessory-grid',
  scopeKey,
  isHomeOverview,
  search,
  preferences,
  rooms,
  appHidden,
  homeHidden,
  isFavorite,
  savePreferences,
  onContextMenu,
  onRestore,
  onOpen,
  onQuick,
}: Props) {
  const [dragState, setDragState] = useState<{
    scopeKey: string;
    draggedId: string;
    overId: string | null;
  } | null>(null);
  const lastDragOver = useRef<string | null>(null);
  const getOrderedItems = useCallback(
    (scopeKey: string, items: HausAccessory[], showDragPreview = true): HausAccessory[] => {
      const ordered =
        scopeKey === 'home:quick'
          ? [...items]
          : orderRoomDevices(items, preferences, preferences.deviceOrder?.[scopeKey]);

      if (
        showDragPreview &&
        dragState &&
        dragState.scopeKey === scopeKey &&
        dragState.draggedId &&
        dragState.overId &&
        dragState.draggedId !== dragState.overId
      ) {
        const preview = [...ordered];
        const fromIdx = preview.findIndex((item) => item.id === dragState.draggedId);
        const toIdx = preview.findIndex((item) => item.id === dragState.overId);
        if (fromIdx !== -1 && toIdx !== -1) {
          const [moved] = preview.splice(fromIdx, 1);
          preview.splice(toIdx, 0, moved);
          return preview;
        }
      }

      return ordered;
    },
    [preferences.deviceOrder, preferences.favorites, preferences.manualUsage, dragState],
  );
  const handleTileDrop = useCallback(
    (scopeKey: string, targetId: string, scopeItems?: HausAccessory[], draggedIdParam?: string) => {
      const draggedId = draggedIdParam || dragState?.draggedId;
      if (!draggedId || draggedId === targetId) {
        setDragState(null);
        return;
      }
      const itemsToOrder = scopeItems ?? [];
      const currentIds = itemsToOrder.map((item) => item.id);
      const baseIds = currentIds;

      const fromIndex = baseIds.indexOf(draggedId);
      const toIndex = baseIds.indexOf(targetId);
      if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
        const nextIds = [...baseIds];
        const [moved] = nextIds.splice(fromIndex, 1);
        nextIds.splice(toIndex, 0, moved);
        const nextOrder = {
          ...preferences.deviceOrder,
          [scopeKey]: nextIds,
        };
        savePreferences({ deviceOrder: nextOrder });
      }
      setDragState(null);
    },
    [dragState, preferences.deviceOrder, getOrderedItems, savePreferences],
  );
  const visibleItems = items.filter((a) =>
    hiddenView ? appHidden(a) : !appHidden(a) && (!isHomeOverview || !homeHidden(a)),
  );
  const canGroup = !hiddenView && !search && scopeKey !== 'home:quick';
  const displayItems = groupNumberedLights(
    visibleItems,
    canGroup && preferences.autoGroupLights !== false,
    preferences.disabledLightGroups,
  );
  const ordered = getOrderedItems(scopeKey, displayItems);

  return (
    <div className={className}>
      {ordered.map((a) => (
        <AccessoryTile
          key={a.id}
          accessory={a}
          room={rooms.find((r) => r.id === a.areaId)?.name}
          nameWithRoom={scopeKey === 'category:lights:active'}
          favorite={isFavorite(a)}
          hidden={hiddenView}
          isDragging={dragState?.scopeKey === scopeKey && dragState?.draggedId === a.id}
          isDragOver={
            dragState?.scopeKey === scopeKey &&
            dragState?.overId === a.id &&
            dragState?.draggedId !== a.id
          }
          onDragStart={(e) => {
            if (hiddenView) return;
            lastDragOver.current = null;
            e.dataTransfer.setData('text/plain', a.id);
            e.dataTransfer.effectAllowed = 'move';
            setDragState({ scopeKey, draggedId: a.id, overId: null });
          }}
          onDragOver={(e) => {
            if (hiddenView || !dragState || dragState.scopeKey !== scopeKey) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (dragState.overId !== a.id && dragState.draggedId !== a.id) {
              if (lastDragOver.current !== a.id) triggerHaptic('alignment');
              lastDragOver.current = a.id;
              setDragState((prev) => (prev ? { ...prev, overId: a.id } : null));
            }
          }}
          onDragEnd={() => {
            lastDragOver.current = null;
            setDragState(null);
          }}
          onDrop={(e) => {
            if (hiddenView) return;
            e.preventDefault();
            const draggedId = e.dataTransfer.getData('text/plain') || dragState?.draggedId;
            handleTileDrop(
              scopeKey,
              a.id,
              getOrderedItems(scopeKey, displayItems, false),
              draggedId,
            );
          }}
          onContextMenu={(e) => onContextMenu(e, a)}
          onRestore={() => onRestore(a)}
          onOpen={() => onOpen(a)}
          onQuick={() => void onQuick(a)}
        />
      ))}
      {children}
    </div>
  );
}
