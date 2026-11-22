/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useMemo, useState } from 'react';
import { Button } from '@heroui/react';
import { AlertTriangle, ArrowRightLeft, ChevronDown, Search, Trash2 } from 'lucide-react';
import { AccessoryIcon } from '../../components/icons/Icon';
import { JsonField } from '../../components/forms/SchemaForm';
import type { HassEntity, HausAccessory } from '../../model';
import { targetConfig, type SceneTarget } from '../../model/scene-target';
import { describeSavedTargetValues, inferSceneTargetDomain } from './scene-target-helpers';

export interface SceneReplacementCandidate {
  readonly id: string;
  readonly name: string;
  readonly room: string;
  readonly domain: string;
  readonly entity: HassEntity;
  readonly accessory: HausAccessory;
}

export function SceneTargetReplace({
  id,
  value,
  candidates,
  onReplace,
  onChange,
  onRemove,
}: {
  id: string;
  value: SceneTarget;
  candidates: readonly SceneReplacementCandidate[];
  onReplace: (target: HassEntity) => void;
  onChange: (next: SceneTarget) => void;
  onRemove: () => void;
}) {
  const [query, setQuery] = useState('');
  const config = targetConfig(value);
  const missingDomain = inferSceneTargetDomain(id, config);
  const savedSummary = describeSavedTargetValues(id, config);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    return [...candidates]
      .filter(
        (candidate) =>
          !q || `${candidate.name} ${candidate.room} ${candidate.id}`.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        const aMatch = a.domain === missingDomain ? 0 : 1;
        const bMatch = b.domain === missingDomain ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
        return collator.compare(a.room, b.room) || collator.compare(a.name, b.name);
      });
  }, [candidates, missingDomain, query]);

  return (
    <div className="scene-target-adjustments">
      <div className="scene-missing-notice" role="status">
        <AlertTriangle size={15} className="scene-missing-notice-icon" aria-hidden="true" />
        <div>
          <strong>Device unavailable</strong>
          <p>
            No longer in your home. Replace it with another device to keep its saved settings, or
            remove it from this scene.
          </p>
          <div className="scene-missing-meta">
            <code>{id}</code>
            {savedSummary && <span>Saved: {savedSummary}</span>}
          </div>
        </div>
      </div>

      <div className="scene-replace-section">
        <span className="scene-replace-heading">
          <ArrowRightLeft size={13} aria-hidden="true" />
          Replace device (keeps values)
        </span>
        {candidates.length > 0 ? (
          <>
            <label className="scene-replace-search">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                aria-label="Search replacement device"
                placeholder="Search devices or rooms…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="scene-replace-list" role="list">
              {filtered.map((candidate) => {
                const sameType = candidate.domain === missingDomain;
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    className="scene-replace-option"
                    onClick={() => onReplace(candidate.entity)}
                  >
                    <span className="scene-replace-icon" aria-hidden="true">
                      <AccessoryIcon accessory={candidate.accessory} size={16} />
                    </span>
                    <span className="scene-replace-meta">
                      <strong>{candidate.name}</strong>
                      <small>{candidate.room}</small>
                    </span>
                    {sameType && <span className="scene-replace-match">Same type</span>}
                  </button>
                );
              })}
              {!filtered.length && <p className="scene-replace-empty">No matching devices.</p>}
            </div>
          </>
        ) : (
          <p className="scene-replace-empty">
            All controllable accessories are already included in this scene.
          </p>
        )}
      </div>

      <details className="scene-advanced-target">
        <summary>
          <ChevronDown size={13} /> Advanced settings
        </summary>
        <JsonField
          label="Stored target"
          value={config}
          onChange={(next) => onChange(targetConfig(next))}
        />
      </details>

      <Button variant="ghost" className="scene-remove-missing" onPress={onRemove}>
        <Trash2 size={14} /> Remove from scene
      </Button>
    </div>
  );
}
