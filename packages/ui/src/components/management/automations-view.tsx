/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { colorToken, corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  HausSwitch,
  Heading,
  Row,
  Stack,
  Text,
  useHausUi,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';

export interface PortableAutomationItem {
  readonly entityId: string;
  readonly ruleId: string;
  readonly name: string;
  readonly statusLabel: string;
  readonly enabled: boolean;
  readonly toggleDisabled: boolean;
  readonly canEdit: boolean;
  readonly needsCutover: boolean;
  readonly cuttingOver: boolean;
}

export function AutomationsListView({
  items,
  canCreate,
  canImportHa,
  error,
  onCreate,
  onImportHa,
  onEdit,
  onToggle,
  onCutover,
}: {
  readonly items: readonly PortableAutomationItem[];
  readonly canCreate: boolean;
  readonly canImportHa?: boolean;
  readonly error?: string;
  readonly onCreate: () => void;
  readonly onImportHa?: () => void;
  readonly onEdit: (entityId: string) => void;
  readonly onToggle: (entityId: string) => void;
  readonly onCutover: (item: PortableAutomationItem) => void;
}) {
  const { theme } = useHausUi();
  const primaryFg = theme.mode === 'dark' ? '#101010' : '#ffffff';

  return (
    <Stack gapPx={16} style={{ layout: { width: pct(100) } }}>
      <Row align="center" gapPx={10} wrap>
        <HausButton
          id="automations-create"
          variant="primary"
          size="sm"
          disabled={!canCreate}
          onPress={onCreate}
        >
          <UiIcon name="plus" size={14} color={primaryFg} />
          <Text size={12.5} style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}>
            Create automation
          </Text>
        </HausButton>
        {canImportHa && onImportHa && (
          <HausButton
            id="automations-import-ha"
            variant="ghost"
            size="sm"
            disabled={!canCreate}
            onPress={onImportHa}
          >
            <UiIcon name="file-up" size={14} />
            <Text size={12.5}>Import Home Assistant rules</Text>
          </HausButton>
        )}
      </Row>

      {error && (
        <Text role="alert" tone="critical" size={12.5}>
          {error}
        </Text>
      )}

      {items.length > 0 ? (
        <Stack gapPx={10} style={{ layout: { width: pct(100) } }}>
          {items.map((item) => (
            <Row
              key={item.entityId}
              id={`automation-row-${item.entityId}`}
              align="center"
              gapPx={14}
              wrap
              style={{
                layout: { width: pct(100), padding: insets(16, 18) },
                material: new SolidMaterial(colorToken('surfaceSecondary')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(14, 'superellipse', 1.4),
              }}
            >
              <Box
                style={{
                  layout: {
                    width: px(40),
                    height: px(40),
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  },
                  material: new SolidMaterial(colorToken('surface')),
                  corners: corners(11),
                }}
              >
                <UiIcon name="zap" size={20} color="#9a9a73" />
              </Box>
              <Stack gapPx={4} style={{ layout: { flexGrow: 1, minWidth: px(160) } }}>
                <Text size={13.5} weight={600}>
                  {item.name}
                </Text>
                <Text size={11} tone="muted">
                  {item.statusLabel}
                </Text>
              </Stack>
              <Row align="center" gapPx={8}>
                <HausButton
                  id={`automation-edit-${item.entityId}`}
                  variant="ghost"
                  size="sm"
                  disabled={!item.canEdit}
                  onPress={() => onEdit(item.entityId)}
                >
                  <Text size={12}>Edit</Text>
                </HausButton>
                {item.needsCutover && (
                  <HausButton
                    id={`automation-cutover-${item.entityId}`}
                    variant="ghost"
                    size="sm"
                    disabled={item.cuttingOver || !item.canEdit}
                    onPress={() => onCutover(item)}
                  >
                    <Text size={12}>
                      {item.cuttingOver ? 'Cutting over…' : 'I disabled the HA source'}
                    </Text>
                  </HausButton>
                )}
                <HausSwitch
                  id={`rule-${item.entityId}`}
                  aria-label={`Enable ${item.name}`}
                  checked={item.enabled}
                  disabled={item.toggleDisabled}
                  onChange={() => onToggle(item.entityId)}
                />
              </Row>
            </Row>
          ))}
        </Stack>
      ) : (
        <Stack
          align="center"
          gapPx={8}
          style={{
            layout: { width: pct(100), padding: insets(34, 20) },
            material: new SolidMaterial(colorToken('surfaceSecondary')),
            border: { width: 1, color: rgba(255, 255, 255, 0.08) },
            corners: corners(16),
          }}
        >
          <UiIcon name="zap" size={28} />
          <Heading level={3} size={16} weight={600}>
            Let home take care of it
          </Heading>
          <Text size={12.5} tone="muted">
            Create an automation to run your scenes and devices automatically.
          </Text>
        </Stack>
      )}
    </Stack>
  );
}
