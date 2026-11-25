/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import type { LightEffectOption } from '@haus/core/device';
import { colorToken, corners, insets, pct, px, rgba, type ColorValue } from '../../ir/geometry.js';
import { GradientMaterial, SolidMaterial } from '../../ir/materials.js';
import { Box, HausButton, Pressable, Row, Stack, Text, TextInput } from '../../primitives/index.js';
import { UiIcon } from '../icon.js';

const compactLimit = 8;

function effectColor(value: string): ColorValue {
  if (!/^#[\da-f]{6}$/i.test(value)) return colorToken('accent');
  return rgba(
    parseInt(value.slice(1, 3), 16),
    parseInt(value.slice(3, 5), 16),
    parseInt(value.slice(5), 16),
    0.52,
  );
}

export function LightEffectsPanel({
  idPrefix,
  options,
  active,
  stop,
  disabled,
  onSelect,
}: {
  readonly idPrefix?: string;
  readonly options: readonly LightEffectOption[];
  readonly active?: string;
  readonly stop?: string;
  readonly disabled: boolean;
  readonly onSelect: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const dynamic = options.filter((option) => !option.isStatic);
  if (!dynamic.length) return null;
  const activeOption = dynamic.find((option) => option.value === active);
  const compact = dynamic.slice(0, compactLimit);
  const term = query.trim().toLocaleLowerCase();
  const visible = expanded
    ? dynamic.filter(({ label, value, id }) =>
        [label, value, id].some((text) => text.toLocaleLowerCase().includes(term)),
      )
    : activeOption && !compact.includes(activeOption)
      ? [activeOption, ...compact.slice(0, compactLimit - 1)]
      : compact;
  const hasOverflow = dynamic.length > compactLimit;

  return (
    <Stack semantic="section" ariaLabel="Light effects" gapPx={9}>
      <Row gapPx={8} wrap>
        <Text size={12} weight={600}>
          Effects
        </Text>
        {activeOption && (
          <Row gapPx={5}>
            <UiIcon name={activeOption.icon} size={12} />
            <Text size={11} tone="secondary">
              {activeOption.label}
            </Text>
          </Row>
        )}
        {active && stop && (
          <HausButton size="sm" variant="ghost" disabled={disabled} onPress={() => onSelect(stop)}>
            Stop
          </HausButton>
        )}
      </Row>
      {expanded && hasOverflow && (
        <Row gapPx={8}>
          <UiIcon name="search" size={13} />
          <TextInput
            value={query}
            placeholder="Filter effects…"
            ariaLabel="Filter light effects"
            onChange={setQuery}
            style={{ layout: { minHeight: px(30), flexGrow: 1, padding: insets(5, 8) } }}
          />
          {query && (
            <Pressable ariaLabel="Clear effect filter" onActivate={() => setQuery('')}>
              <UiIcon name="x" size={13} />
            </Pressable>
          )}
        </Row>
      )}
      <Row role="group" ariaLabel="Available light effects" gapPx={6} wrap>
        {visible.map((option) => {
          const selected = option.value === active;
          return (
            <Pressable
              key={option.value}
              id={idPrefix ? `${idPrefix}-effect-${option.value}` : undefined}
              ariaPressed={selected}
              disabled={disabled}
              onActivate={() => onSelect(selected && stop ? stop : option.value)}
              style={{
                layout: {
                  position: 'relative',
                  direction: 'row',
                  alignItems: 'center',
                  gap: px(6),
                  padding: insets(6, 10),
                },
                corners: corners(12),
                material: new SolidMaterial(colorToken('surface')),
                border: { width: 1, color: colorToken(selected ? 'border' : 'borderSubtle') },
                opacity: disabled ? 0.55 : 1,
              }}
            >
              <Box
                ariaHidden
                style={{
                  layout: {
                    position: 'absolute',
                    inset: insets(0),
                    width: pct(100),
                    height: pct(100),
                  },
                  corners: corners(11),
                  pointerEvents: 'none',
                  opacity: selected ? 1 : 0.22,
                  transitionMs: 260,
                  material: new GradientMaterial(
                    option.palette.map((color, index) => ({
                      color: effectColor(color),
                      offset: index / 2,
                    })),
                  ),
                }}
              />
              <UiIcon name={option.icon} size={13} />
              <Text size={11} weight={selected ? 600 : 500}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
        {expanded && !visible.length && (
          <Text tone="muted" size={11}>
            No effects match “{query.trim()}”.
          </Text>
        )}
      </Row>
      {hasOverflow && (
        <HausButton
          size="sm"
          variant="ghost"
          aria-expanded={expanded}
          onPress={() => {
            setExpanded(!expanded);
            if (expanded) setQuery('');
          }}
        >
          {expanded ? 'Show fewer effects' : `All effects (${dynamic.length})`}
        </HausButton>
      )}
    </Stack>
  );
}
