/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { colorToken, corners, insets, mixColor, pct, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { useHausUi } from '../../primitives/context.js';
import { resolveColorToCss } from '../../renderers/contract.js';
import {
  Box,
  Grid,
  HausButton,
  HausSwitch,
  Pressable,
  Row,
  Stack,
  Text,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';
import type { UiIconName } from '../icons.js';

function parseHexColor(hex: string) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  return m
    ? rgba(Number.parseInt(m[1], 16), Number.parseInt(m[2], 16), Number.parseInt(m[3], 16), 1)
    : colorToken('accent');
}

export interface LightGroupMemberItem {
  readonly id: string;
  readonly name: string;
  readonly state: string;
}

export function LightGroupPanel({
  members,
  disabled,
  onOpenMember,
  onSeparate,
}: {
  readonly members: readonly LightGroupMemberItem[];
  readonly disabled: boolean;
  readonly onOpenMember: (id: string) => void;
  readonly onSeparate: () => void;
}) {
  return (
    <Stack gapPx={10} style={{ layout: { width: pct(100) } }}>
      <Row justify="between" align="center" style={{ layout: { width: pct(100) } }}>
        <Row align="center" gapPx={6}>
          <UiIcon name="layers" size={14} />
          <Text size={12} weight={600}>
            Lights in this group ({members.length})
          </Text>
        </Row>
        <HausButton
          id="separate-light-group"
          size="sm"
          variant="secondary"
          disabled={disabled}
          onPress={onSeparate}
        >
          Show lights separately
        </HausButton>
      </Row>
      <Stack gapPx={6}>
        {members.map((member) => (
          <Pressable
            key={member.id}
            id={`light-member-${member.id}`}
            onActivate={() => onOpenMember(member.id)}
            style={{
              layout: {
                display: 'flex',
                direction: 'row',
                alignItems: 'center',
                justifyContent: 'between',
                width: pct(100),
                padding: insets(8, 12),
              },
              material: new SolidMaterial(colorToken('surface')),
              border: { width: 1, color: colorToken('border') },
              corners: corners(12),
              states: {
                hover: { material: new SolidMaterial(colorToken('surfaceHover')) },
              },
            }}
          >
            <Row align="center" gapPx={8} style={{ pointerEvents: 'none' }}>
              <UiIcon name="lightbulb" size={16} />
              <Stack gapPx={1}>
                <Text size={13} weight={600}>
                  {member.name}
                </Text>
                <Text size={11} tone="muted">
                  {member.state}
                </Text>
              </Stack>
            </Row>
            <UiIcon name="chevron-right" size={15} />
          </Pressable>
        ))}
      </Stack>
    </Stack>
  );
}

const REMOTE_ICON: Readonly<Record<string, UiIconName>> = {
  up: 'arrow-up',
  left: 'arrow-left',
  select: 'check',
  right: 'arrow-right',
  down: 'arrow-down',
  home: 'house',
  menu: 'corner-up-left',
  play_pause: 'play',
};

export function MediaRemotePanel({
  disabled,
  onCommand,
}: {
  readonly disabled: boolean;
  readonly onCommand: (command: string) => void;
}) {
  const btn = (command: string, label: string) => (
    <HausButton
      key={command}
      id={`remote-${command}`}
      size="sm"
      variant="secondary"
      aria-label={label}
      disabled={disabled}
      onPress={() => onCommand(command)}
    >
      <Row align="center" gapPx={5} style={{ pointerEvents: 'none' }}>
        <UiIcon name={REMOTE_ICON[command] ?? 'radio'} size={14} />
        <Text size={11}>{label}</Text>
      </Row>
    </HausButton>
  );

  return (
    <Stack
      gapPx={10}
      style={{
        layout: { width: pct(100), padding: insets(12) },
        material: new SolidMaterial(colorToken('surface')),
        border: { width: 1, color: colorToken('border') },
        corners: corners(14),
      }}
    >
      <Text size={12} weight={600}>
        Remote
      </Text>
      <Stack align="center" gapPx={6}>
        {btn('up', 'Up')}
        <Row justify="center" gapPx={8}>
          {btn('left', 'Left')}
          {btn('select', 'Select')}
          {btn('right', 'Right')}
        </Row>
        {btn('down', 'Down')}
      </Stack>
      <Row justify="center" gapPx={8} wrap>
        {btn('menu', 'Back')}
        {btn('home', 'Home')}
        {btn('play_pause', 'Play / Pause')}
      </Row>
    </Stack>
  );
}

export interface PortablePowerOutlet {
  readonly id: string;
  readonly label: string;
  readonly active: boolean;
  readonly available: boolean;
  readonly isMaster: boolean;
}

export function PowerStripPanel({
  outlets,
  disabled,
  onToggle,
}: {
  readonly outlets: readonly PortablePowerOutlet[];
  readonly disabled?: boolean;
  readonly onToggle: (id: string) => void;
}) {
  const { theme } = useHausUi();
  return (
    <Row
      semantic="section"
      ariaLabel="Individual outlets"
      wrap
      align="start"
      justify="center"
      style={{
        layout: { width: pct(100), rowGap: px(24), columnGap: px(18), padding: insets(14, 0) },
      }}
    >
      {outlets.map((outlet) => {
        const ink = colorToken(outlet.active ? 'textPrimary' : 'textMuted');
        const surface = colorToken('soft');
        const available = !disabled && outlet.available;
        return (
          <Stack
            key={outlet.id}
            align="center"
            gapPx={8}
            style={{ layout: { width: px(125), flexGrow: 1 } }}
          >
            <Pressable
              id={`outlet-${outlet.id}`}
              ariaLabel={`${outlet.active ? 'Turn off' : 'Turn on'} ${outlet.label}`}
              ariaPressed={outlet.active}
              disabled={!available}
              onActivate={() => onToggle(outlet.id)}
              style={{
                layout: {
                  width: px(90),
                  height: px(90),
                  alignItems: 'center',
                  justifyContent: 'center',
                },
                corners: corners(45, 'round'),
                border: { width: 0.5, color: colorToken('border') },
                material: new SolidMaterial(outlet.active ? mixColor(surface, ink, 0.12) : surface),
                opacity: available ? 1 : 0.55,
                transitionMs: 260,
                shadows: outlet.active
                  ? [
                      {
                        offsetX: 0,
                        offsetY: 1,
                        blurRadius: 1,
                        color: colorToken('ink', 0.12),
                        inset: true,
                      },
                      { offsetX: 0, offsetY: 0, blurRadius: 25, color: colorToken('ink', 0.04) },
                    ]
                  : undefined,
                states: available
                  ? {
                      pressed: { transform: { scale: 0.96 } },
                      hover: {
                        material: new SolidMaterial(
                          mixColor(surface, ink, outlet.active ? 0.17 : 0.08),
                        ),
                      },
                    }
                  : undefined,
              }}
            >
              <UiIcon
                name="power"
                size={32}
                strokeWidth={1.5}
                color={resolveColorToCss(ink, theme, false)}
              />
            </Pressable>
            <Text
              semantic="strong"
              size={12}
              weight={500}
              style={{ typography: { align: 'center' } }}
            >
              {outlet.label}
            </Text>
            <Text semantic="small" size={11} tone="muted">
              {!outlet.available ? 'No response' : outlet.active ? 'On' : 'Off'}
            </Text>
          </Stack>
        );
      })}
    </Row>
  );
}

export interface PortablePrinterSupply {
  readonly id: string;
  readonly label: string;
  readonly percentage?: number;
  readonly colorHex: string;
}

export function PrinterSuppliesPanel({
  supplies,
}: {
  readonly supplies: readonly PortablePrinterSupply[];
}) {
  if (supplies.length === 0) return null;
  return (
    <Stack gapPx={8} style={{ layout: { width: pct(100) } }}>
      <Row align="center" gapPx={6}>
        <UiIcon name="printer" size={14} />
        <Text size={12} weight={600}>
          Ink & Toner
        </Text>
      </Row>
      {supplies.map((item) => (
        <Stack key={item.id} gapPx={4} style={{ layout: { width: pct(100) } }}>
          <Row justify="between" style={{ layout: { width: pct(100) } }}>
            <Text size={12}>{item.label}</Text>
            <Text size={12} tone="muted" mono>
              {item.percentage !== undefined ? `${item.percentage}%` : '—'}
            </Text>
          </Row>
          <Box
            style={{
              layout: { width: pct(100), height: px(6), overflow: 'hidden' },
              material: new SolidMaterial(colorToken('surface')),
              corners: corners(3),
            }}
          >
            <Box
              style={{
                layout: {
                  width: pct(item.percentage ?? 0),
                  height: pct(100),
                },
                material: new SolidMaterial(parseHexColor(item.colorHex)),
                corners: corners(3),
              }}
            />
          </Box>
        </Stack>
      ))}
    </Stack>
  );
}

export interface NetworkControlAction {
  readonly id: string;
  readonly label: string;
  readonly kind: 'switch' | 'button';
  readonly active?: boolean;
  readonly disabled?: boolean;
}

export function NetworkDetailsPanel({
  statusLabel,
  healthy,
  metrics,
  actions,
  managementUrl,
  disabled,
  onToggleSwitch,
  onPressButton,
  onManage,
}: {
  readonly statusLabel: string;
  readonly healthy: boolean;
  readonly metrics: readonly { readonly label: string; readonly value: string }[];
  readonly actions: readonly NetworkControlAction[];
  readonly managementUrl?: string;
  readonly disabled: boolean;
  readonly onToggleSwitch: (id: string) => void;
  readonly onPressButton: (id: string) => void;
  readonly onManage?: (url: string) => void;
}) {
  return (
    <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
      <Row justify="between" align="center" style={{ layout: { width: pct(100) } }}>
        <Row align="center" gapPx={8}>
          <UiIcon name="router" size={16} />
          <Text size={13} weight={600}>
            {statusLabel}
          </Text>
        </Row>
        <Box
          style={{
            layout: { padding: insets(3, 8) },
            material: new SolidMaterial(
              healthy ? rgba(48, 209, 88, 0.16) : colorToken('surfaceHover'),
            ),
            corners: corners(8),
          }}
        >
          <Text size={11} tone={healthy ? 'primary' : 'muted'}>
            {healthy ? 'Connected' : statusLabel}
          </Text>
        </Box>
      </Row>

      {metrics.length > 0 && (
        <Grid columns={2} gapPx={8}>
          {metrics.map((metric) => (
            <Stack
              key={metric.label}
              gapPx={2}
              style={{
                layout: { padding: insets(8, 10) },
                material: new SolidMaterial(colorToken('surface')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(10),
              }}
            >
              <Text size={10} tone="muted">
                {metric.label}
              </Text>
              <Text size={13} weight={600} mono>
                {metric.value}
              </Text>
            </Stack>
          ))}
        </Grid>
      )}

      {actions.map((item) =>
        item.kind === 'switch' ? (
          <Row
            key={item.id}
            justify="between"
            align="center"
            style={{
              layout: { width: pct(100), padding: insets(8, 12) },
              material: new SolidMaterial(colorToken('surface')),
              border: { width: 1, color: colorToken('border') },
              corners: corners(10),
            }}
          >
            <Text size={12}>{item.label}</Text>
            <HausSwitch
              checked={Boolean(item.active)}
              disabled={disabled || item.disabled}
              onChange={() => onToggleSwitch(item.id)}
            />
          </Row>
        ) : (
          <HausButton
            key={item.id}
            variant="secondary"
            size="sm"
            disabled={disabled || item.disabled}
            onPress={() => onPressButton(item.id)}
          >
            {item.label}
          </HausButton>
        ),
      )}

      {managementUrl && onManage && (
        <HausButton variant="outline" size="sm" onPress={() => onManage(managementUrl)}>
          Open in browser
        </HausButton>
      )}
    </Stack>
  );
}
