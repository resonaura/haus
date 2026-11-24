/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import type { UiStyleSpec } from '../../ir/node.js';
import {
  HausButton,
  HausSelect,
  HausSlider,
  HausSwitch,
  Heading,
  Pressable,
  Row,
  Stack,
  Text,
  TextInput,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';
import type { UiIconName } from '../icons.js';

export const editorInputStyle: UiStyleSpec = {
  layout: { width: pct(100), minHeight: px(36), padding: insets(6, 10) },
  material: new SolidMaterial(colorToken('surface')),
  border: { width: 1, color: colorToken('border') },
  corners: corners(10),
  typography: { size: 13, color: colorToken('textPrimary') },
};

export interface PortableSceneAccessoryOption {
  readonly entityId: string;
  readonly name: string;
  readonly roomName: string;
  readonly hasBrightness: boolean;
}

export interface PortableAutomationBlock {
  readonly id: string;
  readonly type: string;
  readonly entityId: string;
  readonly stateOrTo: string;
  readonly at: string;
  readonly sunEvent: string;
  readonly service: string;
}

export interface PortableOptionItem {
  readonly value: string;
  readonly label: string;
}

export const SCENE_ICON_CHOICES: readonly {
  readonly id: string;
  readonly label: string;
  readonly icon: UiIconName;
}[] = [
  { id: 'mdi:sparkles', label: 'Mood', icon: 'sparkles' },
  { id: 'mdi:weather-night', label: 'Night', icon: 'moon-star' },
  { id: 'mdi:white-balance-sunny', label: 'Day', icon: 'sun' },
  { id: 'mdi:sofa', label: 'Relax', icon: 'armchair' },
  { id: 'mdi:movie-open', label: 'Movie', icon: 'clapperboard' },
  { id: 'mdi:book-open-variant', label: 'Read', icon: 'book-open' },
  { id: 'mdi:home', label: 'Home', icon: 'house' },
];

export function SceneVisualSection({
  icon,
  search,
  accessories,
  selectedTargets,
  onIconChange,
  onSearchChange,
  onToggleAccessory,
  onToggleTargetState,
  onChangeBrightness,
}: {
  readonly icon?: string;
  readonly search: string;
  readonly accessories: readonly PortableSceneAccessoryOption[];
  readonly selectedTargets: Readonly<Record<string, { readonly on: boolean; readonly brightness?: number }>>;
  readonly onIconChange: (icon: string) => void;
  readonly onSearchChange: (value: string) => void;
  readonly onToggleAccessory: (entityId: string) => void;
  readonly onToggleTargetState: (entityId: string, on: boolean) => void;
  readonly onChangeBrightness: (entityId: string, pctValue: number) => void;
}) {
  const needle = search.trim().toLowerCase();
  const filtered = needle
    ? accessories.filter(
        (item) =>
          item.name.toLowerCase().includes(needle) || item.roomName.toLowerCase().includes(needle),
      )
    : accessories;

  return (
    <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
      <Stack gapPx={6}>
        <Text size={12} weight={600} tone="muted">
          Icon
        </Text>
        <Row gapPx={6} wrap>
          {SCENE_ICON_CHOICES.map((choice) => {
            const active = icon === choice.id;
            return (
              <Pressable
                key={choice.id}
                ariaPressed={active}
                onActivate={() => onIconChange(choice.id)}
                style={{
                  layout: {
                    padding: insets(6, 10),
                    direction: 'row',
                    alignItems: 'center',
                    gap: px(6),
                  },
                  material: new SolidMaterial(
                    active ? colorToken('surfaceActive') : colorToken('surfaceSecondary'),
                  ),
                  border: { width: 1, color: active ? colorToken('accent') : colorToken('border') },
                  corners: corners(10),
                }}
              >
                <UiIcon name={choice.icon} size={14} />
                <Text size={11.5}>{choice.label}</Text>
              </Pressable>
            );
          })}
        </Row>
      </Stack>

      <Stack gapPx={8}>
        <Row align="center" justify="between" gapPx={10}>
          <Text size={12.5} weight={600}>
            {`Accessories (${Object.keys(selectedTargets).length})`}
          </Text>
        </Row>
        <TextInput
          id="config-editor-accessory-search"
          ariaLabel="Search accessories"
          placeholder="Filter accessories by name or room"
          value={search}
          onChange={onSearchChange}
          style={editorInputStyle}
        />
        <Stack gapPx={6} style={{ layout: { maxHeight: px(220), overflowY: 'scroll' } }}>
          {filtered.map((acc) => {
            const target = selectedTargets[acc.entityId];
            const included = Boolean(target);
            return (
              <Stack
                key={acc.entityId}
                gapPx={8}
                style={{
                  layout: { width: pct(100), padding: insets(10, 12) },
                  material: new SolidMaterial(
                    included ? colorToken('surfaceActive') : colorToken('surfaceSecondary'),
                  ),
                  border: { width: 1, color: included ? colorToken('accent') : colorToken('border') },
                  corners: corners(12),
                }}
              >
                <Row align="center" justify="between" gapPx={10}>
                  <Pressable
                    id={`scene-target-toggle-${acc.entityId}`}
                    ariaPressed={included}
                    onActivate={() => onToggleAccessory(acc.entityId)}
                    style={{
                      layout: {
                        flexGrow: 1,
                        minWidth: px(0),
                        direction: 'row',
                        alignItems: 'center',
                        gap: px(8),
                      },
                    }}
                  >
                    <UiIcon name={included ? 'check' : 'plus'} size={15} />
                    <Stack gapPx={1} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                      <Text size={12.5} weight={600}>
                        {acc.name}
                      </Text>
                      <Text size={11} tone="muted">
                        {acc.roomName}
                      </Text>
                    </Stack>
                  </Pressable>
                  {target && (
                    <HausSwitch
                      aria-label={`${acc.name} target power`}
                      checked={target.on}
                      size="sm"
                      onChange={(next) => onToggleTargetState(acc.entityId, next)}
                    />
                  )}
                </Row>
                {target && target.on && acc.hasBrightness && (
                  <HausSlider
                    label="Brightness"
                    value={target.brightness ?? 100}
                    min={1}
                    max={100}
                    step={1}
                    valueLabel={`${target.brightness ?? 100}%`}
                    onChange={(next) => onChangeBrightness(acc.entityId, next)}
                  />
                )}
              </Stack>
            );
          })}
        </Stack>
      </Stack>
    </Stack>
  );
}

export function AutomationBlockList({
  kind,
  blocks,
  entityOptions,
  serviceOptions,
  onAdd,
  onRemove,
  onUpdate,
}: {
  readonly kind: 'triggers' | 'conditions' | 'actions';
  readonly blocks: readonly PortableAutomationBlock[];
  readonly entityOptions: readonly PortableOptionItem[];
  readonly serviceOptions: readonly PortableOptionItem[];
  readonly onAdd: () => void;
  readonly onRemove: (index: number) => void;
  readonly onUpdate: (index: number, next: PortableAutomationBlock) => void;
}) {
  const heading = kind === 'triggers' ? 'When' : kind === 'conditions' ? 'Only if' : 'Then';
  const addLabel =
    kind === 'triggers' ? '+ Add trigger' : kind === 'conditions' ? '+ Add condition' : '+ Add action';
  const typeOptions =
    kind === 'triggers'
      ? [
          { value: 'state', label: 'State change' },
          { value: 'time', label: 'Time' },
          { value: 'sun', label: 'Sun event' },
        ]
      : [{ value: 'state', label: 'State' }];

  return (
    <Stack gapPx={8} style={{ layout: { width: pct(100) } }}>
      <Row align="center" justify="between" gapPx={8}>
        <Heading level={3} size={13.5} weight={600}>
          {heading}
        </Heading>
        <HausButton id={`automation-add-${kind}`} variant="ghost" size="sm" onPress={onAdd}>
          <Text size={12}>{addLabel}</Text>
        </HausButton>
      </Row>
      {blocks.map((block, index) => (
        <Stack
          key={block.id}
          gapPx={8}
          style={{
            layout: { width: pct(100), padding: insets(12) },
            material: new SolidMaterial(colorToken('surfaceSecondary')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(12),
          }}
        >
          <Row align="center" justify="between" gapPx={8}>
            <Text size={11.5} weight={600} tone="muted">
              {`#${index + 1}`}
            </Text>
            <HausButton variant="ghost" size="sm" onPress={() => onRemove(index)}>
              <Text size={11.5}>Remove</Text>
            </HausButton>
          </Row>
          {kind !== 'actions' ? (
            <>
              <HausSelect
                aria-label={`${heading} type`}
                value={block.type}
                options={typeOptions}
                onChange={(type) => onUpdate(index, { ...block, type })}
              />
              {block.type === 'time' ? (
                <TextInput
                  ariaLabel="Time"
                  placeholder="08:00:00"
                  value={block.at}
                  onChange={(at) => onUpdate(index, { ...block, at })}
                  style={editorInputStyle}
                />
              ) : block.type === 'sun' ? (
                <HausSelect
                  aria-label="Sun event"
                  value={block.sunEvent}
                  options={[
                    { value: 'sunrise', label: 'Sunrise' },
                    { value: 'sunset', label: 'Sunset' },
                  ]}
                  onChange={(sunEvent) => onUpdate(index, { ...block, sunEvent })}
                />
              ) : (
                <Row gapPx={8} wrap>
                  <HausSelect
                    aria-label="Entity"
                    value={block.entityId}
                    options={entityOptions}
                    onChange={(entityId) => onUpdate(index, { ...block, entityId })}
                  />
                  <TextInput
                    ariaLabel="Target state"
                    placeholder="on"
                    value={block.stateOrTo}
                    onChange={(stateOrTo) => onUpdate(index, { ...block, stateOrTo })}
                    style={editorInputStyle}
                  />
                </Row>
              )}
            </>
          ) : (
            <Stack gapPx={8}>
              <HausSelect
                aria-label="Action service"
                value={block.service}
                options={serviceOptions}
                onChange={(service) => onUpdate(index, { ...block, service })}
              />
              <HausSelect
                aria-label="Target entity"
                value={block.entityId}
                options={entityOptions}
                onChange={(entityId) => onUpdate(index, { ...block, entityId })}
              />
            </Stack>
          )}
        </Stack>
      ))}
    </Stack>
  );
}
