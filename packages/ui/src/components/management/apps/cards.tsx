/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  formatAppCapabilityLabel,
  type CatalogAppRecord,
  type InstalledAppRecord,
} from '@haus/core/transport';
import { colorToken, insets, pct, px } from '../../../ir/geometry.js';
import { HausButton, Row, Stack, Text, useHausUi } from '../../../primitives/index.js';
import {
  BrandIcon,
  ManagementGlassCard,
  ManagementStatusPill,
  type BrandIconKind,
} from '../../brand/index.js';
import { UiIcon } from '../../icon.js';

export interface PortableInstalledAppItem extends InstalledAppRecord {
  readonly iconKind?: BrandIconKind;
  readonly iconId?: string;
  readonly vendorId?: string;
  readonly description?: string;
  readonly repositoryUrl?: string;
  readonly repository?: string;
}

export interface PortableCatalogAppItem extends CatalogAppRecord {
  readonly iconKind?: BrandIconKind;
  readonly iconId?: string;
  readonly vendorId?: string;
  readonly runtimeLabel?: string;
  readonly packageName?: string;
  readonly author?: string;
  readonly repositoryUrl?: string;
}

function resolveCatalogIconKind(entry: PortableCatalogAppItem): BrandIconKind {
  if (entry.iconKind) return entry.iconKind;
  const rt = (entry.runtimeLabel ?? '').toLowerCase();
  if (rt === 'homebridge') return 'homebridge';
  if (rt === 'scrypted') return 'scrypted';
  if (rt === 'hacs') return 'hacs';
  if (rt === 'addon') return 'addon';
  return 'app';
}

function resolveInstalledState(app: PortableInstalledAppItem): {
  readonly label: string;
  readonly tone: 'success' | 'warning' | 'neutral';
  readonly showDot: boolean;
} {
  if (!app.available) return { label: 'Unavailable', tone: 'warning', showDot: true };
  if (app.state === 'running') {
    return { label: 'Running', tone: 'success', showDot: true };
  }
  const label = app.state ? app.state.charAt(0).toUpperCase() + app.state.slice(1) : 'Stopped';
  return { label, tone: 'neutral', showDot: true };
}

export function InstalledAppGlassCard({
  app,
  canManage,
  busy,
  onManage,
  onQuickToggle,
}: {
  readonly app: PortableInstalledAppItem;
  readonly canManage: boolean;
  readonly busy: boolean;
  readonly onManage: (app: PortableInstalledAppItem) => void;
  readonly onQuickToggle?: (app: PortableInstalledAppItem, action: 'start' | 'stop') => void;
}) {
  const status = resolveInstalledState(app);
  const isRunning = app.available && app.state === 'running';
  return (
    <ManagementGlassCard
      id={`app-card-${app.id}`}
      radius={22}
      padding={insets(18)}
      interactive
      style={{
        layout: {
          width: pct(100),
          minHeight: px(158),
          justifyContent: 'between',
          gap: px(14),
        },
      }}
    >
      <Row align="start" gapPx={12} style={{ layout: { width: pct(100) } }}>
        <BrandIcon
          kind={app.iconKind ?? 'app'}
          id={app.iconId || app.externalId || app.id}
          size={44}
          hint={{
            name: app.name,
            ...(app.vendorId ? { supportedBy: app.vendorId } : {}),
            ...(app.repositoryUrl ? { repositoryUrl: app.repositoryUrl } : {}),
            ...(app.repository ? { repository: app.repository } : {}),
            ...(app.externalId ? { addonSlug: app.externalId } : {}),
          }}
        />
        <Stack gapPx={4} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
          <Text
            size={14.5}
            weight={600}
            style={{ typography: { size: 14.5, weight: 600, maxLines: 1, truncate: true } }}
          >
            {app.name}
          </Text>
          <Row align="center" gapPx={6} wrap>
            <ManagementStatusPill
              label={status.label}
              tone={status.tone}
              showDot={status.showDot}
            />
            {app.updateAvailable && <ManagementStatusPill label="Update available" tone="accent" />}
          </Row>
        </Stack>
      </Row>

      <Text
        size={12}
        tone="muted"
        style={{ typography: { size: 12, lineHeight: 1.4, maxLines: 2 } }}
      >
        {app.description || formatAppCapabilityLabel(app)}
      </Text>

      <Row align="center" justify="between" gapPx={8} style={{ layout: { width: pct(100) } }}>
        <Text size={11.5} tone="muted">
          {app.version ? `Version ${app.version}` : app.externalId}
        </Text>
        <Row align="center" gapPx={6}>
          {canManage && onQuickToggle && app.managed && (
            <HausButton
              id={`app-toggle-${app.id}`}
              variant="ghost"
              size="sm"
              disabled={busy}
              onPress={() => onQuickToggle(app, isRunning ? 'stop' : 'start')}
            >
              <Text size={12}>{isRunning ? 'Stop' : 'Start'}</Text>
            </HausButton>
          )}
          <HausButton
            id={`app-manage-${app.id}`}
            variant="secondary"
            size="sm"
            onPress={() => onManage(app)}
          >
            <Text size={12}>Manage</Text>
            <UiIcon name="chevron-right" size={14} />
          </HausButton>
        </Row>
      </Row>
    </ManagementGlassCard>
  );
}

export function CatalogAppGlassCard({
  entry,
  canManage,
  busy,
  onSelect,
}: {
  readonly entry: PortableCatalogAppItem;
  readonly canManage: boolean;
  readonly busy: boolean;
  readonly onSelect: (entry: PortableCatalogAppItem) => void;
}) {
  const { theme } = useHausUi();
  const primaryFg = theme.mode === 'dark' ? '#101010' : '#ffffff';

  return (
    <ManagementGlassCard
      id={`catalog-card-${entry.id}`}
      radius={22}
      padding={insets(18)}
      interactive
      style={{
        layout: {
          width: pct(100),
          minHeight: px(164),
          justifyContent: 'between',
          gap: px(14),
        },
      }}
    >
      <Row align="start" gapPx={12} style={{ layout: { width: pct(100) } }}>
        <BrandIcon
          kind={resolveCatalogIconKind(entry)}
          id={entry.iconId || entry.packageName || entry.id}
          size={44}
          hint={{
            name: entry.name,
            category: entry.category,
            ...(entry.vendorId ? { supportedBy: entry.vendorId } : {}),
            ...(entry.repositoryUrl ? { repositoryUrl: entry.repositoryUrl } : {}),
          }}
        />
        <Stack gapPx={4} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
          <Text
            size={14.5}
            weight={600}
            style={{ typography: { size: 14.5, weight: 600, maxLines: 1, truncate: true } }}
          >
            {entry.name}
          </Text>
          <Row align="center" gapPx={6} wrap>
            {entry.verified && <ManagementStatusPill label="Verified" tone="success" />}
            {entry.runtimeLabel && (
              <ManagementStatusPill label={entry.runtimeLabel} tone="neutral" />
            )}
            {entry.installed && (
              <ManagementStatusPill
                label={entry.updateAvailable ? 'Update available' : 'Installed'}
                tone={entry.updateAvailable ? 'accent' : 'success'}
              />
            )}
          </Row>
        </Stack>
      </Row>

      <Text
        size={12}
        tone="muted"
        style={{ typography: { size: 12, lineHeight: 1.4, maxLines: 2 } }}
      >
        {entry.description || entry.category}
      </Text>

      <Row align="center" justify="between" gapPx={8} style={{ layout: { width: pct(100) } }}>
        <Text
          size={11.5}
          tone="muted"
          style={{
            layout: { flexGrow: 1, flexShrink: 1, minWidth: px(0) },
            typography: { size: 11.5, maxLines: 1, truncate: true },
          }}
        >
          {[entry.latestVersion ? `Version ${entry.latestVersion}` : '', entry.author ?? '']
            .filter(Boolean)
            .join(' · ') || entry.category}
        </Text>
        {entry.installed ? (
          <HausButton
            id={`catalog-manage-${entry.id}`}
            variant="secondary"
            size="sm"
            onPress={() => onSelect(entry)}
          >
            <Text size={12}>Manage</Text>
            <UiIcon name="chevron-right" size={14} />
          </HausButton>
        ) : (
          <HausButton
            id={`catalog-install-${entry.id}`}
            variant={canManage ? 'primary' : 'secondary'}
            size="sm"
            disabled={busy}
            onPress={() => onSelect(entry)}
          >
            {canManage && <UiIcon name="plus" size={13} color={primaryFg} />}
            <Text
              size={12}
              style={
                canManage
                  ? { typography: { size: 12, weight: 600, color: colorToken('accentForeground') } }
                  : undefined
              }
            >
              {busy ? 'Installing…' : canManage ? 'Install' : 'Details'}
            </Text>
          </HausButton>
        )}
      </Row>
    </ManagementGlassCard>
  );
}
