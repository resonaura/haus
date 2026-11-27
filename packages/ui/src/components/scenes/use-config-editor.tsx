/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useState } from 'react';
import {
  deleteEditableConfig,
  instantiateAutomationTemplate,
  readEditableConfig,
  saveEditableConfig,
  type AutomationTemplateContext,
  type EditableConfig,
  type EditableKind,
  type ManagementPort,
  type ParseAutomationFlowOptions,
} from '@haus/core/transport';
import {
  AutomationEditorModal,
  AutomationEditorScreen,
  type AutomationButtonControllerChoice,
  type AutomationEntityChoice,
  type AutomationSceneChoice,
} from '../automations/index.js';
import { SceneEditorModal, type SceneRoomChoice } from './editor-modal.js';
import type { SceneControllableDevice } from './target-grid.js';

const isRec = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export interface EditableEntitySeed {
  readonly entityId: string;
  readonly configId?: string;
  readonly friendlyName: string;
  readonly icon?: string;
  readonly fallbackSceneEntities?: Record<string, unknown>;
}

export interface UnifiedConfigEditorProps {
  readonly kind: EditableKind;
  readonly asScreen?: boolean;
  readonly columns?: number;
  readonly entity?: EditableEntitySeed;
  readonly initialTemplateId?: string;
  readonly templateContext?: AutomationTemplateContext;
  readonly demo: boolean;
  readonly management?: ManagementPort;
  readonly devices: readonly SceneControllableDevice[];
  readonly scenes?: readonly AutomationSceneChoice[];
  readonly roomOptions?: readonly SceneRoomChoice[];
  readonly entityOptions: readonly AutomationEntityChoice[];
  readonly buttonControllers?: readonly AutomationButtonControllerChoice[];
  readonly targetPlatform?: 'hub' | 'ha';
  readonly resolveDeviceEventEntity?: ParseAutomationFlowOptions['resolveDeviceEventEntity'];
  readonly serviceOptions: readonly { readonly value: string; readonly label: string }[];
  readonly onTestSceneEntities?: (entities: Record<string, unknown>) => Promise<void>;
  readonly onTestAutomationActions?: (actions: readonly Record<string, unknown>[]) => Promise<void>;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

export function UnifiedConfigEditorModal({
  kind,
  asScreen = false,
  columns = 3,
  entity,
  initialTemplateId,
  templateContext,
  demo,
  management,
  devices,
  scenes = [],
  roomOptions,
  entityOptions,
  buttonControllers = [],
  targetPlatform = 'hub',
  resolveDeviceEventEntity,
  serviceOptions,
  onTestSceneEntities,
  onTestAutomationActions,
  onClose,
  onSaved,
}: UnifiedConfigEditorProps) {
  const [id] = useState(() =>
    String(entity?.configId || `haus_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`),
  );
  const [config, setConfig] = useState<EditableConfig>(() => {
    if (kind === 'scene') {
      return { name: '', entities: {} };
    }
    if (initialTemplateId) {
      return instantiateAutomationTemplate(initialTemplateId, templateContext);
    }
    return {
      alias: '',
      description: '',
      triggers: [{ trigger: 'sun', event: 'sunset' }],
      conditions: [],
      actions: [],
      mode: 'single',
      initial_state: false,
    };
  });
  const [original, setOriginal] = useState<EditableConfig>();
  const [loading, setLoading] = useState(Boolean(entity));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(config, null, 2));
  const [jsonError, setJsonError] = useState('');
  const [dirty, setDirty] = useState(Boolean(initialTemplateId));
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [testMessage, setTestMessage] = useState('');

  useEffect(() => {
    if (!entity) return;
    let active = true;
    if (demo || !management) {
      const fallback: EditableConfig =
        kind === 'scene'
          ? {
              name: entity.friendlyName,
              ...(entity.icon ? { icon: entity.icon } : {}),
              entities: entity.fallbackSceneEntities ?? {},
            }
          : {
              alias: entity.friendlyName,
              description: '',
              triggers: [{ trigger: 'sun', event: 'sunset' }],
              conditions: [],
              actions: [],
              mode: 'single',
              initial_state: false,
            };
      setConfig(fallback);
      setJsonText(JSON.stringify(fallback, null, 2));
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
  }, [demo, entity, id, kind, management]);

  const updateConfig = (next: EditableConfig) => {
    setConfig(next);
    setJsonText(JSON.stringify(next, null, 2));
    setJsonError('');
    setDirty(true);
  };

  const handleJsonChange = (raw: string) => {
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
  };

  const handleSave = async () => {
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

  const handleDelete = () => {
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
  };

  const canDelete = Boolean(entity && original && !demo && management);

  if (kind === 'scene') {
    const sceneEntities = isRec(config.entities) ? config.entities : {};
    return (
      <SceneEditorModal
        editing={Boolean(entity)}
        demo={demo}
        loading={loading}
        busy={busy}
        canDelete={canDelete}
        advanced={advanced}
        error={error || undefined}
        jsonText={jsonText}
        jsonError={jsonError || undefined}
        testMessage={testMessage || undefined}
        confirmDiscard={confirmDiscard}
        confirmDelete={confirmDelete}
        nameValue={String(config.name ?? '')}
        sceneIcon={typeof config.icon === 'string' ? config.icon : undefined}
        roomId={typeof config.room_id === 'string' ? config.room_id : ''}
        roomOptions={roomOptions}
        entities={sceneEntities}
        devices={devices}
        onSetAdvanced={(nextAdv) => {
          if (nextAdv) setJsonText(JSON.stringify(config, null, 2));
          setAdvanced(nextAdv);
        }}
        onNameChange={(name) => updateConfig({ ...config, name })}
        onSceneIconChange={(icon) => updateConfig({ ...config, icon })}
        onRoomChange={
          roomOptions
            ? (roomId) => {
                const next = { ...config };
                if (roomId) next.room_id = roomId;
                else delete next.room_id;
                updateConfig(next);
              }
            : undefined
        }
        onEntitiesChange={(entities) => updateConfig({ ...config, entities })}
        onJsonChange={handleJsonChange}
        onTestScene={() => {
          if (!onTestSceneEntities) return;
          setBusy(true);
          setError('');
          setTestMessage('');
          void onTestSceneEntities(sceneEntities)
            .then(() => setTestMessage('Applied to your accessories. Save to keep this scene.'))
            .catch((reason: unknown) =>
              setError(reason instanceof Error ? reason.message : String(reason)),
            )
            .finally(() => setBusy(false));
        }}
        onRequestClose={() => (dirty ? setConfirmDiscard(true) : onClose())}
        onConfirmDiscard={onClose}
        onCancelDiscard={() => setConfirmDiscard(false)}
        onRequestDelete={() => setConfirmDelete(true)}
        onConfirmDelete={handleDelete}
        onCancelDelete={() => setConfirmDelete(false)}
        onSave={() => void handleSave()}
      />
    );
  }

  const rawActions = Array.isArray(config.actions)
    ? config.actions.filter(isRec)
    : Array.isArray(config.action)
      ? config.action.filter(isRec)
      : [];

  const automationProps = {
    editing: Boolean(entity),
    demo,
    loading,
    busy,
    canDelete,
    advanced,
    columns,
    error: error || undefined,
    jsonText,
    jsonError: jsonError || undefined,
    testMessage: testMessage || undefined,
    confirmDiscard,
    confirmDelete,
    config,
    devices,
    scenes,
    entityOptions,
    buttonControllers,
    targetPlatform,
    resolveDeviceEventEntity,
    serviceOptions,
    onSetAdvanced: (nextAdv: boolean) => {
      if (nextAdv) setJsonText(JSON.stringify(config, null, 2));
      setAdvanced(nextAdv);
    },
    onConfigChange: updateConfig,
    onApplyTemplate: (tplId: string) =>
      updateConfig(instantiateAutomationTemplate(tplId, templateContext)),
    onJsonChange: handleJsonChange,
    onTestActions: onTestAutomationActions
      ? () => {
          setBusy(true);
          setError('');
          setTestMessage('');
          void onTestAutomationActions(rawActions)
            .then(() => setTestMessage('Ran actions on your home.'))
            .catch((reason: unknown) =>
              setError(reason instanceof Error ? reason.message : String(reason)),
            )
            .finally(() => setBusy(false));
        }
      : undefined,
    onRequestClose: () => (dirty ? setConfirmDiscard(true) : onClose()),
    onConfirmDiscard: onClose,
    onCancelDiscard: () => setConfirmDiscard(false),
    onRequestDelete: () => setConfirmDelete(true),
    onConfirmDelete: handleDelete,
    onCancelDelete: () => setConfirmDelete(false),
    onSave: () => void handleSave(),
  };

  return asScreen ? (
    <AutomationEditorScreen {...automationProps} />
  ) : (
    <AutomationEditorModal {...automationProps} />
  );
}
