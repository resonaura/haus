/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { InventoryDeviceStatus, InventoryFilterId } from '@haus/core/transport';
import { colorToken, corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  HausSelect,
  Heading,
  Pressable,
  Row,
  Stack,
  Text,
  TextInput,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';
import { DEVICE_ICONS, type UiIconName } from '../icons.js';

export interface PortableInventoryRowItem {
  readonly id: string;
  readonly hausId: string;
  readonly name: string;
  readonly detail: string;
  readonly roomName: string;
  readonly category: string;
  readonly status: InventoryDeviceStatus;
  readonly statusLabel: string;
  readonly activeEntityCount: number;
  readonly entityCount: number;
  readonly selected: boolean;
}

export interface PortableInventoryFilterTab {
  readonly id: InventoryFilterId;
  readonly label: string;
  readonly count: number;
}

const isDeviceCategory = (value: string): value is keyof typeof DEVICE_ICONS =>
  Object.hasOwn(DEVICE_ICONS, value);

function categoryIcon(category: string): UiIconName {
  return isDeviceCategory(category) ? DEVICE_ICONS[category] : 'layout-grid';
}

function statusColors(status: InventoryDeviceStatus) {
  if (status === 'available') {
    return { dot: rgba(52, 211, 153, 1), bg: rgba(52, 211, 153, 0.12), border: rgba(52, 211, 153, 0.28) };
  }
  if (status === 'unavailable' || status === 'unknown') {
    return { dot: rgba(251, 191, 36, 1), bg: rgba(251, 191, 36, 0.12), border: rgba(251, 191, 36, 0.28) };
  }
  return { dot: colorToken('textMuted'), bg: colorToken('surface'), border: colorToken('border') };
}

export function DeviceInventoryView({
  totalCount,
  liveEntityCount,
  query,
  area,
  areaOptions,
  filters,
  activeFilter,
  items,
  canManage,
  selecting,
  selectedCount,
  onQueryChange,
  onAreaChange,
  onFilterChange,
  onToggleSelecting,
  onSelectAll,
  onMoveSelected,
  onToggleItem,
  onOpenItem,
  onManageItem,
  onClearFilters,
  onAddDevice,
}: {
  readonly totalCount: number;
  readonly liveEntityCount: number;
  readonly query: string;
  readonly area: string;
  readonly areaOptions: readonly { readonly value: string; readonly label: string }[];
  readonly filters: readonly PortableInventoryFilterTab[];
  readonly activeFilter: InventoryFilterId;
  readonly items: readonly PortableInventoryRowItem[];
  readonly canManage: boolean;
  readonly selecting: boolean;
  readonly selectedCount: number;
  readonly onQueryChange: (value: string) => void;
  readonly onAreaChange: (value: string) => void;
  readonly onFilterChange: (id: InventoryFilterId) => void;
  readonly onToggleSelecting: () => void;
  readonly onSelectAll: () => void;
  readonly onMoveSelected: () => void;
  readonly onToggleItem: (id: string) => void;
  readonly onOpenItem: (id: string) => void;
  readonly onManageItem: (id: string) => void;
  readonly onClearFilters: () => void;
  readonly onAddDevice?: () => void;
}) {
  return (
    <Stack gapPx={16} style={{ layout: { width: pct(100) } }}>
      <Row align="center" justify="between" gapPx={16} wrap style={{ layout: { width: pct(100) } }}>
        <Row align="center" gapPx={20} wrap>
          <Row align="center" gapPx={8}>
            <UiIcon name="server" size={18} />
            <Text size={18} weight={600}>
              {String(totalCount)}
            </Text>
            <Text size={12} tone="muted">
              registered devices
            </Text>
          </Row>
          <Row align="center" gapPx={8}>
            <UiIcon name="radio" size={17} />
            <Text size={18} weight={600}>
              {String(liveEntityCount)}
            </Text>
            <Text size={12} tone="muted">
              live entities
            </Text>
          </Row>
        </Row>
        <Text size={11} tone="muted">
          Includes hidden, disabled and diagnostic devices
        </Text>
      </Row>

      <Row align="center" gapPx={10} wrap style={{ layout: { width: pct(100) } }}>
        <Row
          align="center"
          gapPx={8}
          style={{
            layout: { flexGrow: 1, minWidth: px(200), minHeight: px(38), padding: insets(0, 12) },
            material: new SolidMaterial(colorToken('surfaceSecondary')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(12),
          }}
        >
          <UiIcon name="search" size={16} />
          <TextInput
            id="inventory-search"
            ariaLabel="Search all devices"
            placeholder="Search name, brand or model"
            value={query}
            onChange={onQueryChange}
            style={{
              layout: { flexGrow: 1, minWidth: px(0), height: px(34) },
              typography: { size: 13, color: colorToken('textPrimary') },
            }}
          />
          {query && (
            <Pressable
              id="inventory-clear-search"
              ariaLabel="Clear device search"
              onActivate={() => onQueryChange('')}
            >
              <UiIcon name="x" size={15} />
            </Pressable>
          )}
        </Row>
        <Box style={{ layout: { width: px(185), flexShrink: 0 } }}>
          <HausSelect
            id="inventory-room-filter"
            aria-label="Filter devices by room"
            value={area}
            options={areaOptions}
            onChange={onAreaChange}
          />
        </Box>
      </Row>

      {canManage && (
        <Row align="center" gapPx={10} wrap>
          <HausButton id="inventory-toggle-select" variant="ghost" size="sm" onPress={onToggleSelecting}>
            <UiIcon name="check-square" size={15} />
            <Text size={12.5}>{selecting ? 'Cancel selection' : 'Select devices'}</Text>
          </HausButton>
          {selecting && (
            <>
              <HausButton
                id="inventory-select-all"
                variant="ghost"
                size="sm"
                disabled={!items.length}
                onPress={onSelectAll}
              >
                <Text size={12.5}>Select all shown</Text>
              </HausButton>
              <Text size={12} tone="muted">
                {`${selectedCount} selected`}
              </Text>
              <HausButton
                id="inventory-move-selected"
                variant="secondary"
                size="sm"
                disabled={selectedCount === 0}
                onPress={onMoveSelected}
              >
                <UiIcon name="move-right" size={15} />
                <Text size={12.5}>Move to room</Text>
              </HausButton>
            </>
          )}
        </Row>
      )}

      <Row gapPx={8} wrap>
        {filters.map((tab) => {
          const active = activeFilter === tab.id;
          return (
            <Pressable
              key={tab.id}
              id={`inventory-filter-${tab.id}`}
              ariaPressed={active}
              onActivate={() => onFilterChange(tab.id)}
              style={{
                layout: {
                  direction: 'row',
                  alignItems: 'center',
                  gap: px(7),
                  padding: insets(6, 12),
                },
                material: new SolidMaterial(
                  active ? colorToken('surfaceActive') : colorToken('surfaceSecondary'),
                ),
                border: { width: 1, color: active ? colorToken('accent') : colorToken('border') },
                corners: corners(999),
              }}
            >
              <Text size={12} weight={active ? 600 : 500} tone={active ? 'primary' : 'muted'}>
                {tab.label}
              </Text>
              <Text size={11} tone="muted">
                {String(tab.count)}
              </Text>
            </Pressable>
          );
        })}
      </Row>

      <Stack
        gapPx={0}
        style={{
          layout: { width: pct(100), overflow: 'hidden' },
          material: new SolidMaterial(colorToken('surfaceSecondary')),
          border: { width: 1, color: colorToken('border') },
          corners: corners(15),
        }}
      >
        <Row
          align="center"
          gapPx={14}
          style={{
            layout: { width: pct(100), padding: insets(10, 16) },
            material: new SolidMaterial(colorToken('surface')),
          }}
        >
          <Text size={9.5} weight={600} tone="muted" style={{ layout: { flexGrow: 2.3, flexShrink: 1, width: px(0) } }}>
            DEVICE
          </Text>
          <Text size={9.5} weight={600} tone="muted" style={{ layout: { flexGrow: 1, flexShrink: 1, width: px(0) } }}>
            ROOM
          </Text>
          <Text size={9.5} weight={600} tone="muted" style={{ layout: { flexGrow: 1.15, flexShrink: 1, width: px(0) } }}>
            DATA STATUS
          </Text>
          <Text size={9.5} weight={600} tone="muted" style={{ layout: { width: px(64), flexShrink: 0 } }}>
            ENTITIES
          </Text>
          <Box style={{ layout: { width: px(32), flexShrink: 0 } }} />
        </Row>

        {items.map((item) => {
          const pill = statusColors(item.status);
          return (
            <Row
              key={item.id}
              id={`inventory-row-${item.id}`}
              align="center"
              gapPx={14}
              style={{
                layout: { width: pct(100), minHeight: px(72), padding: insets(12, 16) },
                material: new SolidMaterial(
                  item.selected ? colorToken('surfaceActive') : rgba(0, 0, 0, 0),
                ),
                border: { width: 1, color: colorToken('borderSubtle') },
              }}
            >
              <Pressable
                id={`inventory-open-${item.id}`}
                onActivate={() => (selecting ? onToggleItem(item.id) : onOpenItem(item.id))}
                style={{
                  layout: {
                    flexGrow: 2.3,
                    flexShrink: 1,
                    width: px(0),
                    minWidth: px(0),
                    direction: 'row',
                    alignItems: 'center',
                    gap: px(12),
                  },
                }}
              >
                {selecting && (
                  <Box
                    style={{
                      layout: { width: px(18), height: px(18), alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
                      material: new SolidMaterial(item.selected ? colorToken('accent') : colorToken('surface')),
                      border: { width: 1, color: item.selected ? colorToken('accent') : colorToken('border') },
                      corners: corners(5),
                    }}
                  >
                    {item.selected && <UiIcon name="check" size={12} color="#101010" />}
                  </Box>
                )}
                <Box
                  style={{
                    layout: { width: px(36), height: px(36), alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
                    material: new SolidMaterial(colorToken('surface')),
                    corners: corners(10),
                  }}
                >
                  <UiIcon name={categoryIcon(item.category)} size={19} />
                </Box>
                <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                  <Text size={13} weight={600} style={{ typography: { maxLines: 1 } }}>
                    {item.name}
                  </Text>
                  <Text size={10.5} tone="muted" style={{ typography: { maxLines: 1 } }}>
                    {item.detail || 'Connected device'}
                  </Text>
                  <Text size={10} mono tone="muted" style={{ typography: { maxLines: 1 } }}>
                    {item.hausId}
                  </Text>
                </Stack>
              </Pressable>

              <Text size={12} tone="muted" style={{ layout: { flexGrow: 1, flexShrink: 1, width: px(0) }, typography: { maxLines: 1 } }}>
                {item.roomName}
              </Text>

              <Box style={{ layout: { flexGrow: 1.15, flexShrink: 1, width: px(0), alignItems: 'start' } }}>
                <Row
                  align="center"
                  gapPx={6}
                  style={{
                    layout: { padding: insets(3, 8) },
                    material: new SolidMaterial(pill.bg),
                    border: { width: 1, color: pill.border },
                    corners: corners(999),
                  }}
                >
                  <Box style={{ layout: { width: px(6), height: px(6) }, material: new SolidMaterial(pill.dot), corners: corners(999) }} />
                  <Text size={10.5} weight={500}>
                    {item.statusLabel}
                  </Text>
                </Row>
              </Box>

              <Text size={12} mono tone="muted" style={{ layout: { width: px(64), flexShrink: 0 } }}>
                {`${item.activeEntityCount} / ${item.entityCount}`}
              </Text>

              <HausButton
                id={`inventory-manage-${item.id}`}
                isIconOnly
                variant="ghost"
                size="sm"
                aria-label={`Manage ${item.name}`}
                onPress={() => onManageItem(item.id)}
              >
                <UiIcon name="more-horizontal" size={16} />
              </HausButton>
            </Row>
          );
        })}

        {!items.length && (
          <Stack align="center" gapPx={8} style={{ layout: { width: pct(100), padding: insets(32, 20) } }}>
            <UiIcon name="search" size={26} />
            <Heading level={3} size={16} weight={600}>
              No devices match
            </Heading>
            <Text size={12.5} tone="muted">
              Try another name, room or filter.
            </Text>
            <HausButton id="inventory-clear-filters" variant="secondary" size="sm" onPress={onClearFilters}>
              <Text size={12}>Clear filters</Text>
            </HausButton>
          </Stack>
        )}
      </Stack>

      <Row align="center" justify="between" gapPx={10} wrap>
        <Text size={11.5} tone="muted">
          {`${items.length} of ${totalCount} devices · Live entities / registered entities`}
        </Text>
        {onAddDevice && (
          <HausButton id="inventory-add-device" variant="ghost" size="sm" onPress={onAddDevice}>
            <UiIcon name="plus" size={14} />
            <Text size={12}>Add a device</Text>
          </HausButton>
        )}
      </Row>
    </Stack>
  );
}
