/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useState } from 'react';
import {
  colorToken,
  corners,
  insets,
  mixColor,
  pct,
  px,
  rgba,
  transparentColor,
} from '../../../ir/geometry.js';
import { SolidMaterial } from '../../../ir/materials.js';
import {
  Box,
  HausButton,
  HausSlider,
  Row,
  Stack,
  Text,
} from '../../../primitives/index.js';
import { UiIcon } from '../../icon.js';
import {
  DeviceModalHeroBanner,
  DeviceModalOrbStage,
  DeviceModalSurfaceCard,
  DevicePresetPills,
} from './surfaces.js';

function useDraftNumber(value: number) {
  const [draft, setDraft] = useState<number>();
  useEffect(() => {
    setDraft(undefined);
  }, [value]);
  return [draft ?? value, setDraft] as const;
}

export function CoverModalPanel({
  idPrefix,
  position,
  stateLabel,
  isValve = false,
  canPosition,
  canOpen,
  canStop,
  canClose,
  disabled,
  onPosition,
  onOpen,
  onStop,
  onClose,
}: {
  readonly idPrefix: string;
  readonly position: number;
  readonly stateLabel: string;
  readonly isValve?: boolean;
  readonly canPosition: boolean;
  readonly canOpen: boolean;
  readonly canStop: boolean;
  readonly canClose: boolean;
  readonly disabled: boolean;
  readonly onPosition?: (pos: number) => void;
  readonly onOpen?: () => void;
  readonly onStop?: () => void;
  readonly onClose?: () => void;
}) {
  const [shownPos, setDraftPos] = useDraftNumber(position);
  const closedPct = Math.max(8, Math.min(100, 100 - shownPos));

  return (
    <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
      <DeviceModalSurfaceCard
        title={isValve ? 'Valve flow' : 'Shade aperture'}
        badge={`${shownPos}% open`}
      >
        <Row align="center" gapPx={14} style={{ layout: { width: pct(100) } }}>
          <Box
            ariaHidden
            style={{
              layout: {
                width: px(52),
                height: px(64),
                overflow: 'hidden',
                direction: 'column',
                justifyContent: 'start',
                flexShrink: 0,
              },
              corners: corners(12),
              material: new SolidMaterial(colorToken('surface')),
              border: { width: 1, color: colorToken('border') },
            }}
          >
            <Box
              style={{
                layout: { width: pct(100), height: pct(closedPct) },
                material: new SolidMaterial(mixColor(transparentColor, colorToken('ink'), 0.22)),
                transitionMs: 200,
              }}
            />
          </Box>
          <Stack gapPx={4} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
            <Text size={18} weight={600}>
              {stateLabel}
            </Text>
            <Text size={12} tone="muted">
              {shownPos <= 0
                ? 'Fully closed'
                : shownPos >= 100
                  ? 'Fully open'
                  : `${shownPos}% open`}
            </Text>
          </Stack>
        </Row>

        {(canOpen || canStop || canClose) && (
          <Row gapPx={8} style={{ layout: { width: pct(100) } }}>
            {canOpen && onOpen && (
              <HausButton
                id={`${idPrefix}-open`}
                size="sm"
                variant="secondary"
                fullWidth
                disabled={disabled}
                onPress={onOpen}
              >
                <UiIcon name="arrow-up" size={14} />
                <Text size={12.5}>Open</Text>
              </HausButton>
            )}
            {canStop && onStop && (
              <HausButton
                id={`${idPrefix}-stop`}
                size="sm"
                variant="outline"
                fullWidth
                disabled={disabled}
                onPress={onStop}
              >
                <UiIcon name="pause" size={14} />
                <Text size={12.5}>Stop</Text>
              </HausButton>
            )}
            {canClose && onClose && (
              <HausButton
                id={`${idPrefix}-close`}
                size="sm"
                variant="secondary"
                fullWidth
                disabled={disabled}
                onPress={onClose}
              >
                <UiIcon name="arrow-down" size={14} />
                <Text size={12.5}>Close</Text>
              </HausButton>
            )}
          </Row>
        )}

        {canPosition && onPosition && (
          <Stack gapPx={10} style={{ layout: { width: pct(100) } }}>
            <HausSlider
              id={`${idPrefix}-position`}
              label="Open position"
              valueLabel={`${shownPos}%`}
              value={shownPos}
              min={0}
              max={100}
              size="lg"
              disabled={disabled}
              onChange={setDraftPos}
              onChangeEnd={(next) => {
                setDraftPos(undefined);
                if (next !== position) onPosition(next);
              }}
            />
            <DevicePresetPills
              idPrefix={idPrefix}
              disabled={disabled}
              items={[
                { label: 'Closed', value: 0, active: shownPos === 0 },
                { label: '25%', value: 25, active: Math.abs(shownPos - 25) <= 3 },
                { label: '50%', value: 50, active: Math.abs(shownPos - 50) <= 3 },
                { label: '75%', value: 75, active: Math.abs(shownPos - 75) <= 3 },
                { label: 'Open', value: 100, active: shownPos === 100 },
              ]}
              onSelect={onPosition}
            />
          </Stack>
        )}
      </DeviceModalSurfaceCard>
    </Stack>
  );
}

export function LockModalPanel({
  idPrefix,
  deviceName,
  locked,
  transitioning = false,
  canToggle,
  disabled,
  onConfirmAction,
}: {
  readonly idPrefix: string;
  readonly deviceName: string;
  readonly locked: boolean;
  readonly transitioning?: boolean;
  readonly canToggle: boolean;
  readonly disabled: boolean;
  readonly onConfirmAction: (intent: 'lock' | 'unlock') => void;
}) {
  const [confirming, setConfirming] = useState<'lock' | 'unlock' | null>(null);
  const nextIntent = locked ? 'unlock' : 'lock';

  return (
    <DeviceModalOrbStage
      id={`${idPrefix}-lock-orb`}
      iconName={locked ? 'lock-keyhole' : 'lock-keyhole-open'}
      stateLabel={transitioning ? 'Updating lock…' : locked ? 'Secured' : 'Unlocked'}
      caption={
        transitioning
          ? 'Waiting for mechanism confirmation'
          : locked
            ? `${deviceName} is locked and secured.`
            : `${deviceName} is currently unlocked.`
      }
      active={!locked}
      accentColor={locked ? rgba(52, 211, 153, 1) : rgba(251, 191, 36, 1)}
      disabled={disabled || transitioning || !canToggle}
      ariaLabel={locked ? `Unlock ${deviceName}` : `Lock ${deviceName}`}
      onPress={canToggle ? () => setConfirming(nextIntent) : undefined}
      footer={
        canToggle ? (
          confirming ? (
            <Stack
              gapPx={8}
              style={{
                layout: { width: pct(100), padding: insets(10, 12) },
                material: new SolidMaterial(colorToken('surface')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(14),
              }}
            >
              <Text size={12} weight={500} style={{ typography: { align: 'center' } }}>
                {`Confirm ${confirming} for ${deviceName}?`}
              </Text>
              <Row gapPx={8} style={{ layout: { width: pct(100) } }}>
                <HausButton
                  id={`${idPrefix}-lock-cancel`}
                  size="sm"
                  variant="secondary"
                  fullWidth
                  onPress={() => setConfirming(null)}
                >
                  Cancel
                </HausButton>
                <HausButton
                  id={`${idPrefix}-lock-confirm`}
                  size="sm"
                  variant={confirming === 'unlock' ? 'danger' : 'primary'}
                  fullWidth
                  disabled={disabled}
                  onPress={() => {
                    onConfirmAction(confirming);
                    setConfirming(null);
                  }}
                >
                  {confirming === 'unlock' ? 'Confirm unlock' : 'Confirm lock'}
                </HausButton>
              </Row>
            </Stack>
          ) : (
            <HausButton
              id={`${idPrefix}-lock-action`}
              size="md"
              variant="secondary"
              fullWidth
              disabled={disabled || transitioning}
              onPress={() => setConfirming(nextIntent)}
            >
              {locked ? 'Unlock door' : 'Lock door'}
            </HausButton>
          )
        ) : undefined
      }
    />
  );
}

export function FanModalPanel({
  idPrefix,
  active,
  percentage,
  step = 1,
  canToggle,
  canPercentage,
  disabled,
  onToggle,
  onPercentage,
}: {
  readonly idPrefix: string;
  readonly active: boolean;
  readonly percentage: number;
  readonly step?: number;
  readonly canToggle: boolean;
  readonly canPercentage: boolean;
  readonly disabled: boolean;
  readonly onToggle?: () => void;
  readonly onPercentage?: (pctValue: number) => void;
}) {
  const [shownPct, setDraftPct] = useDraftNumber(active ? percentage : 0);

  return (
    <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
      <DeviceModalHeroBanner
        id={`${idPrefix}-toggle`}
        title={active ? `Running · ${shownPct}%` : 'Off'}
        subtitle={canPercentage ? 'Airflow & circulation speed' : 'Power control'}
        iconName="wind"
        active={active}
        disabled={disabled || !canToggle}
        switchChecked={active}
        onToggle={canToggle ? onToggle : undefined}
      />
      {canPercentage && onPercentage && (
        <DeviceModalSurfaceCard title="Airflow speed">
          <HausSlider
            id={`${idPrefix}-fan-speed`}
            label="Speed"
            valueLabel={`${shownPct}%`}
            value={shownPct}
            min={0}
            max={100}
            step={step}
            size="lg"
            disabled={disabled}
            onChange={setDraftPct}
            onChangeEnd={(next) => {
              setDraftPct(undefined);
              if (next !== percentage) onPercentage(next);
            }}
          />
          <DevicePresetPills
            idPrefix={idPrefix}
            disabled={disabled}
            items={[
              { label: 'Off', value: 0, active: !active || shownPct === 0 },
              { label: 'Low', value: 25, active: active && Math.abs(shownPct - 25) <= 8 },
              { label: 'Med', value: 50, active: active && Math.abs(shownPct - 50) <= 8 },
              { label: 'High', value: 75, active: active && Math.abs(shownPct - 75) <= 8 },
              { label: 'Max', value: 100, active: active && shownPct >= 95 },
            ]}
            onSelect={(val) => {
              if (val === 0 && active && onToggle) onToggle();
              else onPercentage(val);
            }}
          />
        </DeviceModalSurfaceCard>
      )}
    </Stack>
  );
}
