import { useCallback, useEffect, useState } from 'react';
import type { HausAccessory } from '../../model';
import type { ContextMenuItem } from '../../../../shared/native';
import { message, type HausController } from '../../hooks/useHaus';
import type { HomeView } from '../../model/home-view';
import { isEntityActive } from '../../model/device-appearance';
import type { DeviceActions } from './device-actions';
type Props = { haus: HausController; view: HomeView; actions: DeviceActions };
export function useAccessoryContextMenu({ haus, view, actions }: Props) {
  const { snapshot, notify } = haus;
  const { appHidden, homeHidden, isFavorite } = view;
  const {
    quick,
    openAccessory,
    toggleFavorite,
    toggleHomeVisibility,
    toggleAppVisibility,
    separateLights,
  } = actions;
  const [contextMenu, setContextMenu] = useState<{
    items: ContextMenuItem[];
    x: number;
    y: number;
    accessory: HausAccessory;
  } | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  useEffect(() => {
    window.addEventListener('click', closeContextMenu);
    window.addEventListener('blur', closeContextMenu);
    return () => {
      window.removeEventListener('click', closeContextMenu);
      window.removeEventListener('blur', closeContextMenu);
    };
  }, [closeContextMenu]);
  const isActive = (item: HausAccessory) => isEntityActive(item.state);
  const handleContextAction = useCallback(
    (actionId: string, item: HausAccessory) => {
      setContextMenu(null);
      if (actionId.startsWith('move-room:')) {
        const areaId = actionId.slice('move-room:'.length);
        const nextAreaId = areaId === 'unassigned' ? null : areaId;
        const targets = item.lightGroup?.members ?? [item];
        void Promise.all(
          targets.map((target) =>
            haus.updateEntity(target.primaryEntityId, { area_id: nextAreaId }),
          ),
        )
          .then(() => {
            const roomName = snapshot.areas.find((area) => area.area_id === nextAreaId)?.name;
            notify(`${item.name} moved to ${roomName ?? 'Unassigned'}.`);
          })
          .catch((error) => notify(message(error)));
        return;
      }
      switch (actionId) {
        case 'ungroup':
          separateLights(item);
          break;
        case 'quick':
          void quick(item);
          break;
        case 'details':
          openAccessory(item);
          break;
        case 'favorite':
          toggleFavorite(item);
          break;
        case 'toggle-home':
          toggleHomeVisibility(item);
          break;
        case 'hide-app':
          toggleAppVisibility(item);
          break;
      }
    },
    [
      haus.updateEntity,
      snapshot.areas,
      notify,
      quick,
      openAccessory,
      toggleFavorite,
      toggleHomeVisibility,
      toggleAppVisibility,
    ],
  );
  const showAccessoryContextMenu = useCallback(
    async (event: React.MouseEvent, item: HausAccessory) => {
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      const active = isActive(item);
      const domain = item.primaryEntityId.split('.')[0];
      const quickLabel = item.capabilities.includes('toggle')
        ? active
          ? 'Turn Off'
          : 'Turn On'
        : ['scene', 'script'].includes(domain)
          ? 'Run'
          : ['button', 'input_button'].includes(domain) && item.capabilities.includes('press')
            ? 'Press'
            : undefined;
      const favored = isFavorite(item);
      const homeHiddenState = homeHidden(item);
      const areas = snapshot.areas.map((area) => ({
        id: `move-room:${area.area_id}`,
        label: area.name,
        enabled: area.area_id !== item.areaId,
      }));
      areas.push({
        id: 'move-room:unassigned',
        label: 'Unassigned',
        enabled: item.areaId !== undefined,
      });

      const menuItems: ContextMenuItem[] = [
        ...(quickLabel
          ? [
              { id: 'quick', label: quickLabel, enabled: item.availability === 'available' },
              { id: 'sep1', label: '', type: 'separator' as const },
            ]
          : []),
        { id: 'details', label: 'Accessory Details...' },
        ...(item.lightGroup ? [{ id: 'ungroup', label: 'Show Lights Separately' }] : []),
        {
          id: 'move-room',
          label: 'Move to Room',
          type: 'submenu',
          enabled: snapshot.user.is_admin,
          items: areas,
        },
        { id: 'favorite', label: favored ? 'Remove from Favorites' : 'Add to Favorites' },
        { id: 'sep2', label: '', type: 'separator' as const },
        {
          id: 'toggle-home',
          label: homeHiddenState ? 'Show on Home View' : 'Hide from Home View',
        },
        {
          id: 'hide-app',
          label: appHidden(item) ? 'Restore to Haus' : 'Hide from Haus',
        },
      ];

      if (window.hausNative?.showContextMenu) {
        const selectedId = await window.hausNative.showContextMenu(menuItems);
        if (selectedId) {
          handleContextAction(selectedId, item);
        }
      } else {
        const clickX = event.clientX;
        const clickY = event.clientY;
        const menuWidth = 200;
        const menuHeight = 270;
        const x =
          clickX + menuWidth > window.innerWidth
            ? Math.max(10, window.innerWidth - menuWidth - 10)
            : clickX;
        const y =
          clickY + menuHeight > window.innerHeight
            ? Math.max(10, window.innerHeight - menuHeight - 10)
            : clickY;
        setContextMenu({
          items: menuItems,
          x,
          y,
          accessory: item,
        });
      }
    },
    [
      handleContextAction,
      isFavorite,
      homeHidden,
      appHidden,
      snapshot.areas,
      snapshot.user.is_admin,
    ],
  );

  return { contextMenu, closeContextMenu, handleContextAction, showAccessoryContextMenu };
}
