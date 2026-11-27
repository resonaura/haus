/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { lightColor } from '@haus/core/optimistic';
import {
  DEFAULT_HUE_BUTTON_EVENT_TYPES,
  describeAutomationMigration,
  formatSceneTargetSetting,
  isScenePickerTarget,
  parseRgbColorString,
  type AutomationTemplateContext,
  type EditableConfig,
  type ParseAutomationFlowOptions,
} from '@haus/core/transport';
import type { HassEntity, Snapshot } from '@haus/ha/types';
import { deviceDisplayName } from '@haus/ha/view/device-name';
import { normalizeHome } from '@haus/ha/view/normalize';
import { describeAccessory } from '@haus/ha/view/presentation';
import { sceneCard } from '@haus/ha/view/scene-presentation';
import type {
  AutomationButtonControllerChoice,
  AutomationButtonEndpointChoice,
  AutomationEntityChoice,
  AutomationSceneChoice,
  DeviceBrandIconInput,
  EditableEntitySeed,
  PortableAutomationItem,
  PortableSceneTargetDetail,
  SceneControllableDevice,
  SceneRoomChoice,
} from '@haus/ui/components';

const isRec = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export interface DesktopEditorCatalog {
  readonly devices: readonly SceneControllableDevice[];
  readonly scenes: readonly AutomationSceneChoice[];
  readonly roomOptions: readonly SceneRoomChoice[];
  readonly entityOptions: readonly AutomationEntityChoice[];
  readonly buttonControllers: readonly AutomationButtonControllerChoice[];
  readonly targetPlatform: 'hub' | 'ha';
  readonly resolveDeviceEventEntity: ParseAutomationFlowOptions['resolveDeviceEventEntity'];
  readonly serviceOptions: readonly { readonly value: string; readonly label: string }[];
  readonly templateContext: AutomationTemplateContext;
  readonly resolveEntityName: (entityId: string) => string;
}

const HUE_DIMMER_LABELS: Readonly<Record<string, string>> = {
  '1': 'Button 1 · On',
  '2': 'Button 2 · Up',
  '3': 'Button 3 · Down',
  '4': 'Button 4 · Off',
};

/** Builds unified device cards, scenes, switch controllers, and template bindings from a home Snapshot. */
export function buildDesktopEditorCatalog(snapshot: Snapshot): DesktopEditorCatalog {
  const model = normalizeHome(snapshot);
  const rooms = new Map(model.rooms.map((room) => [room.id, room.name]));
  const registry = new Map(snapshot.entities.map((entry) => [entry.entity_id, entry]));
  const devicesById = new Map(snapshot.devices.map((device) => [device.id, device]));
  const owners = new Map(
    model.accessories.flatMap((acc) => acc.entityIds.map((id) => [id, acc] as const)),
  );
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const targetPlatform: 'hub' | 'ha' = snapshot.config?.version === 'haus-hub' ? 'hub' : 'ha';

  const nameById = new Map<string, string>();
  const devices: SceneControllableDevice[] = [];
  const controllerBuckets = new Map<
    string,
    {
      readonly controllerId: string;
      readonly deviceId?: string;
      readonly domain?: string;
      readonly name: string;
      readonly roomName: string;
      readonly model?: string;
      readonly isHue: boolean;
      readonly rawEntities: HassEntity[];
    }
  >();

  for (const entity of snapshot.states) {
    const id = entity.entity_id;
    const acc = owners.get(id);
    const reg = registry.get(id);
    const devEntry = (reg?.device_id ? devicesById.get(reg.device_id) : undefined) ??
      (acc?.deviceId ? devicesById.get(acc.deviceId) : undefined);
    const areaId = acc?.areaId ?? reg?.area_id ?? devEntry?.area_id ?? undefined;
    const roomName = (areaId ? rooms.get(areaId) : undefined) ?? 'Other accessories';
    const rawFriendly =
      typeof entity.attributes.friendly_name === 'string' && entity.attributes.friendly_name.trim()
        ? entity.attributes.friendly_name
        : acc?.name ?? id;
    const cleanName = deviceDisplayName(rawFriendly, areaId ? rooms.get(areaId) : undefined);
    nameById.set(id, cleanName);

    if (id.startsWith('event.') && !reg?.disabled_by) {
      const controllerId = reg?.device_id ?? acc?.deviceId ?? id;
      const existing = controllerBuckets.get(controllerId);
      if (existing) {
        existing.rawEntities.push(entity);
      } else {
        const ctrlBaseName = deviceDisplayName(
          acc?.name ?? devEntry?.name ?? cleanName,
          areaId ? rooms.get(areaId) : undefined,
        );
        const brandProbe = `${devEntry?.manufacturer ?? ''} ${devEntry?.model ?? ''} ${reg?.platform ?? ''} ${id}`;
        const isHue = /philips|signify|hue/i.test(brandProbe);
        controllerBuckets.set(controllerId, {
          controllerId,
          deviceId: reg?.device_id ?? acc?.deviceId,
          domain: reg?.platform ?? (isHue ? 'hue' : undefined),
          name: ctrlBaseName,
          roomName: (areaId ? rooms.get(areaId) : undefined) ?? 'Switches',
          model: devEntry?.model ?? undefined,
          isHue,
          rawEntities: [entity],
        });
      }
    }

    if (/^(light|switch|climate|cover|media_player|fan|lock|input_boolean)\./.test(id)) {
      const domain = id.split('.')[0] ?? 'other';
      const category =
        acc?.category ??
        (domain === 'light'
          ? 'lights'
          : domain === 'climate' || domain === 'fan'
            ? 'climate'
            : domain === 'cover'
              ? 'covers'
              : domain === 'lock'
                ? 'security'
                : domain === 'media_player'
                  ? 'media'
                  : 'outlets');
      const deviceIcon: DeviceBrandIconInput = {
        name: cleanName,
        primaryEntityId: id,
        category,
        manufacturer: acc?.manufacturer ?? devEntry?.manufacturer,
        model: acc?.model ?? devEntry?.model,
        deviceType: acc?.deviceType,
        deviceClass:
          typeof entity.attributes.device_class === 'string'
            ? entity.attributes.device_class
            : undefined,
        powerStrip: Boolean(acc?.powerStrip),
      };
      const liveStateText = acc && acc.primaryEntityId === id
        ? describeAccessory(acc)
        : entity.state.replaceAll('_', ' ');

      devices.push({
        entityId: id,
        name: cleanName,
        roomId: areaId,
        roomName,
        category,
        deviceIcon,
        entity,
        liveStateText,
        pickerEligible: isScenePickerTarget(entity, reg, acc),
      });
    }
  }

  devices.sort(
    (a, b) => collator.compare(a.roomName, b.roomName) || collator.compare(a.name, b.name),
  );

  const buttonControllers: AutomationButtonControllerChoice[] = [...controllerBuckets.values()]
    .map((bucket) => {
      const sorted = [...bucket.rawEntities].sort((a, b) =>
        collator.compare(a.entity_id, b.entity_id),
      );
      const isFourButtonHue =
        bucket.isHue &&
        sorted.filter((e) => !/rotary|dial/i.test(e.entity_id)).length === 4;

      const buttons: AutomationButtonEndpointChoice[] = sorted.map((ent, idx) => {
        const isDial = /rotary|dial/i.test(ent.entity_id);
        const btnNumMatch = /(?:button[_\s-]*)(\d+)/i.exec(
          `${ent.entity_id} ${String(ent.attributes.friendly_name ?? '')}`,
        );
        const subtype = isDial
          ? 'clock_wise'
          : (btnNumMatch?.[1] ?? (sorted.length > 1 ? String(idx + 1) : undefined));
        const rawBtnName = deviceDisplayName(
          String(ent.attributes.friendly_name ?? `Button ${idx + 1}`),
          bucket.name,
          isDial ? 'Rotary Dial' : `Button ${idx + 1}`,
        );
        const label = isDial
          ? 'Rotary Dial'
          : isFourButtonHue && subtype && HUE_DIMMER_LABELS[subtype] && /^button\s*\d+$/i.test(rawBtnName)
            ? HUE_DIMMER_LABELS[subtype]!
            : rawBtnName;
        const rawEventTypes = Array.isArray(ent.attributes.event_types)
          ? ent.attributes.event_types.filter((t): t is string => typeof t === 'string' && t.length > 0)
          : [];
        const eventTypes =
          rawEventTypes.length > 0
            ? rawEventTypes
            : isDial
              ? ['rotate_right', 'rotate_left', 'start', 'repeat']
              : [...DEFAULT_HUE_BUTTON_EVENT_TYPES];

        const combinedBtnName =
          sorted.length > 1 &&
          !label.toLowerCase().includes(bucket.name.toLowerCase())
            ? `${bucket.name} · ${label}`
            : label;
        nameById.set(ent.entity_id, combinedBtnName);

        return {
          entityId: ent.entity_id,
          label,
          shortLabel: isDial ? 'Dial' : (subtype ?? String(idx + 1)),
          kind: isDial ? 'dial' : 'button',
          eventTypes,
          ...(subtype ? { subtype } : {}),
        };
      });

      return {
        controllerId: bucket.controllerId,
        deviceId: bucket.deviceId,
        domain: bucket.domain,
        name: bucket.name,
        roomName: bucket.roomName,
        model: bucket.model,
        isHue: bucket.isHue,
        buttons,
      };
    })
    .sort((a, b) => collator.compare(a.roomName, b.roomName) || collator.compare(a.name, b.name));

  const scenes: AutomationSceneChoice[] = snapshot.states
    .filter((s) => s.entity_id.startsWith('scene.'))
    .map((scene) => {
      const card = sceneCard(scene, snapshot, model);
      return {
        entityId: scene.entity_id,
        name: card.title,
        roomName: card.room,
        icon: card.icon,
        leadColor: card.colors[0],
      };
    })
    .sort((a, b) => collator.compare(a.roomName, b.roomName) || collator.compare(a.name, b.name));

  const roomOptions: SceneRoomChoice[] = [
    { value: '', label: 'Automatic / Whole home' },
    ...model.rooms.map((room) => ({ value: room.id, label: room.name })),
  ];

  const entityOptions: AutomationEntityChoice[] = snapshot.states
    .filter((s) => {
      const reg = registry.get(s.entity_id);
      return !reg?.disabled_by && !reg?.hidden_by && !s.entity_id.startsWith('automation.');
    })
    .map((s) => {
      const acc = owners.get(s.entity_id);
      const reg = registry.get(s.entity_id);
      const areaId = acc?.areaId ?? reg?.area_id ?? '';
      const room = rooms.get(areaId);
      const base = nameById.get(s.entity_id) ?? s.entity_id;
      return {
        value: s.entity_id,
        label: room ? `${room} · ${base}` : base,
        deviceClass:
          typeof s.attributes.device_class === 'string' ? s.attributes.device_class : undefined,
      };
    })
    .sort((a, b) => collator.compare(a.label, b.label));

  const serviceOptions = Object.entries(snapshot.services)
    .flatMap(([domain, services]) =>
      Object.entries(services).map(([name, info]) => {
        const infoRec = isRec(info) ? info : undefined;
        const labelText =
          typeof infoRec?.name === 'string' && infoRec.name.trim()
            ? infoRec.name
            : name.replaceAll('_', ' ');
        return {
          value: `${domain}.${name}`,
          label: `${domain.replaceAll('_', ' ')} · ${labelText}`,
        };
      }),
    )
    .sort((a, b) => collator.compare(a.label, b.label));

  const eligibleDevices = devices.filter((d) => d.pickerEligible);
  const templateContext: AutomationTemplateContext = {
    lightEntityIds: eligibleDevices
      .filter((d) => d.entityId.startsWith('light.'))
      .map((d) => d.entityId),
    coverEntityIds: eligibleDevices
      .filter((d) => d.entityId.startsWith('cover.'))
      .map((d) => d.entityId),
    lockEntityIds: eligibleDevices
      .filter((d) => d.entityId.startsWith('lock.'))
      .map((d) => d.entityId),
    motionEntityIds: snapshot.states
      .filter(
        (s) =>
          s.entity_id.startsWith('binary_sensor.') &&
          ['motion', 'occupancy', 'presence'].includes(String(s.attributes.device_class ?? '')),
      )
      .map((s) => s.entity_id),
    sceneEntityIds: scenes.map((s) => s.entityId),
    buttonEventEntityIds: buttonControllers.flatMap((ctrl) => ctrl.buttons.map((b) => b.entityId)),
    targetPlatform,
  };

  const resolveDeviceEventEntity: ParseAutomationFlowOptions['resolveDeviceEventEntity'] = ({
    deviceId,
    subtype,
  }) => {
    const ctrl = buttonControllers.find((c) => c.deviceId === deviceId);
    if (!ctrl) return undefined;
    if (subtype) {
      const normalizedSubtype = subtype.replace(/^button[_\s-]*/i, '');
      const matched = ctrl.buttons.find(
        (b) => b.subtype === subtype || b.subtype === normalizedSubtype,
      );
      if (matched) return matched.entityId;
    }
    return ctrl.buttons[0]?.entityId;
  };

  return {
    devices,
    scenes,
    roomOptions,
    entityOptions,
    buttonControllers,
    targetPlatform,
    resolveDeviceEventEntity,
    serviceOptions,
    templateContext,
    resolveEntityName: (entityId: string) => {
      if (entityId.startsWith('scene.')) {
        return scenes.find((s) => s.entityId === entityId)?.name ?? entityId.slice(6);
      }
      return nameById.get(entityId) ?? entityId;
    },
  };
}

export function toEditableEntitySeed(
  entity: HassEntity | undefined,
  snapshot: Snapshot,
): EditableEntitySeed | undefined {
  if (!entity) return undefined;
  const fallbackRaw =
    snapshot.sceneConfigs?.[entity.entity_id]?.entities ?? entity.attributes.entities;
  return {
    entityId: entity.entity_id,
    configId: typeof entity.attributes.id === 'string' ? entity.attributes.id : undefined,
    friendlyName:
      typeof entity.attributes.friendly_name === 'string'
        ? entity.attributes.friendly_name
        : entity.entity_id,
    icon: typeof entity.attributes.icon === 'string' ? entity.attributes.icon : undefined,
    fallbackSceneEntities: isRec(fallbackRaw) ? fallbackRaw : {},
  };
}

export function buildSceneTargetDetails(
  targets: readonly { readonly id: string; readonly setting: unknown }[],
  snapshot: Snapshot,
): PortableSceneTargetDetail[] {
  return targets.map(({ id, setting }) => {
    const current = snapshot.states.find((s) => s.entity_id === id);
    const { targetSummary, attributes } = formatSceneTargetSetting(setting);
    const swatchRgb = attributes
      ? parseRgbColorString(
          lightColor({ entity_id: id, state: 'on', attributes, last_changed: '' }),
        )
      : undefined;
    const friendlyName =
      typeof current?.attributes.friendly_name === 'string' ? current.attributes.friendly_name : id;

    return {
      id,
      name: friendlyName,
      targetSummary,
      currentState: current?.state ?? 'No live state',
      swatchRgb,
    };
  });
}

export function buildPortableAutomationItems({
  automations,
  configs,
  canManage,
  cutoverDisabled,
  cuttingOverId,
  isToggleDisabled,
}: {
  readonly automations: readonly HassEntity[];
  readonly configs: Readonly<Record<string, EditableConfig>>;
  readonly canManage: boolean;
  readonly cutoverDisabled: boolean;
  readonly cuttingOverId?: string;
  readonly isToggleDisabled?: (entity: HassEntity, waitingForCutover: boolean) => boolean;
}): PortableAutomationItem[] {
  return automations.map((entity) => {
    const migration = describeAutomationMigration(entity.attributes, entity.state);
    return {
      entityId: entity.entity_id,
      ruleId: migration.ruleId,
      name: migration.friendlyName,
      statusLabel: migration.statusLabel,
      enabled: entity.state === 'on',
      toggleDisabled: isToggleDisabled
        ? isToggleDisabled(entity, migration.waitingForSourceCutover)
        : migration.waitingForSourceCutover,
      canEdit: canManage,
      cutoverDisabled,
      needsCutover: migration.waitingForSourceCutover,
      cuttingOver: Boolean(migration.ruleId && cuttingOverId === migration.ruleId),
      config: configs[entity.entity_id],
    };
  });
}
