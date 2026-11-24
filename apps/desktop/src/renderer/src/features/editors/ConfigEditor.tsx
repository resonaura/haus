/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useState } from 'react';
import { Box, HausButton, HausForm, Pressable, SelectInput, Text, TextInput } from '@haus/ui';
import { Dialog } from '@haus/ui/components';
import { JsonField } from '../../components/forms/SchemaForm';
import {
  readConfig,
  saveConfig,
  configPath,
  type EditableKind,
  type EditableConfig,
} from '../../ha/config-editor';
import type { HassEntity, Snapshot } from '../../model';
import { AutomationBlocks } from './AutomationBlocks';
import { SceneTargets } from './SceneTargets';
import { SceneIdentity } from './SceneIdentity';
import { Play } from 'lucide-react';
const list = (value: any) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
export function ConfigEditor({
  kind,
  entity,
  snapshot,
  demo,
  onClose,
  onSaved,
}: {
  kind: EditableKind;
  entity?: HassEntity;
  snapshot: Snapshot;
  demo: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [id] = useState(() =>
    String(entity?.attributes.id ?? `haus_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`),
  );
  const [config, setConfig] = useState<EditableConfig>(
    kind === 'scene'
      ? { name: '', entities: {} }
      : {
          alias: '',
          description: '',
          triggers: [],
          conditions: [],
          actions: [],
          mode: 'single',
          initial_state: false,
        },
  );
  const [original, setOriginal] = useState<EditableConfig>();
  const [loading, setLoading] = useState(Boolean(entity));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [testMessage, setTestMessage] = useState('');
  useEffect(() => {
    if (!entity) return;
    let active = true;
    const api = window.hausNative;
    if (demo || !api) {
      setConfig(
        kind === 'scene'
          ? {
              name: entity.attributes.friendly_name,
              entities:
                snapshot.sceneConfigs?.[entity.entity_id]?.entities ??
                entity.attributes.entities ??
                {},
            }
          : {
              alias: entity.attributes.friendly_name,
              triggers: [],
              conditions: [],
              actions: [],
              mode: 'single',
              initial_state: false,
            },
      );
      setLoading(false);
      return;
    }
    void readConfig(api, kind, id)
      .then((value) => {
        if (active) {
          setConfig(value);
          setOriginal(value);
          if (value.use_blueprint) setAdvanced(true);
        }
      })
      .catch(() => {
        if (active)
          setError(
            'This integration does not store an editable configuration on Haus Hub. Create a new scene or automation; this original is left untouched.',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [kind, id, entity?.entity_id, demo]);
  const update = (value: EditableConfig) => {
    setConfig(value);
    setDirty(true);
  };
  const close = () => (dirty ? setDiscard(true) : onClose());
  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      if (demo)
        throw new Error(
          'Connect your home to save this configuration. This preview has not changed any devices.',
        );
      if (!demo) {
        if (!window.hausNative) throw new Error('Connect your home first.');
        if (entity && !original)
          throw new Error('This integration configuration cannot be overwritten.');
        await saveConfig(window.hausNative, kind, id, config, original);
      }
      onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={`${entity ? 'Edit' : 'New'} ${kind}`}
      onClose={close}
      className={`config-editor ${kind === 'scene' ? 'scene-config-editor' : ''}`}
    >
      <HausForm
        onSubmit={() => {
          void submit();
        }}
      >
        {loading ? (
          <Text semantic="p" role="status">
            Loading configuration…
          </Text>
        ) : (
          <>
            {kind === 'scene' ? (
              <SceneIdentity
                name={String(config.name ?? '')}
                icon={config.icon}
                onChange={(patch) => update({ ...config, ...patch })}
              />
            ) : (
              <Text semantic="label" className="management-field">
                <Text>Name</Text>
                <TextInput
                  required
                  value={String(config.alias ?? '')}
                  onChange={(alias) => update({ ...config, alias })}
                />
              </Text>
            )}
            {kind === 'automation' && !entity && (
              <Text semantic="p" className="editor-note">
                New automations are saved paused. Enable one when you are ready.
              </Text>
            )}
            <Box className="editor-mode">
              <Pressable
                type="button"
                disabled={Boolean(config.use_blueprint)}
                ariaPressed={!advanced}
                onPress={() => setAdvanced(false)}
              >
                {kind === 'scene' ? 'Accessories' : 'Visual editor'}
              </Pressable>
              <Pressable type="button" ariaPressed={advanced} onPress={() => setAdvanced(true)}>
                {kind === 'scene' ? 'Advanced' : 'Configuration'}
              </Pressable>
            </Box>
            {advanced ? (
              <JsonField
                key="config"
                label="Complete configuration"
                value={config}
                onChange={(value) => update(value as EditableConfig)}
              />
            ) : kind === 'scene' ? (
              <SceneTargets
                entities={config.entities ?? {}}
                snapshot={snapshot}
                onChange={(entities) => update({ ...config, entities })}
              />
            ) : (
              <>
                <Text semantic="label" className="management-field">
                  <Text>Description</Text>
                  <TextInput
                    value={config.description ?? ''}
                    onChange={(description) => update({ ...config, description })}
                  />
                </Text>
                {(['triggers', 'conditions', 'actions'] as const).map((key, index) => {
                  const legacy = ['trigger', 'condition', 'action'][index];
                  const source = key in config ? key : legacy in config ? legacy : key;
                  return (
                    <AutomationBlocks
                      key={key}
                      kind={key}
                      blocks={list(config[source])}
                      onChange={(blocks) => update({ ...config, [source]: blocks })}
                      snapshot={snapshot}
                    />
                  );
                })}
                <Text semantic="label" className="management-field">
                  <Text>When already running</Text>
                  <SelectInput
                    value={config.mode ?? 'single'}
                    options={['single', 'restart', 'queued', 'parallel'].map((mode) => ({
                      value: mode,
                      label: mode,
                    }))}
                    onChange={(mode) => update({ ...config, mode })}
                  />
                </Text>
              </>
            )}
            {kind === 'scene' && (
              <Box className="scene-test-row">
                <HausButton
                  variant="secondary"
                  isDisabled={demo || busy || !Object.keys(config.entities ?? {}).length}
                  onPress={() => {
                    setBusy(true);
                    setError('');
                    setTestMessage('');
                    void window.hausNative
                      ?.request({
                        type: 'call_service',
                        domain: 'scene',
                        service: 'apply',
                        service_data: { entities: config.entities },
                      })
                      .then(() =>
                        setTestMessage('Applied to your accessories. Save to keep this scene.'),
                      )
                      .catch((reason) => setError(reason.message))
                      .finally(() => setBusy(false));
                  }}
                >
                  <Play size={14} /> Test this scene
                </HausButton>
                <Text semantic="p">
                  {testMessage || 'Editing changes the draft. Testing applies these settings now.'}
                </Text>
              </Box>
            )}
            {error && (
              <Text semantic="p" role="alert" className="form-error">
                {error}
              </Text>
            )}
            <Box className="editor-footer">
              {entity && original && (
                <HausButton variant="danger" isDisabled={busy} onPress={() => setDeleting(true)}>
                  Delete
                </HausButton>
              )}
              <HausButton variant="ghost" onPress={close}>
                Cancel
              </HausButton>
              <HausButton
                type="submit"
                isPending={busy}
                isDisabled={busy || Boolean(entity && !original && !demo)}
              >
                {demo ? 'Connect to save' : 'Save'}
              </HausButton>
            </Box>
          </>
        )}
      </HausForm>
      {discard && (
        <Box className="editor-confirm" role="alert">
          <Text semantic="p">Discard unsaved changes?</Text>
          <HausButton variant="danger" onPress={onClose}>
            Discard
          </HausButton>
          <HausButton variant="ghost" onPress={() => setDiscard(false)}>
            Keep editing
          </HausButton>
        </Box>
      )}
      {deleting && (
        <Box className="editor-confirm" role="alert">
          <Text semantic="p">Delete “{String(config.name ?? config.alias)}” from Haus Hub?</Text>
          <HausButton
            variant="danger"
            isDisabled={busy}
            onPress={() => {
              setBusy(true);
              void window.hausNative
                ?.management({ method: 'DELETE', path: configPath(kind, id) })
                .then(() => {
                  onSaved();
                  onClose();
                })
                .catch((reason) => {
                  setError(reason.message);
                  setDeleting(false);
                })
                .finally(() => setBusy(false));
            }}
          >
            Delete permanently
          </HausButton>
          <HausButton variant="ghost" onPress={() => setDeleting(false)}>
            Keep
          </HausButton>
        </Box>
      )}
    </Dialog>
  );
}
