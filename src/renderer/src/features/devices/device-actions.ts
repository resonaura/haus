import { stripOutlets } from '../../model/device-relationships';
import { buildAction, type HausAccessory, type HassEntity } from '../../model';
import type { HomeView } from '../../model/home-view';
import { message, type HausController } from '../../hooks/useHaus';
import { scenePresentation } from '../../model/scene-presentation';
import { visibilityTarget } from '../../model/visibility';
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
}: Props) {
  const { model, mode, preferences, notify } = haus;
  const { appHidden, isFavorite, hiddenAppIds, hiddenHomeIds } = view;
  const run = async (action: ReturnType<typeof buildAction>) => {
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
    haus.savePreferences({
      disabledLightGroups: [
        ...new Set([...(preferences.disabledLightGroups ?? []), item.lightGroup.key]),
      ],
    });
    onLightGroup(null);
    notify(`${item.name} lights are now shown separately.`);
  };
  const visibilityTargetName = (target: string | HausAccessory) => {
    if (typeof target !== 'string') return target.name;
    const scene = model.scenes.find((item) => item.entity_id === target);
    return scene
      ? scenePresentation(scene).name
      : (visibilityTarget(target, model.accessories).accessory?.name ?? 'Accessory');
  };
  const restoreFromApp = (target: string | HausAccessory) => {
    const { accessory, id, entityIds: ids } = visibilityTarget(target, model.accessories);
    const isDefaultHidden = accessory?.defaultHidden;
    haus.savePreferences({
      hiddenApp: preferences.hiddenApp.filter((item) => !ids.includes(item)),
      unhiddenApp: isDefaultHidden
        ? Array.from(new Set([...(preferences.unhiddenApp ?? []), id]))
        : (preferences.unhiddenApp ?? []),
    });
    const name = visibilityTargetName(target);
    notify(`${name} restored to the app.`);
  };
  const toggleAppVisibility = (target: string | HausAccessory) => {
    const { accessory, id, entityIds: ids } = visibilityTarget(target, model.accessories);
    const isCurrentlyHidden = accessory
      ? appHidden(accessory)
      : ids.some((memberId) => hiddenAppIds.has(memberId));
    if (isCurrentlyHidden) {
      const nextHiddenApp = preferences.hiddenApp.filter((item) => !ids.includes(item));
      const nextUnhiddenApp = accessory?.defaultHidden
        ? Array.from(new Set([...(preferences.unhiddenApp ?? []), id]))
        : (preferences.unhiddenApp ?? []);
      haus.savePreferences({
        hiddenApp: nextHiddenApp,
        unhiddenApp: nextUnhiddenApp,
      });
      onSelect(null);
      notify(`${visibilityTargetName(target)} restored to the app.`);
    } else {
      const nextHiddenApp = Array.from(
        new Set([...preferences.hiddenApp, ...(accessory?.lightGroup ? ids : [id])]),
      );
      const nextUnhiddenApp = (preferences.unhiddenApp ?? []).filter((item) => !ids.includes(item));
      haus.savePreferences({
        hiddenApp: nextHiddenApp,
        unhiddenApp: nextUnhiddenApp,
      });
      onSelect(null);
      notify(
        `${visibilityTargetName(target)} hidden from Haus. You can restore it in Hidden at any time.`,
      );
    }
  };
  const toggleHomeVisibility = (target: string | HausAccessory) => {
    const { id, entityIds: ids } = visibilityTarget(target, model.accessories);
    const hidden = ids.some((memberId) => hiddenHomeIds.has(memberId));
    haus.savePreferences({
      hiddenHome: hidden
        ? preferences.hiddenHome.filter((item) => !ids.includes(item))
        : [
            ...preferences.hiddenHome,
            ...(typeof target !== 'string' && target.lightGroup ? ids : [id]),
          ],
    });
    const name = visibilityTargetName(target);
    notify(hidden ? `${name} shown on Home.` : `${name} hidden from Home view.`);
  };
  const openAccessory = (item: HausAccessory) => {
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
  const quick = async (a: HausAccessory) => {
    if (a.powerStrip) {
      const outlets = stripOutlets(a);
      const service = outlets.some((item) => item.state === 'on') ? 'turn_off' : 'turn_on';
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
      notify('Connect Home Assistant to manage your home.');
      onConnect();
      return;
    }
    void window.hausNative
      .openExternal(`${haus.session.url}${path}`)
      .catch((error) => notify(message(error)));
  };
  const toggleFavorite = (item: HausAccessory) => {
    haus.savePreferences({
      favorites: isFavorite(item)
        ? preferences.favorites.filter((id) => !item.entityIds.includes(id))
        : [
            ...preferences.favorites,
            ...(item.lightGroup?.members.map((member) => member.primaryEntityId) ?? [
              item.primaryEntityId,
            ]),
          ],
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
    quick,
    sceneRun,
    openServer,
    toggleFavorite,
  };
}
export type DeviceActions = ReturnType<typeof createDeviceActions>;
