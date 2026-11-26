/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState, type ReactNode } from 'react';
import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  HausSegmentedControl,
  HausSwitch,
  Row,
  ScrollView,
  SelectInput,
  Stack,
  Text,
  TextInput,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';
import { RecorderTrend, type TrendPoint } from '../trend.js';

export type DeviceDetailTabKey = 'controls' | 'history' | 'details' | 'settings';

export interface HistoryEntityOption {
  readonly id: string;
  readonly label: string;
  readonly unit?: string;
}

export function DeviceHistoryPanel({
  entities,
  selectedEntityId,
  days,
  loading,
  error,
  points,
  onSelectEntity,
  onSelectDays,
}: {
  readonly entities: readonly HistoryEntityOption[];
  readonly selectedEntityId: string;
  readonly days: 1 | 7;
  readonly loading: boolean;
  readonly error: string;
  readonly points: readonly TrendPoint[];
  readonly onSelectEntity: (id: string) => void;
  readonly onSelectDays: (days: 1 | 7) => void;
}) {
  if (entities.length === 0) {
    return (
      <Text tone="muted" size={12}>
        No historical telemetry is available for this device.
      </Text>
    );
  }

  const active = entities.find((item) => item.id === selectedEntityId);
  const unit = active?.unit ?? '';
  const values = points.map((p) => p.value);
  const latest = values.at(-1);
  const minVal = values.length ? Math.min(...values) : undefined;
  const maxVal = values.length ? Math.max(...values) : undefined;

  return (
    <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
      <Row gapPx={8} align="center" justify="between" wrap>
        <Box style={{ layout: { flexGrow: 1, minWidth: px(160) } }}>
          <SelectInput
            id="device-history-entity"
            ariaLabel="History measurement"
            value={selectedEntityId}
            options={entities.map((e) => ({ value: e.id, label: e.label }))}
            onChange={onSelectEntity}
          />
        </Box>
        <HausSegmentedControl<'1' | '7'>
          id="device-history-period"
          aria-label="History period"
          value={String(days) as '1' | '7'}
          options={[
            { value: '1', label: '24 hours' },
            { value: '7', label: '7 days' },
          ]}
          onChange={(next) => onSelectDays(next === '7' ? 7 : 1)}
        />
      </Row>

      {loading ? (
        <Text tone="muted" size={12}>
          Loading measurement history…
        </Text>
      ) : error ? (
        <Text tone="critical" size={12}>
          {error}
        </Text>
      ) : points.length > 0 ? (
        <Stack gapPx={10}>
          <RecorderTrend
            points={points}
            label={`${active?.label ?? 'History'} over ${days === 1 ? '24 hours' : '7 days'}`}
            compactDates={days === 1}
            portable
          />
          <Row justify="between" style={{ layout: { width: pct(100) } }}>
            <Text size={11} tone="muted">
              Low: {minVal?.toFixed(1)}
              {unit}
            </Text>
            <Text size={11} weight={600}>
              Latest: {latest?.toFixed(1)}
              {unit}
            </Text>
            <Text size={11} tone="muted">
              High: {maxVal?.toFixed(1)}
              {unit}
            </Text>
          </Row>
        </Stack>
      ) : (
        <Text tone="muted" size={12}>
          No numeric data points recorded in this range.
        </Text>
      )}
    </Stack>
  );
}

export interface SecondaryEntityControlItem {
  readonly id: string;
  readonly label: string;
  readonly kind: 'switch' | 'button' | 'select' | 'readonly';
  readonly valueText: string;
  readonly checked?: boolean;
  readonly options?: readonly string[];
}

export function DeviceDetailsTab({
  metadata,
  secondaryEntities,
  disabled,
  onToggleSecondary,
  onPressSecondary,
  onSelectSecondary,
}: {
  readonly metadata: readonly {
    readonly label: string;
    readonly value: string;
    readonly mono?: boolean;
  }[];
  readonly secondaryEntities: readonly SecondaryEntityControlItem[];
  readonly disabled: boolean;
  readonly onToggleSecondary: (id: string) => void;
  readonly onPressSecondary: (id: string) => void;
  readonly onSelectSecondary: (id: string, option: string) => void;
}) {
  return (
    <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
      <Stack
        gapPx={8}
        style={{
          layout: { padding: insets(12) },
          material: new SolidMaterial(colorToken('surface')),
          border: { width: 1, color: colorToken('border') },
          corners: corners(14),
        }}
      >
        <Text size={12} weight={600}>
          About this accessory
        </Text>
        {metadata.map((row) => (
          <Row
            key={row.label}
            justify="between"
            align="center"
            gapPx={10}
            style={{ layout: { width: pct(100) } }}
          >
            <Text size={12} tone="muted">
              {row.label}
            </Text>
            <Text size={12} mono={row.mono} weight={500}>
              {row.value}
            </Text>
          </Row>
        ))}
      </Stack>

      {secondaryEntities.length > 0 && (
        <Stack gapPx={8}>
          <Text size={12} weight={600}>
            Additional controls
          </Text>
          {secondaryEntities.map((item) => (
            <Row
              key={item.id}
              justify="between"
              align="center"
              gapPx={10}
              style={{
                layout: { width: pct(100), padding: insets(8, 12) },
                material: new SolidMaterial(colorToken('surface')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(12),
              }}
            >
              <Stack gapPx={1} style={{ layout: { minWidth: px(0), flexGrow: 1 } }}>
                <Text size={12} weight={500}>
                  {item.label}
                </Text>
                <Text size={10} tone="muted" mono>
                  {item.id}
                </Text>
              </Stack>
              {item.kind === 'switch' ? (
                <HausSwitch
                  checked={Boolean(item.checked)}
                  disabled={disabled}
                  onChange={() => onToggleSecondary(item.id)}
                />
              ) : item.kind === 'button' ? (
                <HausButton
                  size="sm"
                  variant="secondary"
                  disabled={disabled}
                  onPress={() => onPressSecondary(item.id)}
                >
                  Run
                </HausButton>
              ) : item.kind === 'select' && item.options?.length ? (
                <Box style={{ layout: { minWidth: px(120) } }}>
                  <SelectInput
                    value={item.valueText}
                    disabled={disabled}
                    options={item.options.map((opt) => ({ value: opt, label: opt }))}
                    onChange={(next) => onSelectSecondary(item.id, next)}
                  />
                </Box>
              ) : (
                <Text size={12} tone="muted">
                  {item.valueText}
                </Text>
              )}
            </Row>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

export function DeviceSettingsTab({
  initialName,
  initialAreaId,
  areas,
  hiddenHome,
  hiddenApp,
  canEdit,
  demo,
  onToggleHomeVisibility,
  onToggleAppVisibility,
  onRename,
  onMoveRoom,
}: {
  readonly initialName: string;
  readonly initialAreaId: string;
  readonly areas: readonly { readonly id: string; readonly name: string }[];
  readonly hiddenHome: boolean;
  readonly hiddenApp: boolean;
  readonly canEdit: boolean;
  readonly demo?: boolean;
  readonly onToggleHomeVisibility: () => void;
  readonly onToggleAppVisibility: () => void;
  readonly onRename: (name: string) => void;
  readonly onMoveRoom: (areaId: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [areaId, setAreaId] = useState(initialAreaId);

  return (
    <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
      <Stack
        gapPx={10}
        style={{
          layout: { padding: insets(12) },
          material: new SolidMaterial(colorToken('surface')),
          border: { width: 1, color: colorToken('border') },
          corners: corners(14),
        }}
      >
        <Text size={12} weight={600}>
          Visibility
        </Text>
        <Row justify="between" align="center" style={{ layout: { width: pct(100) } }}>
          <Row align="center" gapPx={8}>
            <UiIcon name={hiddenHome ? 'eye' : 'eye-off'} size={16} />
            <Stack gapPx={1}>
              <Text size={12} weight={600}>
                Home view
              </Text>
              <Text size={11} tone="muted">
                {hiddenHome ? 'Hidden on Home' : 'Shown on Home'}
              </Text>
            </Stack>
          </Row>
          <HausButton
            id="device-toggle-home"
            size="sm"
            variant="secondary"
            onPress={onToggleHomeVisibility}
          >
            {hiddenHome ? 'Show on Home' : 'Hide from Home view'}
          </HausButton>
        </Row>
        <Row justify="between" align="center" style={{ layout: { width: pct(100) } }}>
          <Row align="center" gapPx={8}>
            <UiIcon name={hiddenApp ? 'eye' : 'eye-off'} size={16} />
            <Stack gapPx={1}>
              <Text size={12} weight={600}>
                Haus app
              </Text>
              <Text size={11} tone="muted">
                {hiddenApp ? 'In Hidden' : 'Shown throughout the app'}
              </Text>
            </Stack>
          </Row>
          <HausButton
            id="device-toggle-app"
            size="sm"
            variant="secondary"
            onPress={onToggleAppVisibility}
          >
            {hiddenApp ? 'Restore to app' : 'Hide from app'}
          </HausButton>
        </Row>
      </Stack>

      <Stack gapPx={8}>
        <Text size={12} weight={600}>
          Accessory name
        </Text>
        <Row gapPx={8} align="center" style={{ layout: { width: pct(100) } }}>
          <Box style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
            <TextInput
              id="device-rename-input"
              ariaLabel="Accessory name"
              value={name}
              maxLength={120}
              disabled={!canEdit}
              onChange={setName}
              style={{
                layout: { height: px(34), width: pct(100), padding: insets(6, 10) },
                material: new SolidMaterial(colorToken('surface')),
              }}
            />
          </Box>
          <HausButton
            id="device-rename-save"
            size="sm"
            variant="secondary"
            disabled={!canEdit || !name.trim() || name.trim() === initialName}
            onPress={() => onRename(name.trim())}
          >
            Save name
          </HausButton>
        </Row>
      </Stack>

      <Stack gapPx={8}>
        <Text size={12} weight={600}>
          Room
        </Text>
        <Row gapPx={8} align="center" style={{ layout: { width: pct(100) } }}>
          <Box style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
            <SelectInput
              id="device-room-select"
              ariaLabel="Room"
              value={areaId}
              disabled={!canEdit}
              options={[
                { value: '', label: 'Unassigned' },
                ...areas.map((area) => ({ value: area.id, label: area.name })),
              ]}
              onChange={setAreaId}
            />
          </Box>
          <HausButton
            id="device-move-room-save"
            size="sm"
            variant="secondary"
            disabled={!canEdit || areaId === initialAreaId}
            onPress={() => onMoveRoom(areaId)}
          >
            Move to room
          </HausButton>
        </Row>
      </Stack>

      <Text size={11} tone="muted">
        {demo
          ? 'Room and name changes stay in this sample home.'
          : 'Room and name changes sync across your home.'}
        {!canEdit && ' An administrator account is required to edit them.'}
      </Text>
    </Stack>
  );
}

export function DeviceDetailTabs({
  activeTab,
  onSelectTab,
  controls,
  history,
  details,
  settings,
}: {
  readonly activeTab: DeviceDetailTabKey;
  readonly onSelectTab: (tab: DeviceDetailTabKey) => void;
  readonly controls: ReactNode;
  readonly history: ReactNode;
  readonly details: ReactNode;
  readonly settings: ReactNode;
}) {
  return (
    <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
      <HausSegmentedControl<DeviceDetailTabKey>
        id="device-detail-tabs"
        aria-label="Device sections"
        value={activeTab}
        options={[
          { value: 'controls', label: 'Controls' },
          { value: 'history', label: 'History' },
          { value: 'details', label: 'Details' },
          { value: 'settings', label: 'Settings' },
        ]}
        onChange={onSelectTab}
      />
      <ScrollView
        orientation="vertical"
        style={{
          layout: { maxHeight: px(460), minHeight: px(0), direction: 'column', gap: px(12) },
        }}
      >
        {activeTab === 'controls'
          ? controls
          : activeTab === 'history'
            ? history
            : activeTab === 'details'
              ? details
              : settings}
      </ScrollView>
    </Stack>
  );
}
