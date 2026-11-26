/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useMemo, useState } from 'react';
import {
  collectHistoryEntities,
  friendlyEntityLabel,
  historyPoints,
  numericState,
  separateLightGroupPatch,
  toggleAppVisibilityPatch,
  toggleHomeVisibilityPatch,
  type HistoryRow,
} from '@haus/core/transport';
import type { HassEntity, Snapshot } from '@haus/ha/types';
import type { RegistryController } from '@haus/ha/ui/registry';
import type { Preferences } from '@haus/ha/view/preferences';
import type { HausAccessory } from '@haus/ha/view/types';
import {
  DeviceBrandIcon,
  DeviceDetailTabs,
  DeviceDetailsTab,
  DeviceHistoryPanel,
  DeviceSettingsTab,
  UiIcon,
  parseCssColor,
  type DeviceDetailTabKey,
  type SecondaryEntityControlItem,
  type TrendPoint,
} from '@haus/ui/components';
import { HausButton, HausDialog, Row, Stack, Text, type GlassRimProps } from '@haus/ui/primitives';
import { isRecord } from '../../main/hub/types.js';
import type { DeviceControl } from './cards.js';
import { DeviceControls } from './controls.js';
import type { StatisticsRequest } from './history.js';
import { availableAction, type HomeDevice } from './model.js';

function demoHistoryPoints(entity: HassEntity | undefined, days: 1 | 7): TrendPoint[] {
  if (!entity) return [];
  const end = Date.now();
  const span = days * 86_400_000;
  const count = 12;
  const numeric = numericState(entity.state);
  const brightness =
    entity.entity_id.startsWith('light.') && typeof entity.attributes.brightness === 'number'
      ? Math.round(entity.attributes.brightness / 2.55)
      : undefined;
  const base =
    numeric ??
    brightness ??
    (['on', 'open', 'playing', 'locked', 'heat'].includes(entity.state) ? 100 : 20);
  const spread = numeric !== undefined ? Math.max(1, Math.round(Math.abs(base) * 0.08)) : 18;
  const points: TrendPoint[] = [];
  for (let i = 0; i < count; i++) {
    const t = end - span + Math.round((span * i) / (count - 1));
    const offset = i === count - 1 ? 0 : ((i % 4) - 1.5) * (spread / 2);
    points.push({ time: t, value: Math.max(0, Number((base + offset).toFixed(1))) });
  }
  return points;
}

function parseHistoryRows(value: unknown): HistoryRow[] {
  if (!Array.isArray(value)) return [];
  const rows: HistoryRow[] = [];
  for (const item of value) {
    if (isRecord(item)) rows.push(item as HistoryRow);
  }
  return rows;
}

function toTrendPoints(rawPoints: ReturnType<typeof historyPoints>): TrendPoint[] {
  const result: TrendPoint[] = [];
  for (const pt of rawPoints) {
    const val = numericState(pt.state);
    if (val !== undefined) {
      result.push({ time: pt.at, value: val });
    } else if (['on', 'open', 'locked', 'playing'].includes(pt.state)) {
      result.push({ time: pt.at, value: 1 });
    } else if (['off', 'closed', 'unlocked', 'idle', 'paused'].includes(pt.state)) {
      result.push({ time: pt.at, value: 0 });
    }
  }
  return result;
}

export function DeviceDetailsModal({
  device,
  snapshot,
  preferences,
  allAccessories,
  demo,
  disabled,
  canFavorite,
  statistics,
  registry,
  onClose,
  onSelectDevice,
  onControl,
  onFavorite,
  onPreferencesPatch,
  onManage,
}: {
  readonly device: HomeDevice;
  readonly snapshot: Snapshot;
  readonly preferences?: Preferences;
  readonly allAccessories?: readonly HausAccessory[];
  readonly demo?: boolean;
  readonly disabled: boolean;
  readonly canFavorite: boolean;
  readonly statistics?: StatisticsRequest;
  readonly registry?: Pick<RegistryController, 'saveRoom' | 'updateEntity'>;
  readonly onClose: () => void;
  readonly onSelectDevice?: (id: string) => void;
  readonly onControl: DeviceControl;
  readonly onFavorite: (id: string, favorite: boolean) => void;
  readonly onPreferencesPatch?: (patch: Partial<Preferences>) => void;
  readonly onManage?: (url: string) => void;
}) {
  const { accessory } = device;
  const lightGroup = accessory.lightGroup;
  const [tab, setTab] = useState<DeviceDetailTabKey>('controls');
  const [selectedHistoryId, setSelectedHistoryId] = useState('');
  const [days, setDays] = useState<1 | 7>(1);
  const [liveHistory, setLiveHistory] = useState<{
    loading: boolean;
    error: string;
    points: TrendPoint[];
  }>({ loading: false, error: '', points: [] });
  const [settingsError, setSettingsError] = useState('');

  const historyEntities = useMemo(
    () => collectHistoryEntities([accessory.state, ...accessory.secondaryEntities]),
    [accessory.state, accessory.secondaryEntities],
  );
  const effectiveHistoryId = historyEntities.some((item) => item.entity_id === selectedHistoryId)
    ? selectedHistoryId
    : (historyEntities[0]?.entity_id ?? '');
  const selectedHistoryEntity = historyEntities.find(
    (item) => item.entity_id === effectiveHistoryId,
  );

  useEffect(() => {
    setTab('controls');
    setSettingsError('');
    setSelectedHistoryId('');
  }, [device.id]);

  useEffect(() => {
    if (tab !== 'history' || !effectiveHistoryId || demo) return;
    if (!statistics) {
      setLiveHistory({
        loading: false,
        error: 'Live history requires a connected Home Hub.',
        points: [],
      });
      return;
    }
    let active = true;
    const end = Date.now();
    const start = end - days * 86_400_000;
    setLiveHistory({ loading: true, error: '', points: [] });
    void statistics({
      type: 'history/history_during_period',
      entity_ids: [effectiveHistoryId],
      start_time: new Date(start).toISOString(),
      end_time: new Date(end).toISOString(),
      minimal_response: true,
      no_attributes: true,
      include_start_time_state: true,
      significant_changes_only: false,
    })
      .then((payload) => {
        if (!active) return;
        const raw = isRecord(payload) ? parseHistoryRows(payload[effectiveHistoryId]) : [];
        const points = toTrendPoints(historyPoints(raw, start, end));
        setLiveHistory({ loading: false, error: '', points });
      })
      .catch((err: unknown) => {
        if (!active) return;
        setLiveHistory({
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load history.',
          points: [],
        });
      });
    return () => {
      active = false;
    };
  }, [tab, effectiveHistoryId, days, demo, statistics]);

  const demoPoints = useMemo(
    () => (demo && tab === 'history' ? demoHistoryPoints(selectedHistoryEntity, days) : []),
    [demo, tab, selectedHistoryEntity, days],
  );

  const area = snapshot.areas.find((item) => item.area_id === accessory.areaId);
  const metadata = [
    { label: 'Name', value: device.name },
    { label: 'Haus ID', value: accessory.hausId ?? '—', mono: true },
    { label: 'Entity', value: device.id, mono: true },
    { label: 'Device', value: accessory.deviceId ?? '—', mono: true },
    { label: 'Room', value: area?.name ?? 'Unassigned' },
    { label: 'Manufacturer', value: accessory.manufacturer ?? '—' },
    { label: 'Model', value: accessory.model ?? '—' },
    { label: 'State', value: device.state },
  ];

  const secondaryItems: SecondaryEntityControlItem[] = accessory.secondaryEntities.map((entity) => {
    const eid = entity.entity_id;
    const domain = eid.split('.')[0] ?? '';
    const unit =
      typeof entity.attributes.unit_of_measurement === 'string'
        ? ` ${entity.attributes.unit_of_measurement}`
        : '';
    const options = Array.isArray(entity.attributes.options)
      ? entity.attributes.options.filter((opt): opt is string => typeof opt === 'string')
      : undefined;
    const kind: SecondaryEntityControlItem['kind'] =
      (domain === 'switch' || domain === 'input_boolean') &&
      availableAction(snapshot, eid, 'toggle')
        ? 'switch'
        : (domain === 'button' || domain === 'input_button') &&
            availableAction(snapshot, eid, 'press')
          ? 'button'
          : (domain === 'select' || domain === 'input_select') &&
              options &&
              options.length > 0 &&
              availableAction(snapshot, eid, 'select', options[0])
            ? 'select'
            : 'readonly';
    return {
      id: eid,
      label: friendlyEntityLabel(entity, accessory.name),
      kind,
      valueText: kind === 'select' ? entity.state : `${entity.state}${unit}`,
      checked: entity.state === 'on',
      options,
    };
  });

  const visibilityList = allAccessories ?? [accessory];
  const hiddenHome = preferences ? preferences.hiddenHome.includes(device.id) : false;
  const hiddenApp = preferences ? preferences.hiddenApp.includes(device.id) : false;
  const canEdit = Boolean(registry && snapshot.user.is_admin && !lightGroup);

  const controlsContent = (
    <Stack gapPx={12}>
      <Row justify="between" align="center">
        <Row gapPx={8} align="center">
          <DeviceBrandIcon device={device.deviceIcon} size={17} color={device.accent} />
          <Text tone="muted" size={12}>
            State
          </Text>
        </Row>
        <Text size={12} weight={500}>
          {device.state}
        </Text>
      </Row>
      <DeviceControls
        device={device}
        snapshot={snapshot}
        disabled={disabled}
        onControl={onControl}
        onOpenMember={onSelectDevice}
        onSeparateLightGroup={
          onPreferencesPatch && preferences && lightGroup
            ? (groupKey) => {
                onPreferencesPatch(separateLightGroupPatch(groupKey, preferences));
                onClose();
              }
            : undefined
        }
        onManage={onManage}
      />
      <Row gapPx={8} align="center" wrap>
        <HausButton
          id={`device-${device.id}-favorite`}
          size="sm"
          variant="secondary"
          disabled={!canFavorite || Boolean(lightGroup)}
          onPress={() => onFavorite(device.id, !device.favorite)}
        >
          <UiIcon name="heart" size={13} />
          <Text size={11}>{device.favorite ? 'Remove favorite' : 'Add to favorites'}</Text>
        </HausButton>
        {accessory.manufacturer && (
          <Text size={11} tone="muted">
            {accessory.manufacturer}
          </Text>
        )}
      </Row>
    </Stack>
  );

  const historyContent = (
    <DeviceHistoryPanel
      entities={historyEntities.map((item) => ({
        id: item.entity_id,
        label: friendlyEntityLabel(item, accessory.name),
        unit:
          typeof item.attributes.unit_of_measurement === 'string'
            ? item.attributes.unit_of_measurement
            : undefined,
      }))}
      selectedEntityId={effectiveHistoryId}
      days={days}
      loading={demo ? false : liveHistory.loading}
      error={demo ? '' : liveHistory.error}
      points={demo ? demoPoints : liveHistory.points}
      onSelectEntity={setSelectedHistoryId}
      onSelectDays={setDays}
    />
  );

  const detailsContent = (
    <DeviceDetailsTab
      metadata={metadata}
      secondaryEntities={secondaryItems}
      disabled={disabled}
      onToggleSecondary={(eid) => {
        if (availableAction(snapshot, eid, 'toggle')) onControl(eid, 'toggle');
      }}
      onPressSecondary={(eid) => {
        if (availableAction(snapshot, eid, 'press')) onControl(eid, 'press');
      }}
      onSelectSecondary={(eid, option) => {
        if (availableAction(snapshot, eid, 'select', option)) onControl(eid, 'select', option);
      }}
    />
  );

  const settingsContent = (
    <Stack gapPx={10}>
      {settingsError && (
        <Text tone="critical" size={12}>
          {settingsError}
        </Text>
      )}
      <DeviceSettingsTab
        initialName={device.name}
        initialAreaId={accessory.areaId ?? ''}
        areas={snapshot.areas.map((item) => ({ id: item.area_id, name: item.name }))}
        hiddenHome={hiddenHome}
        hiddenApp={hiddenApp}
        canEdit={canEdit}
        demo={demo}
        onToggleHomeVisibility={() => {
          if (!preferences || !onPreferencesPatch) return;
          onPreferencesPatch(
            toggleHomeVisibilityPatch(accessory, visibilityList, preferences).patch,
          );
        }}
        onToggleAppVisibility={() => {
          if (!preferences || !onPreferencesPatch) return;
          onPreferencesPatch(
            toggleAppVisibilityPatch(accessory, visibilityList, preferences).patch,
          );
        }}
        onRename={(name) => {
          if (!registry) return;
          void registry.updateEntity(device.id, { name }).then(
            () => setSettingsError(''),
            (err: unknown) =>
              setSettingsError(err instanceof Error ? err.message : 'Could not rename device.'),
          );
        }}
        onMoveRoom={(nextAreaId) => {
          if (!registry) return;
          void registry.updateEntity(device.id, { area_id: nextAreaId || null }).then(
            () => setSettingsError(''),
            (err: unknown) =>
              setSettingsError(err instanceof Error ? err.message : 'Could not move device.'),
          );
        }}
      />
    </Stack>
  );

  const activeEffect = device.active ? device.lightEffect : undefined;
  const accentColor = parseCssColor(device.accent);
  const modalRim: Omit<GlassRimProps, 'preset'> | undefined = device.active
    ? activeEffect
      ? {
          opacity: 0.82,
          effectColors: [
            parseCssColor(activeEffect.palette[0]) ?? accentColor,
            parseCssColor(activeEffect.palette[1]),
            parseCssColor(activeEffect.palette[2]),
          ],
          effectMotion: activeEffect.motion,
        }
      : accentColor
        ? { opacity: 0.78, tintColor: accentColor }
        : undefined
    : undefined;

  return (
    <HausDialog
      title={device.name}
      onClose={onClose}
      size={accessory.powerStrip ? 'lg' : undefined}
      backdrop="blur"
      rim={modalRim}
      scrollable
    >
      <DeviceDetailTabs
        activeTab={tab}
        onSelectTab={setTab}
        controls={controlsContent}
        history={historyContent}
        details={detailsContent}
        settings={settingsContent}
      />
    </HausDialog>
  );
}
