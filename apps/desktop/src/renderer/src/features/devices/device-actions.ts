/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { setAccessoryFavorite } from '@haus/ha/view/settings/shared';
import {
  resolveVisibilityTarget,
  restoreFromAppPatch,
  separateLightGroupPatch,
  toggleAppVisibilityPatch,
  toggleHomeVisibilityPatch,
} from '@haus/core/transport';
import { stripMasterOutlet, stripOutlets } from '../../model/device-relationships';
import { buildAction, type HausAccessory, type HassEntity } from '../../model';
import type { HomeView } from '../../model/home-view';
import { message, type HausController } from '../../hooks/useHaus';
import { scenePresentation } from '../../model/scene-presentation';
import { lightGroupActions } from '../../model/room-devices';
export type SelectedLightGroup = { key: string; memberIds: string[] };
type Props = {
  haus: HausController;
  view: HomeView;
  onSelect: (id: string | null) => void;
  onControllerEntity: (id: string | null) => void;
  onCamera: (entity: HassEntity) => void;
  onLightGroup: (group: SelectedLightGroup | null) => void;
  onConnect: () => void;
  onUserLightOff?: (accessoryIds: readonly string[]) => void;
};
/** All device commands go through the existing optimistic queue in useHaus. */
export function createDeviceActions({
  haus,
  view,
  onSelect,
  onControllerEntity,
  onCamera,
  onLightGroup,
  onConnect,
  onUserLightOff,
}: Props) {
  const { model, mode, preferences, notify } = haus;
  const { appHidden, isFavorite, hiddenAppIds } = view;
  const run = async (action: ReturnType<typeof buildAction>) => {
    if (onUserLightOff && (action.service === 'turn_off' || action.service === 'toggle')) {
      const target = model.accessories.find(
        (item) =>
          item.primaryEntityId === action.target.entity_id ||
          item.entityIds.includes(action.target.entity_id),
      );
      if (
        target &&
        target.category === 'lights' &&
        (action.service === 'turn_off' || target.state.state === 'on')
      ) {
        onUserLightOff([target.id]);
      }
    }
    try {
      await haus.act(action);
      if (mode === 'demo' || action.target.entity_id.startsWith('scene.'))
        haus.recordManualUse(action.target.entity_id);
    } catch (error) {
      notify(message(error));
      throw error;
    }
  };
  const runLightGroup = async (item: HausAccessory, action: ReturnType<typeof buildAction>) => {
    if (
      onUserLightOff &&
      item.category === 'lights' &&
      (action.service === 'turn_off' ||
        (action.service === 'toggle' &&
          (item.state.state === 'on' ||
            item.lightGroup?.members.some((member) => member.state.state === 'on'))))
    ) {
      onUserLightOff([item.id, ...(item.lightGroup?.members.map((member) => member.id) ?? [])]);
    }
    const commands = lightGroupActions(item, action);
    const results = await Promise.allSettled(commands.map((command) => haus.act(command)));
    if (mode === 'demo')
      for (let index = 0; index < results.length; index++)
        if (results[index].status === 'fulfilled')
          haus.recordManualUse(commands[index].target.entity_id);
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed) {
      const error = new Error(
        `${failed} of ${commands.length} lights could not be updated. Device states show the actual result.`,
      );
      notify(error.message);
      throw error;
    }
  };
  const separateLights = (item: HausAccessory) => {
    if (!item.lightGroup) return;
    haus.savePreferences(separateLightGroupPatch(item.lightGroup.key, preferences));
    onLightGroup(null);
    notify(`${item.name} lights are now shown separately.`);
  };
  const visibilityTargetName = (target: string | HausAccessory) => {
    if (typeof target !== 'string') return target.name;
    const scene = model.scenes.find((item) => item.entity_id === target);
    return scene
      ? scenePresentation(scene).name
      : (resolveVisibilityTarget(target, model.accessories).accessory?.name ?? 'Accessory');
  };
  const restoreFromApp = (target: string | HausAccessory) => {
    haus.savePreferences(restoreFromAppPatch(target, model.accessories, preferences));
    notify(`${visibilityTargetName(target)} restored to the app.`);
  };
  const toggleAppVisibility = (target: string | HausAccessory) => {
    const isCurrentlyHidden =
      typeof target !== 'string'
        ? appHidden(target)
        : hiddenAppIds.has(target);
    const { hidden, patch } = toggleAppVisibilityPatch(
      target,
      model.accessories,
      preferences,
      isCurrentlyHidden,
    );
    haus.savePreferences(patch);
    onSelect(null);
    const name = visibilityTargetName(target);
    notify(
      hidden
        ? `${name} hidden from Haus. You can restore it in Hidden at any time.`
        : `${name} restored to the app.`,
    );
  };
  const toggleHomeVisibility = (target: string | HausAccessory) => {
    const { hidden, patch } = toggleHomeVisibilityPatch(target, model.accessories, preferences);
    haus.savePreferences(patch);
    const name = visibilityTargetName(target);
    notify(hidden ? `${name} hidden from Home view.` : `${name} shown on Home.`);
  };
  const openExternalUrl = (url: string) => {
    if (window.hausNative) {
      void window.hausNative.openExternal(url).catch((error) => notify(message(error)));
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };
  const openAccessoryDetails = (item: HausAccessory) => {
    if (item.lightGroup) {
      onLightGroup({
        key: item.lightGroup.key,
        memberIds: item.lightGroup.members.map((member) => member.id),
      });
      return;
    }
    if (item.primaryEntityId.split('.')[0] === 'camera') {
      onCamera(item.state);
      return;
    }
    const owner = model.accessories.find((candidate) =>
      candidate.entityIds.includes(item.primaryEntityId),
    );
    onControllerEntity(item.primaryEntityId);
    onSelect(owner?.primaryEntityId ?? item.primaryEntityId);
  };
  const openAccessory = (item: HausAccessory) => {
    if (item.managementUrl) {
      openExternalUrl(item.managementUrl);
      return;
    }
    openAccessoryDetails(item);
  };
  const openEntity = (entityId: string) => {
    const owner = model.accessories.find((item) => item.entityIds.includes(entityId));
    if (owner) openAccessory(owner);
    else onSelect(entityId);
  };
  const openDevice = (deviceId: string) => {
    const owner = model.accessories.find((item) => item.deviceId === deviceId);
    if (owner) {
      openAccessory(owner);
      return;
    }
    const entity = haus.snapshot.entities.find((item) => item.device_id === deviceId);
    if (entity) openEntity(entity.entity_id);
  };
  const quick = async (a: HausAccessory) => {
    if (a.managementUrl) {
      openExternalUrl(a.managementUrl);
      return;
    }
    if (a.powerStrip) {
      const outlets = stripOutlets(a);
      const service = outlets.some((item) => item.state === 'on') ? 'turn_off' : 'turn_on';
      const master = stripMasterOutlet(a);
      if (master) {
        await run({ domain: 'switch', service, target: { entity_id: master.entity_id } });
        return;
      }
      await Promise.allSettled(
        outlets.map((item) =>
          run({ domain: 'switch', service, target: { entity_id: item.entity_id } }),
        ),
      );
      return;
    }
    if (a.lightGroup) {
      try {
        await runLightGroup(a, buildAction(a.state, 'toggle'));
      } catch {
        /* shown in toast */
      }
      return;
    }
    const domain = a.primaryEntityId.split('.')[0];
    const intent = a.capabilities.includes('toggle')
      ? 'toggle'
      : ['scene', 'script'].includes(domain)
        ? 'run'
        : ['button', 'input_button'].includes(domain) && a.capabilities.includes('press')
          ? 'press'
          : undefined;
    if (!intent) {
      openAccessory(a);
      return;
    }
    try {
      await run(buildAction(a.state, intent));
    } catch {
      /* shown in toast */
    }
  };
  const sceneRun = async (scene: HassEntity) => {
    await run(buildAction(scene, 'run'));
    notify(`${scenePresentation(scene).name} applied`);
  };
  const openServer = (path: string) => {
    if (!haus.session || !window.hausNative) {
      notify('Connect your Haus Hub to manage your home.');
      onConnect();
      return;
    }
    void window.hausNative
      .openExternal(`${haus.session.url}${path}`)
      .catch((error) => notify(message(error)));
  };
  const toggleFavorite = (item: HausAccessory) => {
    const canonical = item.lightGroup
      ? item
      : (model.accessories.find((candidate) => candidate.id === item.id) ?? item);
    haus.savePreferences({
      favorites: setAccessoryFavorite(preferences.favorites, canonical, !isFavorite(canonical)),
    });
  };

  return {
    run,
    runLightGroup,
    separateLights,
    restoreFromApp,
    toggleAppVisibility,
    toggleHomeVisibility,
    openAccessory,
    openAccessoryDetails,
    openExternalUrl,
    openEntity,
    openDevice,
    quick,
    sceneRun,
    openServer,
    toggleFavorite,
  };
}
export type DeviceActions = ReturnType<typeof createDeviceActions>;
