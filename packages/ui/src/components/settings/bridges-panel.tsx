/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import type { BridgeSuggestion } from '@haus/core/transport';
import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  Divider,
  HausButton,
  Heading,
  Pressable,
  Row,
  Stack,
  Text,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';

export interface BridgeSuggestionsPanelProps {
  readonly status: 'loading' | 'loaded' | 'failed';
  readonly suggestions: readonly BridgeSuggestion[];
  readonly onRetry?: () => void;
}

const cardStyle = {
  layout: { width: pct(100), padding: insets(20), gap: px(12) },
  material: new SolidMaterial(colorToken('card')),
  border: { width: 1, color: colorToken('border') },
  corners: corners(24),
};

const iconBadgeStyle = {
  layout: {
    width: px(42),
    height: px(42),
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    flexShrink: 0,
  },
  material: new SolidMaterial(colorToken('surfaceSecondary')),
  border: { width: 1, color: colorToken('borderSubtle') },
  corners: corners(14),
};

const disclosureTriggerStyle = {
  layout: {
    direction: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'between' as const,
    width: pct(100),
    padding: insets(10, 12),
    gap: px(10),
  },
  material: new SolidMaterial(colorToken('surfaceSecondary')),
  border: { width: 1, color: colorToken('borderSubtle') },
  corners: corners(12),
  states: { hover: { material: new SolidMaterial(colorToken('surfaceHover')) } },
};

export function BridgeSuggestionsPanel({
  status,
  suggestions,
  onRetry,
}: BridgeSuggestionsPanelProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const toggleGroup = (name: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  return (
    <Stack style={cardStyle} gapPx={14}>
      <Row gapPx={14} align="center">
        <Box style={iconBadgeStyle}>
          <UiIcon name="house" size={21} />
        </Box>
        <Stack gapPx={2}>
          <Heading id="apple-home-settings" level={2} size={17}>
            Apple Home
          </Heading>
          <Text size={12} tone="muted">
            Suggested bridges
          </Text>
        </Stack>
      </Row>
      <Divider />
      {status === 'loading' && (
        <Text size={12.5} tone="muted">
          Loading suggested bridges…
        </Text>
      )}
      {status === 'failed' && (
        <Row justify="between" align="center" gapPx={12} wrap>
          <Text size={12.5} tone="critical">
            Couldn’t load bridge suggestions.
          </Text>
          {onRetry && (
            <HausButton id="apple-home-bridges-retry" variant="outline" size="sm" onPress={onRetry}>
              Retry
            </HausButton>
          )}
        </Row>
      )}
      {status === 'loaded' && suggestions.length === 0 && (
        <Text size={12.5} tone="muted">
          No groups of compatible devices yet.
        </Text>
      )}
      {status === 'loaded' && suggestions.length > 0 && (
        <Stack gapPx={8} style={{ layout: { width: pct(100) } }}>
          {suggestions.map((group, index) => {
            const isOpen = expanded.has(group.name);
            return (
              <Stack key={group.name} gapPx={6} style={{ layout: { width: pct(100) } }}>
                <Pressable
                  id={`apple-home-bridge-${index}`}
                  ariaExpanded={isOpen}
                  style={disclosureTriggerStyle}
                  onActivate={() => toggleGroup(group.name)}
                >
                  <Text size={13} weight={600}>
                    {`${group.name} · ${group.devices.length} accessories`}
                  </Text>
                  <UiIcon name={isOpen ? 'chevron-down' : 'chevron-right'} size={15} />
                </Pressable>
                {isOpen && (
                  <Stack
                    gapPx={6}
                    style={{
                      layout: {
                        width: pct(100),
                        padding: insets(8, 14, 10, 14),
                      },
                      material: new SolidMaterial(colorToken('surface')),
                      border: { width: 1, color: colorToken('borderSubtle') },
                      corners: corners(10),
                    }}
                  >
                    {group.devices.map((device) => (
                      <Text key={device.id} size={12.5} tone="secondary">
                        {device.name}
                      </Text>
                    ))}
                  </Stack>
                )}
              </Stack>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
