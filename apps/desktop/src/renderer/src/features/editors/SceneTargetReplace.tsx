/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useMemo, useState } from 'react';
import { Box, HausButton, HausCode, HausDisclosure, Pressable, Text, TextInput } from '@haus/ui';
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
    <Box className="scene-target-adjustments">
      <Box className="scene-missing-notice" role="status">
        <AlertTriangle size={15} className="scene-missing-notice-icon" aria-hidden="true" />
        <Box>
          <Text semantic="strong">Device unavailable</Text>
          <Text semantic="p">
            No longer in your home. Replace it with another device to keep its saved settings, or
            remove it from this scene.
          </Text>
          <Box className="scene-missing-meta">
            <HausCode>{id}</HausCode>
            {savedSummary && <Text>Saved: {savedSummary}</Text>}
          </Box>
        </Box>
      </Box>

      <Box className="scene-replace-section">
        <Text className="scene-replace-heading">
          <ArrowRightLeft size={13} aria-hidden="true" />
          Replace device (keeps values)
        </Text>
        {candidates.length > 0 ? (
          <>
            <Text semantic="label" className="scene-replace-search">
              <Search size={14} aria-hidden="true" />
              <TextInput
                inputType="search"
                ariaLabel="Search replacement device"
                placeholder="Search devices or rooms…"
                value={query}
                onChange={setQuery}
              />
            </Text>
            <Box className="scene-replace-list" role="list">
              {filtered.map((candidate) => {
                const sameType = candidate.domain === missingDomain;
                return (
                  <Pressable
                    key={candidate.id}
                    type="button"
                    className="scene-replace-option"
                    onPress={() => onReplace(candidate.entity)}
                  >
                    <Text className="scene-replace-icon" ariaHidden>
                      <AccessoryIcon accessory={candidate.accessory} size={16} />
                    </Text>
                    <Text className="scene-replace-meta">
                      <Text semantic="strong">{candidate.name}</Text>
                      <Text semantic="small">{candidate.room}</Text>
                    </Text>
                    {sameType && <Text className="scene-replace-match">Same type</Text>}
                  </Pressable>
                );
              })}
              {!filtered.length && (
                <Text semantic="p" className="scene-replace-empty">
                  No matching devices.
                </Text>
              )}
            </Box>
          </>
        ) : (
          <Text semantic="p" className="scene-replace-empty">
            All controllable accessories are already included in this scene.
          </Text>
        )}
      </Box>

      <HausDisclosure
        className="scene-advanced-target"
        summary={
          <>
            <ChevronDown size={13} /> Advanced settings
          </>
        }
      >
        <JsonField
          label="Stored target"
          value={config}
          onChange={(next) => onChange(targetConfig(next))}
        />
      </HausDisclosure>

      <HausButton variant="ghost" className="scene-remove-missing" onPress={onRemove}>
        <Trash2 size={14} /> Remove from scene
      </HausButton>
    </Box>
  );
}
