/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Button } from '@heroui/react';
import { Globe, HelpCircle, Package, Plus } from 'lucide-react';
import { BrandIcon } from '../../../components/brand/BrandIcon';
import { nativeApi } from '../../../ha/management';
import { formatIotClass, formatRuntimeLabel, type IntegrationDomainMeta } from '../system/types';

export function IntegrationHeader({
  domain,
  name,
  meta,
  deviceCount,
  entityCount,
  canAdd,
  onAdd,
  onFocusEntries,
}: {
  domain: string;
  name: string;
  meta?: IntegrationDomainMeta;
  deviceCount: number;
  entityCount: number;
  canAdd: boolean;
  onAdd: () => void;
  onFocusEntries?: () => void;
}) {
  const connectivity = formatIotClass(meta?.iotClass);
  const runtimeLabel = meta?.runtimeType ? formatRuntimeLabel(meta.runtimeType) : undefined;
  const supportsMulti = meta?.supportsMultiple ?? true;
  const addLabel = supportsMulti ? 'Add entry' : 'Add device';

  return (
    <header className="integration-hero">
      <div className="integration-hero-main">
        <span className="integration-hero-icon">
          <BrandIcon kind="integration" id={domain} />
        </span>
        <div className="integration-hero-copy">
          <div className="integration-hero-title-row">
            <h2>{name}</h2>
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
          {(meta?.version || runtimeLabel || connectivity) && (
            <div className="integration-hero-meta">
              {meta?.version && <span>Version {meta.version}</span>}
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

      {canAdd && (
        <Button className="flow-next-pill integration-add-btn" onPress={onAdd}>
          <Plus size={15} />
          {addLabel}
        </Button>
      )}
    </header>
  );
}
