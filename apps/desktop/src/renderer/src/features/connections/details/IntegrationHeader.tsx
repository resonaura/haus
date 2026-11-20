/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Button } from '@heroui/react';
import { ArrowUpCircle, Box, Globe, HelpCircle, Package, Plus, RefreshCw } from 'lucide-react';
import { BrandIcon } from '../../../components/brand/BrandIcon';
import { nativeApi } from '../../../ha/management';
import {
  formatIotClass,
  formatRuntimeLabel,
  type IntegrationDomainMeta,
  type UnifiedUpdateItem,
} from '../system/types';

const KNOWN_HACS_DOMAINS = new Set([
  'xiaomi_miot',
  'meross_lan',
  'sensibo',
  'ble_monitor',
  'localtuya',
  'tuya_local',
  'sonoff',
  'dreame_vacuum',
  'tapo',
  'govee_lan',
  'hacs',
]);

export function IntegrationHeader({
  domain,
  name,
  meta,
  updateItem,
  installingUpdateId,
  checkingUpdates,
  deviceCount,
  entityCount,
  canAdd,
  onAdd,
  onInstallUpdate,
  onCheckUpdates,
  onOpenHacs,
  onFocusEntries,
}: {
  domain: string;
  name: string;
  meta?: IntegrationDomainMeta;
  updateItem?: UnifiedUpdateItem;
  installingUpdateId?: string | null;
  checkingUpdates?: boolean;
  deviceCount: number;
  entityCount: number;
  canAdd: boolean;
  onAdd: () => void;
  onInstallUpdate?: (item: UnifiedUpdateItem) => Promise<void>;
  onCheckUpdates?: () => Promise<void>;
  onOpenHacs?: () => void;
  onFocusEntries?: () => void;
}) {
  const connectivity = formatIotClass(meta?.iotClass);
  const runtimeLabel = meta?.runtimeType ? formatRuntimeLabel(meta.runtimeType) : undefined;
  const supportsMulti = meta?.supportsMultiple ?? true;
  const addLabel = supportsMulti ? 'Add entry' : 'Add device';
  const isCustomOrHacs =
    meta?.runtimeType === 'custom_integration' ||
    updateItem?.category === 'hacs' ||
    KNOWN_HACS_DOMAINS.has(domain);
  const updatingThis = Boolean(updateItem && installingUpdateId === updateItem.id);

  const iconKind =
    meta?.runtimeType === 'homebridge'
      ? 'homebridge'
      : meta?.runtimeType === 'scrypted'
        ? 'scrypted'
        : meta?.runtimeType === 'addon'
          ? 'addon'
          : meta?.runtimeType === 'docker_app'
            ? 'app'
            : 'integration';

  return (
    <header className="integration-hero">
      <div className="integration-hero-main">
        <span className="integration-hero-icon">
          <BrandIcon
            kind={iconKind}
            id={domain}
            size={60}
            hint={{
              ...(name ? { name } : {}),
              ...(meta?.runtimeType ? { category: meta.runtimeType } : {}),
            }}
          />
        </span>
        <div className="integration-hero-copy">
          <div className="integration-hero-title-row">
            <h2>{name}</h2>
            {updateItem?.updateAvailable && <span className="update-pill">Update available</span>}
            {meta?.documentationUrl && (
              <button
                type="button"
                className="flow-help-button"
                aria-label="Integration documentation"
                title="Open documentation"
                onClick={() =>
                  void nativeApi()
                    .openExternal(meta.documentationUrl!)
                    .catch(() => {})
                }
              >
                <HelpCircle size={17} />
              </button>
            )}
          </div>
          {(meta?.version || updateItem || runtimeLabel || connectivity) && (
            <div className="integration-hero-meta">
              {updateItem?.updateAvailable ? (
                <span>
                  Version {updateItem.installedVersion} → {updateItem.latestVersion}
                </span>
              ) : (
                (meta?.version || updateItem?.installedVersion) && (
                  <span>Version {meta?.version ?? updateItem?.installedVersion}</span>
                )
              )}
              {runtimeLabel && (
                <span className="integration-meta-tag is-source">
                  <Package size={13} />
                  {runtimeLabel}
                </span>
              )}
              {connectivity && (
                <span className="integration-meta-tag">
                  <Globe size={13} />
                  {connectivity}
                </span>
              )}
            </div>
          )}
          <button type="button" className="integration-hero-stats" onClick={onFocusEntries}>
            {deviceCount} {deviceCount === 1 ? 'device' : 'devices'} · {entityCount}{' '}
            {entityCount === 1 ? 'entity' : 'entities'}
          </button>
        </div>
      </div>

      <div className="system-item-actions">
        {updateItem && onInstallUpdate && (updateItem.updateAvailable || isCustomOrHacs) && (
          <Button
            variant={updateItem.updateAvailable ? 'primary' : 'secondary'}
            className={updateItem.updateAvailable ? 'flow-next-pill' : undefined}
            isPending={updatingThis}
            isDisabled={Boolean(installingUpdateId) || updateItem.compatibility === 'incompatible'}
            onPress={() => void onInstallUpdate(updateItem)}
          >
            <ArrowUpCircle size={15} />
            {updatingThis
              ? 'Updating…'
              : updateItem.updateAvailable
                ? `Update to ${updateItem.latestVersion}`
                : 'Reinstall'}
          </Button>
        )}
        {isCustomOrHacs && onCheckUpdates && (
          <Button
            variant="secondary"
            isDisabled={Boolean(checkingUpdates) || Boolean(installingUpdateId)}
            onPress={() => void onCheckUpdates()}
          >
            <RefreshCw size={15} className={checkingUpdates ? 'spin' : undefined} />
            {checkingUpdates ? 'Checking…' : 'Check update'}
          </Button>
        )}
        {isCustomOrHacs && onOpenHacs && (
          <Button variant="secondary" onPress={onOpenHacs}>
            <Box size={15} />
            HACS
          </Button>
        )}
        {canAdd && (
          <Button className="flow-next-pill integration-add-btn" onPress={onAdd}>
            <Plus size={15} />
            {addLabel}
          </Button>
        )}
      </div>
    </header>
  );
}
