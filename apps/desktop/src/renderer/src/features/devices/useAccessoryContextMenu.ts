/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useCallback, useEffect, useState } from 'react';
import { buildDeviceMenuOptions, resolveMoveRoomAreaId } from '@haus/core/transport';
import { isEntityActive } from '../../model/device-appearance';
import type { HausAccessory } from '../../model';
import type { ContextMenuItem } from '../../../../shared/native';
import { message, type HausController } from '../../hooks/useHaus';
import type { HomeView } from '../../model/home-view';
import type { DeviceActions } from './device-actions';
type Props = { haus: HausController; view: HomeView; actions: DeviceActions };
export function useAccessoryContextMenu({ haus, view, actions }: Props) {
  const { snapshot, notify } = haus;
  const { appHidden, homeHidden, isFavorite } = view;
  const {
    quick,
    openAccessoryDetails,
    openExternalUrl,
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
  const handleContextAction = useCallback(
    (actionId: string, item: HausAccessory) => {
      setContextMenu(null);
      const nextAreaId = resolveMoveRoomAreaId(actionId);
      if (nextAreaId !== undefined) {
        const targets = item.lightGroup?.members ?? [item];
        void Promise.all(
          targets.map((target) => {
            const canonical =
              haus.model.accessories.find((candidate) => candidate.id === target.id) ?? target;
            return haus.updateEntity(canonical.primaryEntityId, { area_id: nextAreaId });
          }),
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
        case 'open-browser':
          if (item.managementUrl) openExternalUrl(item.managementUrl);
          break;
        case 'quick':
          void quick(item);
          break;
        case 'details':
          openAccessoryDetails(item);
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
      openAccessoryDetails,
      openExternalUrl,
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
      const menuItems: ContextMenuItem[] = buildDeviceMenuOptions({
        primaryEntityId: item.primaryEntityId,
        areaId: item.areaId,
        capabilities: item.capabilities,
        isActive: isEntityActive(item.state),
        available: item.availability === 'available',
        isLightGroup: Boolean(item.lightGroup),
        managementUrl: item.managementUrl,
        areas: snapshot.areas,
        isAdmin: snapshot.user.is_admin,
        isFavorite: isFavorite(item),
        isHomeHidden: homeHidden(item),
        isAppHidden: appHidden(item),
      });

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
