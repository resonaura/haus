/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useMemo, useState } from 'react';
import { AUTOMATION_STARTER_TEMPLATES } from '@haus/core/transport';
import {
  colorToken,
  corners,
  insets,
  mixColor,
  pct,
  px,
  transparentColor,
} from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  Heading,
  Pressable,
  Row,
  Stack,
  Text,
  TextInput,
  useHausUi,
} from '../../primitives/index.js';
import { GlassRim } from '../../primitives/glass-rim.js';
import { DashboardGrid } from '../home.js';
import { UiIcon } from '../icon.js';
import {
  AutomationTile,
  StarterAutomationTile,
  type PortableAutomationItem,
} from './automation-tile.js';
import { automationPillStyle } from './theme.js';

export type { PortableAutomationItem } from './automation-tile.js';

export function AutomationsGalleryView({
  items,
  canCreate,
  canImportHa,
  columns = 3,
  error,
  resolveEntityName,
  onCreate,
  onCreateFromTemplate,
  onImportHa,
  onEdit,
  onToggle,
  onRun,
  onCutover,
}: {
  readonly items: readonly PortableAutomationItem[];
  readonly canCreate: boolean;
  readonly canImportHa?: boolean;
  readonly columns?: number;
  readonly error?: string;
  readonly resolveEntityName?: (entityId: string) => string;
  readonly onCreate: () => void;
  readonly onCreateFromTemplate?: (templateId: string) => void;
  readonly onImportHa?: () => void;
  readonly onEdit: (entityId: string) => void;
  readonly onToggle: (entityId: string) => void;
  readonly onRun?: (entityId: string) => void;
  readonly onCutover: (item: PortableAutomationItem) => void;
}) {
  const { theme } = useHausUi();
  const dark = theme.mode === 'dark';
  const primaryFg = dark ? '#101010' : '#ffffff';
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'paused'>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === 'active' && !item.enabled) return false;
      if (filter === 'paused' && item.enabled) return false;
      if (!q) return true;
      return `${item.name} ${item.statusLabel}`.toLowerCase().includes(q);
    });
  }, [filter, items, query]);

  return (
    <Stack gapPx={20} style={{ layout: { width: pct(100) } }}>
      <Row
        align="center"
        justify="between"
        gapPx={16}
        wrap
        dataAttrs={{ 'data-haus-glass-rim': 'managed' }}
        style={{
          layout: { width: pct(100), padding: insets(20), position: 'relative', overflow: 'hidden' },
          material: new SolidMaterial(colorToken('surfaceSecondary')),
          border: { width: 1, color: colorToken('border') },
          corners: corners(22, 'superellipse', 1.4),
        }}
      >
        <Row align="center" gapPx={16} style={{ layout: { flexGrow: 1, minWidth: px(240), zIndex: 1 } }}>
          <Box
            style={{
              layout: {
                width: px(44),
                height: px(44),
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              },
              material: new SolidMaterial(
                mixColor(transparentColor, colorToken('ink'), dark ? 0.1 : 0.07),
              ),
              corners: corners(999, 'round'),
            }}
          >
            <UiIcon name="zap" size={20} color={dark ? '#f4f4f5' : '#18181b'} />
          </Box>
          <Stack gapPx={3} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
            <Text size={15} weight={600}>
              Automations for a thoughtful home
            </Text>
            <Text size={11.5} tone="muted" style={{ typography: { lineHeight: 1.5 } }}>
              Connect switches, events, schedules, and accessories visually — or start from a template.
            </Text>
          </Stack>
        </Row>

        <Row align="center" gapPx={8} wrap style={{ layout: { zIndex: 1 } }}>
          {canImportHa && onImportHa && (
            <HausButton
              id="automations-import-ha"
              variant="secondary"
              size="sm"
              disabled={!canCreate}
              onPress={onImportHa}
            >
              <UiIcon name="file-up" size={14} />
              <Text size={12}>Import Home Assistant rules</Text>
            </HausButton>
          )}
          <HausButton
            id="automations-create"
            variant="primary"
            size="sm"
            disabled={!canCreate}
            onPress={onCreate}
          >
            <UiIcon name="plus" size={14} color={primaryFg} />
            <Text
              size={12.5}
              style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
            >
              Create automation
            </Text>
          </HausButton>
        </Row>
        <GlassRim preset="card" variant="card" opacity={0.48} />
      </Row>

      {canCreate && onCreateFromTemplate && (
        <Stack gapPx={10} style={{ layout: { width: pct(100) } }}>
          <Row align="center" justify="between">
            <Text size={11} weight={700} tone="muted">
              STARTER AUTOMATIONS
            </Text>
          </Row>
          <Row gapPx={10} wrap style={{ layout: { width: pct(100) } }}>
            {AUTOMATION_STARTER_TEMPLATES.map((tpl) => (
              <StarterAutomationTile
                key={tpl.id}
                template={tpl}
                onSelect={() => onCreateFromTemplate(tpl.id)}
              />
            ))}
          </Row>
        </Stack>
      )}

      {items.length > 0 && (
        <Row align="center" justify="between" gapPx={10} wrap style={{ layout: { width: pct(100) } }}>
          <Row
            align="center"
            gapPx={8}
            style={{
              layout: { flexGrow: 1, minWidth: px(200), minHeight: px(36), padding: insets(0, 12) },
              material: new SolidMaterial(colorToken('surfaceSecondary')),
              border: { width: 1, color: colorToken('border') },
              corners: corners(11),
            }}
          >
            <UiIcon name="search" size={15} />
            <TextInput
              id="automations-search"
              ariaLabel="Search automations"
              placeholder="Find an automation…"
              value={query}
              onChange={setQuery}
              style={{
                layout: { flexGrow: 1, minWidth: px(0), height: px(34) },
                typography: { size: 12.5, color: colorToken('textPrimary') },
              }}
            />
          </Row>

          <Row gapPx={6}>
            {(
              [
                ['all', `All (${items.length})`],
                ['active', `Active (${items.filter((i) => i.enabled).length})`],
                ['paused', `Paused (${items.filter((i) => !i.enabled).length})`],
              ] as const
            ).map(([key, label]) => {
              const active = filter === key;
              return (
                <Pressable
                  key={key}
                  ariaPressed={active}
                  onActivate={() => setFilter(key)}
                  style={automationPillStyle({
                    active,
                    padding: insets(6, 12),
                    restToken: 'surfaceSecondary',
                  })}
                >
                  <Text size={11.5} weight={active ? 600 : 500}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </Row>
        </Row>
      )}

      {error && (
        <Text role="alert" tone="critical" size={12.5}>
          {error}
        </Text>
      )}

      {filtered.length > 0 ? (
        <DashboardGrid columns={columns}>
          {filtered.map((item) => (
            <AutomationTile
              key={item.entityId}
              item={item}
              resolveEntityName={resolveEntityName}
              onEdit={onEdit}
              onToggle={onToggle}
              onRun={onRun}
              onCutover={onCutover}
            />
          ))}
        </DashboardGrid>
      ) : (
        <Stack
          align="center"
          gapPx={8}
          dataAttrs={{ 'data-haus-glass-rim': 'managed' }}
          style={{
            layout: { width: pct(100), padding: insets(34, 20), position: 'relative', overflow: 'hidden' },
            material: new SolidMaterial(colorToken('surfaceSecondary')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(22, 'superellipse', 1.4),
          }}
        >
          <UiIcon name="zap" size={26} />
          <Heading level={3} size={16} weight={600}>
            {items.length > 0 ? 'No automations match' : 'Let home take care of it'}
          </Heading>
          <Text size={12.5} tone="muted">
            {items.length > 0
              ? 'Try another search term or status filter.'
              : 'Pick a starter template above or create a custom automation in seconds.'}
          </Text>
          <GlassRim preset="card" variant="card" opacity={0.48} />
        </Stack>
      )}
    </Stack>
  );
}
