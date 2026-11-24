/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useMemo, useState } from 'react';
import {
  deleteEditableConfig,
  readEditableConfig,
  saveEditableConfig,
  type EditableConfig,
  type EditableKind,
  type ManagementPort,
} from '@haus/core/transport';
import type { HassEntity, Snapshot } from '@haus/ha/types';
import { deviceDisplayName } from '@haus/ha/view/device-name';
import { normalizeHome } from '@haus/ha/view/normalize';
import {
  PortableConfigEditorModal,
  type PortableAutomationBlock,
  type PortableOptionItem,
  type PortableSceneAccessoryOption,
} from '@haus/ui/components';

const isRec = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asList = (value: unknown): Record<string, unknown>[] =>
  value === undefined ? [] : (Array.isArray(value) ? value : [value]).filter(isRec);

function extractSceneTargets(
  rawEntities: unknown,
): Record<string, { readonly on: boolean; readonly brightness?: number }> {
  if (!isRec(rawEntities)) return {};
  const result: Record<string, { readonly on: boolean; readonly brightness?: number }> = {};
  for (const [id, value] of Object.entries(rawEntities)) {
    const rec = isRec(value) ? value : undefined;
    const state = typeof value === 'string' ? value : typeof rec?.state === 'string' ? rec.state : 'on';
    const attrs = isRec(rec?.attributes) ? rec.attributes : rec;
    const rawBrightness = typeof attrs?.brightness === 'number' ? attrs.brightness : undefined;
    const brightness =
      rawBrightness !== undefined
        ? Math.max(1, Math.min(100, Math.round((rawBrightness / 255) * 100)))
        : undefined;
    result[id] = { on: state !== 'off' && state !== 'closed', ...(brightness !== undefined ? { brightness } : {}) };
  }
  return result;
}

function toBlocks(raw: unknown, kind: 'triggers' | 'conditions' | 'actions'): PortableAutomationBlock[] {
  return asList(raw).map((item, idx) => {
    const rawTarget = isRec(item.target) ? item.target.entity_id : undefined;
    return {
      id: `${kind}-${idx}`,
      type: String(item.trigger ?? item.platform ?? item.condition ?? 'state'),
      entityId: String(typeof rawTarget === 'string' ? rawTarget : (item.entity_id ?? '')),
      stateOrTo: String(kind === 'triggers' ? (item.to ?? 'on') : (item.state ?? 'on')),
      at: String(item.at ?? '08:00:00'),
      sunEvent: String(item.event ?? 'sunset'),
      service: String(item.action ?? item.service ?? 'light.turn_on'),
    };
  });
}

function serializeBlocks(
  kind: 'triggers' | 'conditions' | 'actions',
  blocks: readonly PortableAutomationBlock[],
): Record<string, unknown>[] {
  return blocks.map((b) => {
    if (kind === 'actions') {
      return { action: b.service, target: { entity_id: b.entityId } };
    }
    if (kind === 'triggers') {
      if (b.type === 'time') return { trigger: 'time', at: b.at };
      if (b.type === 'sun') return { trigger: 'sun', event: b.sunEvent };
      return { trigger: b.type, entity_id: b.entityId, to: b.stateOrTo };
    }
    return { condition: b.type, entity_id: b.entityId, state: b.stateOrTo };
  });
}

export function GpuiConfigEditor({
  kind,
  entity,
  snapshot,
  demo,
  management,
  onApplySceneEntities,
  onClose,
  onSaved,
}: {
  readonly kind: EditableKind;
  readonly entity?: HassEntity;
  readonly snapshot: Snapshot;
  readonly demo?: boolean;
  readonly management?: ManagementPort;
  readonly onApplySceneEntities?: (entities: Record<string, unknown>) => Promise<void>;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const [id] = useState(() =>
    String(entity?.attributes.id ?? `haus_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`),
  );
  const [config, setConfig] = useState<EditableConfig>(() =>
    kind === 'scene'
      ? { name: '', entities: {} }
      : { alias: '', description: '', triggers: [], conditions: [], actions: [], mode: 'single', initial_state: false },
  );
  const [original, setOriginal] = useState<EditableConfig>();
  const [loading, setLoading] = useState(Boolean(entity));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sceneSearch, setSceneSearch] = useState('');
  const [testMessage, setTestMessage] = useState('');

  useEffect(() => {
    if (!entity) return;
    let active = true;
    const friendly = typeof entity.attributes.friendly_name === 'string' ? entity.attributes.friendly_name : '';
    if (demo || !management) {
      const initial: EditableConfig =
        kind === 'scene'
          ? {
              name: friendly,
              ...(typeof entity.attributes.icon === 'string' ? { icon: entity.attributes.icon } : {}),
              entities:
                snapshot.sceneConfigs?.[entity.entity_id]?.entities ?? entity.attributes.entities ?? {},
            }
          : { alias: friendly, triggers: [], conditions: [], actions: [], mode: 'single', initial_state: false };
      setConfig(initial);
      setJsonText(JSON.stringify(initial, null, 2));
      setLoading(false);
      return;
    }
    void readEditableConfig(management, kind, id)
      .then((loaded) => {
        if (!active) return;
        setConfig(loaded);
        setOriginal(loaded);
        setJsonText(JSON.stringify(loaded, null, 2));
        if (loaded.use_blueprint) setAdvanced(true);
      })
      .catch(() => {
        if (active) {
          setError(
            'This integration does not store an editable configuration on Haus Hub. Create a new scene or automation; this original is left untouched.',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [demo, entity, id, kind, management, snapshot.sceneConfigs]);

  const model = useMemo(() => normalizeHome(snapshot), [snapshot]);
  const sceneAccessories = useMemo<PortableSceneAccessoryOption[]>(() => {
    const rooms = new Map(model.rooms.map((r) => [r.id, r.name]));
    return model.accessories
      .filter((acc) => !acc.isService && /^(light|switch|climate|cover|media_player|fan|lock|input_boolean)\./.test(acc.primaryEntityId))
      .map((acc) => {
        const entityState = snapshot.states.find((s) => s.entity_id === acc.primaryEntityId);
        const domain = acc.primaryEntityId.split('.')[0];
        return {
          entityId: acc.primaryEntityId,
          name: deviceDisplayName(acc.name, rooms.get(acc.areaId ?? '')),
          roomName: rooms.get(acc.areaId ?? '') ?? 'Other accessories',
          hasBrightness: domain === 'light' && typeof entityState?.attributes.brightness === 'number',
        };
      });
  }, [model, snapshot.states]);

  const entityOptions = useMemo<PortableOptionItem[]>(() => {
    const rooms = new Map(model.rooms.map((r) => [r.id, r.name]));
    return snapshot.states.slice(0, 60).map((item) => ({
      value: item.entity_id,
      label: deviceDisplayName(
        typeof item.attributes.friendly_name === 'string' ? item.attributes.friendly_name : item.entity_id,
        rooms.get(snapshot.entities.find((e) => e.entity_id === item.entity_id)?.area_id ?? ''),
      ),
    }));
  }, [model.rooms, snapshot.entities, snapshot.states]);

  const serviceOptions = useMemo<PortableOptionItem[]>(
    () =>
      Object.entries(snapshot.services).flatMap(([domain, services]) =>
        Object.keys(services).map((name) => ({
          value: `${domain}.${name}`,
          label: `${domain.replaceAll('_', ' ')} · ${name.replaceAll('_', ' ')}`,
        })),
      ),
    [snapshot.services],
  );

  const updateConfig = (next: EditableConfig) => {
    setConfig(next);
    setJsonText(JSON.stringify(next, null, 2));
    setDirty(true);
  };

  const sceneEntities = useMemo(() => (isRec(config.entities) ? { ...config.entities } : {}), [config.entities]);
  const sceneTargets = useMemo(() => extractSceneTargets(sceneEntities), [sceneEntities]);

  const toggleSceneAccessory = (entityId: string) => {
    const next = { ...sceneEntities };
    if (entityId in next) {
      delete next[entityId];
    } else {
      const current = snapshot.states.find((s) => s.entity_id === entityId);
      const attrs = current?.attributes ?? {};
      const captured: Record<string, unknown> = { state: current?.state ?? 'on' };
      if (typeof attrs.brightness === 'number') captured.brightness = attrs.brightness;
      next[entityId] = captured;
    }
    updateConfig({ ...config, entities: next });
  };

  const toggleTargetState = (entityId: string, on: boolean) => {
    const prev = isRec(sceneEntities[entityId]) ? { ...sceneEntities[entityId] } : {};
    updateConfig({ ...config, entities: { ...sceneEntities, [entityId]: { ...prev, state: on ? 'on' : 'off' } } });
  };

  const changeTargetBrightness = (entityId: string, pctValue: number) => {
    const prev = isRec(sceneEntities[entityId]) ? { ...sceneEntities[entityId] } : {};
    const brightness = Math.max(1, Math.min(255, Math.round((pctValue / 100) * 255)));
    updateConfig({ ...config, entities: { ...sceneEntities, [entityId]: { ...prev, state: 'on', brightness } } });
  };

  const triggerSourceKey = 'triggers' in config ? 'triggers' : 'trigger' in config ? 'trigger' : 'triggers';
  const conditionSourceKey =
    'conditions' in config ? 'conditions' : 'condition' in config ? 'condition' : 'conditions';
  const actionSourceKey = 'actions' in config ? 'actions' : 'action' in config ? 'action' : 'actions';

  const triggers = toBlocks(config[triggerSourceKey], 'triggers');
  const conditions = toBlocks(config[conditionSourceKey], 'conditions');
  const actions = toBlocks(config[actionSourceKey], 'actions');

  const sourceKey = (blockKind: 'triggers' | 'conditions' | 'actions') =>
    blockKind === 'triggers' ? triggerSourceKey : blockKind === 'conditions' ? conditionSourceKey : actionSourceKey;

  const listFor = (blockKind: 'triggers' | 'conditions' | 'actions') =>
    blockKind === 'triggers' ? triggers : blockKind === 'conditions' ? conditions : actions;

  const save = async () => {
    setError('');
    if (advanced && jsonError) {
      setError(jsonError);
      return;
    }
    if (demo || !management) {
      setError('Connect your home to save this configuration. This preview has not changed any devices.');
      return;
    }
    if (entity && !original) {
      setError('This integration configuration cannot be overwritten.');
      return;
    }
    setBusy(true);
    try {
      await saveEditableConfig(management, kind, id, config, original);
      onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PortableConfigEditorModal
      kind={kind}
      editing={Boolean(entity)}
      demo={Boolean(demo)}
      loading={loading}
      busy={busy}
      canDelete={Boolean(entity && original && !demo && management)}
      advanced={advanced}
      error={error}
      jsonText={jsonText}
      jsonError={jsonError}
      testMessage={testMessage}
      confirmDiscard={confirmDiscard}
      confirmDelete={confirmDelete}
      nameValue={String((kind === 'scene' ? config.name : config.alias) ?? '')}
      descriptionValue={String(config.description ?? '')}
      modeValue={String(config.mode ?? 'single')}
      sceneIcon={typeof config.icon === 'string' ? config.icon : undefined}
      sceneSearch={sceneSearch}
      sceneAccessories={sceneAccessories}
      sceneTargets={sceneTargets}
      triggers={triggers}
      conditions={conditions}
      actions={actions}
      entityOptions={entityOptions}
      serviceOptions={serviceOptions}
      onSetAdvanced={(nextAdv) => {
        if (nextAdv) setJsonText(JSON.stringify(config, null, 2));
        setAdvanced(nextAdv);
      }}
      onNameChange={(val) => updateConfig({ ...config, [kind === 'scene' ? 'name' : 'alias']: val })}
      onDescriptionChange={(val) => updateConfig({ ...config, description: val })}
      onModeChange={(val) => updateConfig({ ...config, mode: val })}
      onJsonChange={(raw) => {
        setJsonText(raw);
        try {
          const parsed: unknown = JSON.parse(raw);
          if (!isRec(parsed)) throw new Error('Configuration must be a JSON object.');
          setJsonError('');
          setConfig(parsed);
          setDirty(true);
        } catch (err) {
          setJsonError(err instanceof Error ? err.message : 'Invalid JSON');
        }
      }}
      onSceneIconChange={(icon) => updateConfig({ ...config, icon })}
      onSceneSearchChange={setSceneSearch}
      onToggleAccessory={toggleSceneAccessory}
      onToggleTargetState={toggleTargetState}
      onChangeBrightness={changeTargetBrightness}
      onAddBlock={(blockKind) => {
        const defaultBlock: PortableAutomationBlock =
          blockKind === 'triggers'
            ? { id: `new-${Date.now()}`, type: 'state', entityId: entityOptions[0]?.value ?? '', stateOrTo: 'on', at: '08:00:00', sunEvent: 'sunset', service: '' }
            : blockKind === 'conditions'
              ? { id: `new-${Date.now()}`, type: 'state', entityId: entityOptions[0]?.value ?? '', stateOrTo: 'on', at: '', sunEvent: 'sunset', service: '' }
              : { id: `new-${Date.now()}`, type: 'action', entityId: entityOptions[0]?.value ?? '', stateOrTo: '', at: '', sunEvent: '', service: serviceOptions[0]?.value ?? 'light.turn_on' };
        const nextBlocks = [...listFor(blockKind), defaultBlock];
        updateConfig({ ...config, [sourceKey(blockKind)]: serializeBlocks(blockKind, nextBlocks) });
      }}
      onRemoveBlock={(blockKind, index) => {
        const nextBlocks = listFor(blockKind).filter((_, i) => i !== index);
        updateConfig({ ...config, [sourceKey(blockKind)]: serializeBlocks(blockKind, nextBlocks) });
      }}
      onUpdateBlock={(blockKind, index, nextBlock) => {
        const nextBlocks = listFor(blockKind).map((b, i) => (i === index ? nextBlock : b));
        updateConfig({ ...config, [sourceKey(blockKind)]: serializeBlocks(blockKind, nextBlocks) });
      }}
      onTestScene={() => {
        if (!onApplySceneEntities) return;
        setBusy(true);
        setError('');
        setTestMessage('');
        void onApplySceneEntities(sceneEntities)
          .then(() => setTestMessage('Applied to your accessories. Save to keep this scene.'))
          .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
          .finally(() => setBusy(false));
      }}
      onRequestClose={() => (dirty ? setConfirmDiscard(true) : onClose())}
      onConfirmDiscard={onClose}
      onCancelDiscard={() => setConfirmDiscard(false)}
      onRequestDelete={() => setConfirmDelete(true)}
      onConfirmDelete={() => {
        if (!management) return;
        setBusy(true);
        void deleteEditableConfig(management, kind, id)
          .then(() => {
            onSaved();
            onClose();
          })
          .catch((reason: unknown) => {
            setError(reason instanceof Error ? reason.message : String(reason));
            setConfirmDelete(false);
          })
          .finally(() => setBusy(false));
      }}
      onCancelDelete={() => setConfirmDelete(false)}
      onSave={() => void save()}
    />
  );
}
