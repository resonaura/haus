/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import {
  filterCameraRelatedControls,
  friendlyEntityLabel,
  toggleAppVisibilityPatch,
  toggleHomeVisibilityPatch,
  type CameraDeviceConfig,
} from '@haus/core/transport';
import type { HassEntity, Snapshot } from '@haus/ha/types';
import type { Preferences } from '@haus/ha/view/preferences';
import type { HausAccessory } from '@haus/ha/view/types';
import {
  CameraSettingsPanel,
  type SecondaryEntityControlItem,
} from '@haus/ui/components';
import { availableAction } from '../home/model.js';
import type { DeviceControl } from '../home/cards.js';
import type { GpuiCameraApi } from './transport.js';

export function CameraSettingsTabContent({
  cameraId,
  title,
  cameraEntity,
  cameraAccessory,
  roomName,
  snapshot,
  preferences,
  allAccessories,
  relatedEntities,
  demo,
  settings,
  onSettingsChange,
  cameraApi,
  onControl,
  onPreferencesPatch,
}: {
  readonly cameraId: string;
  readonly title: string;
  readonly cameraEntity: HassEntity;
  readonly cameraAccessory?: HausAccessory;
  readonly roomName?: string;
  readonly snapshot: Snapshot;
  readonly preferences: Preferences;
  readonly allAccessories: readonly HausAccessory[];
  readonly relatedEntities: readonly HassEntity[];
  readonly demo?: boolean;
  readonly settings?: CameraDeviceConfig;
  readonly onSettingsChange: (
    next: CameraDeviceConfig | ((prev: CameraDeviceConfig | undefined) => CameraDeviceConfig | undefined),
  ) => void;
  readonly cameraApi?: GpuiCameraApi;
  readonly onControl: DeviceControl;
  readonly onPreferencesPatch?: (patch: Partial<Preferences>) => void;
}) {
  const [pairingCode, setPairingCode] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const operatingIds = new Set(
    Object.values(settings?.operating ?? {})
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .map((entry) => entry.id),
  );
  const filteredControls = filterCameraRelatedControls(cameraId, relatedEntities, operatingIds);
  const secondaryItems: SecondaryEntityControlItem[] = filteredControls.map((entity) => {
    const eid = entity.entity_id;
    const domain = eid.split('.')[0] ?? '';
    const options = Array.isArray(entity.attributes.options)
      ? entity.attributes.options.filter((opt): opt is string => typeof opt === 'string')
      : undefined;
    const kindValue: SecondaryEntityControlItem['kind'] =
      (domain === 'switch' || domain === 'input_boolean') && availableAction(snapshot, eid, 'toggle')
        ? 'switch'
        : (domain === 'button' || domain === 'input_button') &&
            availableAction(snapshot, eid, 'press')
          ? 'button'
          : domain === 'select' &&
              options &&
              options.length > 0 &&
              availableAction(snapshot, eid, 'select', options[0])
            ? 'select'
            : 'readonly';
    return {
      id: eid,
      label: friendlyEntityLabel(entity, title),
      kind: kindValue,
      valueText: entity.state,
      checked: entity.state === 'on',
      options,
    };
  });

  const refreshSettings = async () => {
    if (!cameraApi) return;
    const updated = await cameraApi.loadSettings(cameraId);
    if (updated) onSettingsChange(updated);
  };

  const runTask = (task: () => Promise<void>, fallbackMessage: string) => {
    setBusy(true);
    setError('');
    void task()
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : fallbackMessage),
      )
      .finally(() => setBusy(false));
  };

  const indicatorId = settings?.operating?.indicator?.id;
  const nightVisionId = settings?.operating?.nightVision?.id;
  const homekitConfig = settings?.homekit;

  return (
    <CameraSettingsPanel
      settingsLoaded={Boolean(settings)}
      recordingEnabled={settings?.enabled === true}
      activityAssistEnabled={settings?.motionDetection?.enabled === true}
      activityAssistMode={settings?.motionDetection?.mode ?? 'objects'}
      activityAssistSupported={Boolean(settings?.motionDetection)}
      indicatorLight={settings?.operating?.indicator}
      nightVision={settings?.operating?.nightVision}
      homekitEnabled={homekitConfig?.enabled === true}
      homekitStatusText={homekitConfig?.state}
      homekitPaired={homekitConfig?.paired ?? homekitConfig?.state === 'paired'}
      pairingCode={pairingCode}
      pending={busy}
      error={error}
      hiddenHome={preferences.hiddenHome.includes(cameraId)}
      hiddenApp={preferences.hiddenApp.includes(cameraId)}
      relatedControls={secondaryItems}
      metadata={[
        { label: 'Haus ID', value: cameraAccessory?.hausId ?? '—', mono: true },
        { label: 'Entity', value: cameraId, mono: true },
        { label: 'Room', value: roomName ?? 'Unassigned' },
        { label: 'State', value: cameraEntity.state },
      ]}
      onSetRecordingEnabled={(enabled) => {
        if (demo) {
          onSettingsChange((prev) => (prev ? { ...prev, enabled } : prev));
          return;
        }
        if (!cameraApi) return;
        runTask(
          () => cameraApi.patchSettings(cameraId, { enabled }).then(refreshSettings),
          'Failed to save recording policy.',
        );
      }}
      onSetActivityAssist={(enabled, mode) => {
        if (demo) {
          onSettingsChange((prev) =>
            prev ? { ...prev, motionDetection: { enabled, mode } } : prev,
          );
          return;
        }
        if (!cameraApi) return;
        runTask(
          () =>
            cameraApi
              .patchSettings(cameraId, { motionDetection: { enabled, mode } })
              .then(refreshSettings),
          'Failed to update activity assist.',
        );
      }}
      onToggleIndicator={
        cameraApi && indicatorId
          ? (value) =>
              runTask(
                () =>
                  cameraApi
                    .setOperatingControl(cameraId, 'indicator', indicatorId, value)
                    .then(refreshSettings),
                'Failed to update indicator.',
              )
          : undefined
      }
      onToggleNightVision={
        cameraApi && nightVisionId
          ? (value) =>
              runTask(
                () =>
                  cameraApi
                    .setOperatingControl(cameraId, 'nightVision', nightVisionId, value)
                    .then(refreshSettings),
                'Failed to update night vision.',
              )
          : undefined
      }
      onToggleHomeKit={
        cameraApi && homekitConfig
          ? (enabled) => {
              setPairingCode(undefined);
              runTask(
                () =>
                  cameraApi
                    .setHomeKit(cameraId, enabled, homekitConfig.processor)
                    .then(refreshSettings),
                'Failed to update Apple Home.',
              );
            }
          : undefined
      }
      onPairHomeKit={
        cameraApi && homekitConfig
          ? () =>
              runTask(async () => {
                const res = await cameraApi.startHomeKitPairing(cameraId);
                setPairingCode(res.paired ? undefined : res.code);
                await refreshSettings();
              }, 'Failed to pair Apple Home.')
          : undefined
      }
      onResetHomeKit={
        cameraApi && homekitConfig
          ? () => {
              setPairingCode(undefined);
              runTask(
                () => cameraApi.resetHomeKitPairing(cameraId).then(refreshSettings),
                'Failed to reset Apple Home pairing.',
              );
            }
          : undefined
      }
      onToggleHomeVisibility={() => {
        if (!onPreferencesPatch) return;
        onPreferencesPatch(toggleHomeVisibilityPatch(cameraId, allAccessories, preferences).patch);
      }}
      onToggleAppVisibility={() => {
        if (!onPreferencesPatch) return;
        onPreferencesPatch(toggleAppVisibilityPatch(cameraId, allAccessories, preferences).patch);
      }}
      onToggleRelated={(eid) => {
        if (availableAction(snapshot, eid, 'toggle')) onControl(eid, 'toggle');
      }}
      onPressRelated={(eid) => {
        if (availableAction(snapshot, eid, 'press')) onControl(eid, 'press');
      }}
      onSelectRelated={(eid, option) => {
        if (availableAction(snapshot, eid, 'select', option)) onControl(eid, 'select', option);
      }}
    />
  );
}
