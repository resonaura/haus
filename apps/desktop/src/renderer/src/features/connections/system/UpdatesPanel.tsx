/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { Box as UiBox, HausButton, Heading, Pressable, Text } from '@haus/ui';
import {
  ArrowLeft,
  ArrowUpCircle,
  Box,
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react';
import { BrandIcon } from '../../../components/brand/BrandIcon';
import { nativeApi } from '../../../ha/management';
import { formatCategoryBadge, type UnifiedUpdateItem, type UnifiedUpdatesResponse } from './types';

type FilterKind = 'available' | 'all' | 'firmware' | 'core_addon' | 'hacs' | 'bridges';

function matchesFilter(item: UnifiedUpdateItem, filter: FilterKind): boolean {
  if (filter === 'available') return item.updateAvailable;
  if (filter === 'firmware') return item.category === 'firmware';
  if (filter === 'core_addon') return item.category === 'core' || item.category === 'addon';
  if (filter === 'hacs') return item.category === 'hacs' || item.category === 'integration';
  if (filter === 'bridges') {
    return (
      item.category === 'homebridge' || item.category === 'scrypted' || item.category === 'plugin'
    );
  }
  return true;
}

export function UpdatesPanel({
  updates,
  checking,
  installingId,
  onBack,
  onCheck,
  onInstall,
  onInstallAll,
  onOpenHacs,
}: {
  updates: UnifiedUpdatesResponse | null;
  checking: boolean;
  installingId: string | null;
  onBack: () => void;
  onCheck: () => Promise<void>;
  onInstall: (item: UnifiedUpdateItem) => Promise<void>;
  onInstallAll?: (items: readonly UnifiedUpdateItem[]) => Promise<void>;
  onOpenHacs?: () => void;
}) {
  const [filter, setFilter] = useState<FilterKind>(() =>
    (updates?.availableCount ?? 0) > 0 ? 'available' : 'all',
  );
  const items = updates?.items ?? [];
  const availableItems = items.filter((i) => i.updateAvailable);
  const installableItems = availableItems.filter((i) => i.canInstall !== false);
  const availableCount = availableItems.length;
  const visible = items.filter((item) => matchesFilter(item, filter));
  const batchBusy = installingId === '__batch__';

  return (
    <UiBox semantic="section" className="connection-detail-page" ariaLabel="Updates">
      <UiBox className="system-panel-topbar">
        <HausButton variant="ghost" className="connection-back" onPress={onBack}>
          <ArrowLeft size={17} />
          Back
        </HausButton>
        <UiBox className="system-item-actions">
          {onOpenHacs && (
            <HausButton size="sm" variant="secondary" onPress={onOpenHacs}>
              <Box size={14} />
              Community · HACS
            </HausButton>
          )}
          {onInstallAll && installableItems.length > 1 && (
            <HausButton
              size="sm"
              className="flow-next-pill"
              isPending={batchBusy}
              isDisabled={Boolean(installingId) || checking}
              onPress={() => void onInstallAll(installableItems)}
            >
              <ArrowUpCircle size={14} />
              {batchBusy ? 'Updating all…' : `Update all (${installableItems.length})`}
            </HausButton>
          )}
          <HausButton
            size="sm"
            variant="secondary"
            isDisabled={checking || Boolean(installingId)}
            onPress={() => void onCheck()}
          >
            {checking ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
            {checking ? 'Checking…' : 'Check for updates'}
          </HausButton>
        </UiBox>
      </UiBox>

      <UiBox semantic="header" className="management-page-head">
        <UiBox>
          <Heading level={2}>Updates</Heading>
          <Text semantic="p">
            Manage updates across Core, HACS custom integrations, Apps, Homebridge, and Scrypted
            plugins.
          </Text>
        </UiBox>
      </UiBox>

      <UiBox className="system-filter-pills" role="tablist" ariaLabel="Update category filter">
        {(
          [
            ['available', `Available (${availableCount})`],
            ['all', `All (${items.length})`],
            ['firmware', 'Device Firmware'],
            ['core_addon', 'Core & Add-ons'],
            ['hacs', 'Integrations & HACS'],
            ['bridges', 'Homebridge & Scrypted'],
          ] as const
        ).map(([id, label]) => (
          <Pressable
            key={id}
            role="tab"
            ariaSelected={filter === id}
            className={`system-filter-pill ${filter === id ? 'is-active' : ''}`}
            onPress={() => setFilter(id)}
          >
            {label}
          </Pressable>
        ))}
      </UiBox>

      {visible.length === 0 ? (
        <UiBox className="management-empty">
          <CheckCircle2 size={32} />
          <Heading level={3}>
            {filter === 'available' ? 'Everything is up to date' : 'No matching items'}
          </Heading>
          <Text semantic="p">
            {filter === 'available'
              ? 'No pending updates were found across your installed integrations and plugins.'
              : 'Run Check for updates or switch filters to inspect installed versions.'}
          </Text>
        </UiBox>
      ) : (
        <UiBox className="system-list">
          {visible.map((item) => {
            const busy = installingId === item.id || item.inProgress;
            return (
              <UiBox semantic="article" key={item.id} className="system-item-card">
                <Text className="integration-logo">
                  {item.category === 'core' ? (
                    <ArrowUpCircle size={22} />
                  ) : (
                    <BrandIcon
                      kind={item.category === 'firmware' ? 'integration' : item.category}
                      id={item.domain}
                      hint={{ name: item.title, category: item.category }}
                    />
                  )}
                </Text>
                <UiBox className="system-item-copy">
                  <UiBox className="system-item-title-row">
                    <Heading level={3}>{item.title}</Heading>
                    <Text className="integration-badge">{formatCategoryBadge(item.category)}</Text>
                    {item.updateAvailable && <Text className="update-pill">Update available</Text>}
                    {item.pendingRestart && (
                      <Text className="attention-pill">Restart required</Text>
                    )}
                  </UiBox>
                  <Text semantic="p">
                    {item.updateAvailable
                      ? `${item.installedVersion} → ${item.latestVersion}`
                      : `Version ${item.installedVersion}`}
                  </Text>
                  {item.compatibilityReason && (
                    <Text semantic="small">{item.compatibilityReason}</Text>
                  )}
                  {item.releaseSummary && <Text semantic="small">{item.releaseSummary}</Text>}
                </UiBox>
                <UiBox className="system-item-actions">
                  {item.releaseUrl && (
                    <HausButton
                      size="sm"
                      variant="ghost"
                      onPress={() =>
                        void nativeApi()
                          .openExternal(item.releaseUrl!)
                          .catch(() => {})
                      }
                    >
                      Release notes
                      <ExternalLink size={13} />
                    </HausButton>
                  )}
                  {(item.updateAvailable || item.category === 'hacs') && (
                    <HausButton
                      size="sm"
                      variant={item.updateAvailable ? 'primary' : 'secondary'}
                      className={item.updateAvailable ? 'flow-next-pill' : undefined}
                      isPending={busy}
                      isDisabled={Boolean(installingId) || item.compatibility === 'incompatible'}
                      onPress={() => void onInstall(item)}
                    >
                      {busy ? 'Updating…' : item.updateAvailable ? 'Update' : 'Reinstall'}
                    </HausButton>
                  )}
                </UiBox>
              </UiBox>
            );
          })}
        </UiBox>
      )}
    </UiBox>
  );
}
