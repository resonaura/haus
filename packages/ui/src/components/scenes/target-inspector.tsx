/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useMemo, useState } from 'react';
import {
  describeSavedTargetValues,
  hexToRgbTuple,
  inferSceneTargetDomain,
  patchSceneTarget,
  resolveSceneTargetVisual,
  SCENE_CURATED_SWATCHES,
  targetConfig,
  type SceneEntityLike,
  type SceneTarget,
} from '@haus/core/transport';
import type { DeviceCategory } from '../../categories/index.js';
import { colorToken, corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  HausSlider,
  HausTextArea,
  Heading,
  Pressable,
  Row,
  Stack,
  Text,
  TextInput,
} from '../../primitives/index.js';
import { parseCssColor } from '../devices/tile-theme.js';
import { UiIcon } from '../icon.js';
import { DEVICE_ICONS, type UiIconName } from '../icons.js';

export interface SceneReplacementOption {
  readonly id: string;
  readonly name: string;
  readonly roomName: string;
  readonly domain: string;
  readonly category?: DeviceCategory;
  readonly iconName?: UiIconName;
  readonly entity: SceneEntityLike;
}

export function SceneTargetInspector({
  id,
  name,
  roomName,
  entity,
  value,
  replacementCandidates = [],
  removeLabel = 'Remove from scene',
  onChange,
  onReplace,
  onRemove,
  onClose,
}: {
  readonly id: string;
  readonly name: string;
  readonly roomName: string;
  readonly entity?: SceneEntityLike;
  readonly value: unknown;
  readonly replacementCandidates?: readonly SceneReplacementOption[];
  readonly removeLabel?: string;
  readonly onChange: (next: SceneTarget) => void;
  readonly onReplace?: (target: SceneEntityLike) => void;
  readonly onRemove: () => void;
  readonly onClose: () => void;
}) {
  const [replaceQuery, setReplaceQuery] = useState('');
  const [showRawJson, setShowRawJson] = useState(false);
  const [rawJsonText, setRawJsonText] = useState('');
  const [rawJsonError, setRawJsonError] = useState('');

  const config = targetConfig(value);
  const visual = resolveSceneTargetVisual(id, entity, config);
  const missing = !entity;
  const missingDomain = inferSceneTargetDomain(id, config);
  const savedSummary = describeSavedTargetValues(id, config);

  const filteredCandidates = useMemo(() => {
    const q = replaceQuery.trim().toLowerCase();
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    return [...replacementCandidates]
      .filter(
        (item) =>
          !q || `${item.name} ${item.roomName} ${item.id}`.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        const aMatch = a.domain === missingDomain ? 0 : 1;
        const bMatch = b.domain === missingDomain ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
        return collator.compare(a.roomName, b.roomName) || collator.compare(a.name, b.name);
      });
  }, [missingDomain, replaceQuery, replacementCandidates]);

  const patch = (key: string, nextValue: unknown) => {
    const updated = patchSceneTarget(config, key, nextValue);
    onChange(updated);
    if (showRawJson) setRawJsonText(JSON.stringify(updated, null, 2));
  };

  const parsedSwatch = parseCssColor(visual.swatchCss);

  return (
    <Stack
      gapPx={14}
      style={{
        layout: { width: pct(100), padding: insets(16, 18) },
        material: new SolidMaterial(colorToken('surfaceSecondary')),
        border: { width: 1, color: colorToken('border') },
        corners: corners(18, 'superellipse', 1.4),
      }}
    >
      <Row align="center" justify="between" gapPx={10}>
        <Row align="center" gapPx={10} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
          {parsedSwatch && (
            <Box
              ariaHidden
              style={{
                layout: { width: px(14), height: px(14), flexShrink: 0 },
                material: new SolidMaterial(parsedSwatch),
                corners: corners(999, 'round'),
                border: { width: 1, color: rgba(255, 255, 255, 0.28) },
              }}
            />
          )}
          <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
            <Heading level={4} size={14} weight={600}>
              {name}
            </Heading>
            <Text size={11.5} tone="muted">
              {missing ? `Unavailable · ${id}` : `${roomName} · ${visual.stateText}`}
            </Text>
          </Stack>
        </Row>
        <HausButton
          id={`scene-inspector-close-${id}`}
          variant="ghost"
          size="sm"
          aria-label="Close accessory settings"
          onPress={onClose}
        >
          <UiIcon name="x" size={15} />
        </HausButton>
      </Row>

      {missing ? (
        <Stack gapPx={12}>
          <Row
            gapPx={10}
            style={{
              layout: { width: pct(100), padding: insets(12, 14) },
              material: new SolidMaterial(rgba(245, 158, 11, 0.12)),
              border: { width: 1, color: rgba(245, 158, 11, 0.32) },
              corners: corners(12),
            }}
          >
            <UiIcon name="alert-circle" size={16} color="#f59e0b" />
            <Stack gapPx={3} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
              <Text size={12.5} weight={600}>
                Accessory no longer in your home
              </Text>
              <Text size={11.5} tone="muted" style={{ typography: { lineHeight: 1.45 } }}>
                {savedSummary
                  ? `Saved settings (${savedSummary}) will transfer automatically when you pick a replacement.`
                  : 'Pick another accessory to replace it, or remove it.'}
              </Text>
            </Stack>
          </Row>

          {onReplace && replacementCandidates.length > 0 && (
            <Stack gapPx={8}>
              <Row align="center" gapPx={6}>
                <UiIcon name="arrow-left-right" size={13} />
                <Text size={12} weight={600}>
                  Replace accessory (keeps saved settings)
                </Text>
              </Row>
              <TextInput
                ariaLabel="Search replacement accessory"
                placeholder="Search accessories or rooms…"
                value={replaceQuery}
                onChange={setReplaceQuery}
                style={{
                  layout: { width: pct(100), minHeight: px(34), padding: insets(6, 10) },
                  material: new SolidMaterial(colorToken('surface')),
                  border: { width: 1, color: colorToken('border') },
                  corners: corners(10),
                  typography: { size: 12.5, color: colorToken('textPrimary') },
                }}
              />
              <Stack gapPx={6} style={{ layout: { maxHeight: px(180), overflowY: 'scroll' } }}>
                {filteredCandidates.slice(0, 24).map((candidate) => {
                  const sameType = candidate.domain === missingDomain;
                  const icon =
                    candidate.iconName ?? DEVICE_ICONS[candidate.category ?? 'other'];
                  return (
                    <Pressable
                      key={candidate.id}
                      id={`scene-replace-${candidate.id}`}
                      onActivate={() => onReplace(candidate.entity)}
                      style={{
                        layout: {
                          width: pct(100),
                          padding: insets(8, 12),
                          direction: 'row',
                          alignItems: 'center',
                          justifyContent: 'between',
                          gap: px(10),
                        },
                        material: new SolidMaterial(colorToken('surface')),
                        border: { width: 1, color: colorToken('border') },
                        corners: corners(10),
                      }}
                    >
                      <Row align="center" gapPx={8} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                        <UiIcon name={icon} size={15} />
                        <Stack gapPx={1} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                          <Text size={12.5} weight={600}>
                            {candidate.name}
                          </Text>
                          <Text size={11} tone="muted">
                            {candidate.roomName}
                          </Text>
                        </Stack>
                      </Row>
                      {sameType && (
                        <Box
                          style={{
                            layout: { padding: insets(2, 8) },
                            material: new SolidMaterial(colorToken('surfaceActive')),
                            corners: corners(999),
                          }}
                        >
                          <Text size={10.5} weight={600}>
                            Same type
                          </Text>
                        </Box>
                      )}
                    </Pressable>
                  );
                })}
                {filteredCandidates.length === 0 && (
                  <Text size={12} tone="muted">
                    No matching accessories found.
                  </Text>
                )}
              </Stack>
            </Stack>
          )}
        </Stack>
      ) : (
        <Stack gapPx={12}>
          <Stack gapPx={6}>
            <Text size={11.5} weight={600} tone="muted">
              Target state
            </Text>
            <Row gapPx={6} wrap>
              {visual.stateChoices.map((choice) => {
                const active = visual.stateValue === choice;
                return (
                  <Pressable
                    key={choice}
                    id={`scene-state-${id}-${choice}`}
                    ariaPressed={active}
                    onActivate={() => patch('state', choice)}
                    style={{
                      layout: { padding: insets(6, 12) },
                      material: new SolidMaterial(
                        active ? colorToken('surfaceActive') : colorToken('surface'),
                      ),
                      border: {
                        width: 1,
                        color: active ? colorToken('accent') : colorToken('border'),
                      },
                      corners: corners(999, 'round'),
                    }}
                  >
                    <Text size={12} weight={active ? 600 : 500}>
                      {choice.replaceAll('_', ' ')}
                    </Text>
                  </Pressable>
                );
              })}
            </Row>
          </Stack>

          {visual.stateValue !== 'off' && (
            <>
              {visual.hasBrightness && (
                <HausSlider
                  label="Brightness"
                  value={visual.brightnessPct}
                  min={1}
                  max={100}
                  step={1}
                  valueLabel={`${visual.brightnessPct}%`}
                  onChange={(pctValue) => patch('brightness', Math.round(pctValue * 2.55))}
                />
              )}

              {visual.hasTemperature && (
                <Stack gapPx={4}>
                  <HausSlider
                    label="White temperature"
                    value={visual.kelvin}
                    min={visual.minKelvin}
                    max={visual.maxKelvin}
                    step={50}
                    valueLabel={`${visual.kelvin} K`}
                    onChange={(kelvin) => patch('color_temp_kelvin', kelvin)}
                  />
                  <Row justify="between">
                    <Text size={10.5} tone="muted">
                      Warm
                    </Text>
                    <Text size={10.5} tone="muted">
                      Cool
                    </Text>
                  </Row>
                </Stack>
              )}

              {visual.hasColor && (
                <Stack gapPx={6}>
                  <Text size={11.5} weight={600} tone="muted">
                    Colour
                  </Text>
                  <Row align="center" gapPx={8} wrap>
                    {SCENE_CURATED_SWATCHES.map((hex) => {
                      const rgb = hexToRgbTuple(hex);
                      const swatchColor = parseCssColor(hex);
                      if (!rgb || !swatchColor) return null;
                      return (
                        <Pressable
                          key={hex}
                          id={`scene-swatch-${id}-${hex.slice(1)}`}
                          ariaLabel={`Set colour ${hex}`}
                          onActivate={() => patch('rgb_color', rgb)}
                          style={{
                            layout: { width: px(26), height: px(26), flexShrink: 0 },
                            material: new SolidMaterial(swatchColor),
                            corners: corners(999, 'round'),
                            border: { width: 1.5, color: rgba(255, 255, 255, 0.35) },
                          }}
                        />
                      );
                    })}
                  </Row>
                </Stack>
              )}

              {visual.domain === 'climate' && (
                <HausSlider
                  label="Target temperature"
                  value={visual.temperature}
                  min={visual.minTemp}
                  max={visual.maxTemp}
                  step={visual.tempStep}
                  valueLabel={`${visual.temperature}°`}
                  onChange={(temp) => patch('temperature', temp)}
                />
              )}

              {visual.hasLevel && (
                <HausSlider
                  label={visual.levelLabel}
                  value={visual.levelPct}
                  min={0}
                  max={100}
                  step={1}
                  valueLabel={`${visual.levelPct}%`}
                  onChange={(nextPct) =>
                    patch(
                      visual.domain === 'cover'
                        ? 'current_position'
                        : visual.domain === 'fan'
                          ? 'percentage'
                          : 'volume_level',
                      visual.domain === 'media_player'
                        ? Number((nextPct / 100).toFixed(2))
                        : nextPct,
                    )
                  }
                />
              )}
            </>
          )}
        </Stack>
      )}

      <Row align="center" justify="between" gapPx={10} wrap>
        <HausButton
          variant="ghost"
          size="sm"
          onPress={() => {
            if (!showRawJson) {
              setRawJsonText(JSON.stringify(config, null, 2));
              setRawJsonError('');
            }
            setShowRawJson(!showRawJson);
          }}
        >
          <UiIcon name={showRawJson ? 'chevron-up' : 'chevron-down'} size={13} />
          <Text size={11.5}>{showRawJson ? 'Hide JSON' : 'Stored target JSON'}</Text>
        </HausButton>
        <HausButton id={`scene-remove-${id}`} variant="danger" size="sm" onPress={onRemove}>
          <UiIcon name="trash-2" size={13} />
          <Text size={11.5}>{removeLabel}</Text>
        </HausButton>
      </Row>

      {showRawJson && (
        <HausTextArea
          label="Stored target JSON"
          rows={4}
          value={rawJsonText}
          error={rawJsonError || undefined}
          onChange={(raw) => {
            setRawJsonText(raw);
            try {
              const parsed: unknown = JSON.parse(raw);
              setRawJsonError('');
              onChange(targetConfig(parsed));
            } catch (err) {
              setRawJsonError(err instanceof Error ? err.message : 'Invalid JSON');
            }
          }}
        />
      )}
    </Stack>
  );
}
