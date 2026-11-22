/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useMemo, useState, type CSSProperties } from 'react';
import { Button } from '@heroui/react';
import { Search, X } from 'lucide-react';
import type { buildAction, HassEntity } from '../../../model';
import {
  lightActiveEffect,
  lightDisableEffect,
  lightEffectOptions,
  type LightEffectOption,
} from '../../../model/light-profile';
import { triggerHaptic } from '../../../components/ui/haptics';
import { Glyph } from './ControlGlyph';
import { LightEffectIcon } from './LightEffectIcon';

type Intent = Parameters<typeof buildAction>[1];
type Value = Parameters<typeof buildAction>[2];

const COMPACT_LIMIT = 8;

function pillStyle(option: LightEffectOption): CSSProperties {
  return {
    '--effect-c1': option.palette[0],
    '--effect-c2': option.palette[1],
    '--effect-c3': option.palette[2],
  } as CSSProperties;
}

export function LightEffects({
  entity,
  capabilities,
  disabled,
  act,
}: {
  entity: HassEntity;
  capabilities: string[];
  disabled: boolean;
  act: (intent: Intent, value?: Value) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');

  const allOptions = useMemo(() => lightEffectOptions(entity), [entity]);
  const dynamicOptions = useMemo(
    () => allOptions.filter((option) => !option.isStatic),
    [allOptions],
  );
  const disableOption = useMemo(() => lightDisableEffect(entity), [entity]);
  const activeEffect = lightActiveEffect(entity);

  if (!capabilities.includes('effect') || dynamicOptions.length === 0) return null;

  const activeOption = activeEffect
    ? dynamicOptions.find((option) => option.value === activeEffect)
    : undefined;
  const hasOverflow = dynamicOptions.length > COMPACT_LIMIT;
  const trimmedQuery = query.trim().toLocaleLowerCase();

  const visibleOptions = (() => {
    if (expanded) {
      if (!trimmedQuery) return dynamicOptions;
      return dynamicOptions.filter(
        (option) =>
          option.label.toLocaleLowerCase().includes(trimmedQuery) ||
          option.value.toLocaleLowerCase().includes(trimmedQuery) ||
          option.id.includes(trimmedQuery),
      );
    }
    const slice = dynamicOptions.slice(0, COMPACT_LIMIT);
    if (activeOption && !slice.some((item) => item.value === activeOption.value)) {
      return [activeOption, ...slice.slice(0, COMPACT_LIMIT - 1)];
    }
    return slice;
  })();

  const handleSelect = (option: LightEffectOption) => {
    triggerHaptic('alignment');
    if (activeEffect === option.value && disableOption) {
      act('effect', disableOption);
      return;
    }
    act('effect', option.value);
  };

  return (
    <section className="haus-light-effects" aria-label="Light effects">
      <div className="haus-light-effects-header">
        <span className="haus-light-effects-title">Effects</span>
        {activeOption && (
          <span
            className="haus-light-effects-active"
            data-light-effect={activeOption.motion}
            style={pillStyle(activeOption)}
          >
            <LightEffectIcon icon={activeOption.icon} size={12} />
            <span>{activeOption.label}</span>
          </span>
        )}
        {activeEffect && disableOption && (
          <Button
            className="haus-light-effects-stop"
            variant="ghost"
            size="sm"
            isDisabled={disabled}
            onPress={() => {
              triggerHaptic('alignment');
              act('effect', disableOption);
            }}
          >
            Stop
          </Button>
        )}
      </div>

      {expanded && hasOverflow && (
        <label className="haus-light-effects-search">
          <Search size={13} aria-hidden="true" />
          <input
            type="text"
            value={query}
            placeholder="Filter effects…"
            aria-label="Filter light effects"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button type="button" aria-label="Clear effect filter" onClick={() => setQuery('')}>
              <X size={12} aria-hidden="true" />
            </button>
          )}
        </label>
      )}

      <div className="haus-light-effects-grid" role="group" aria-label="Available light effects">
        {visibleOptions.map((option) => {
          const isSelected = activeEffect === option.value;
          return (
            <button
              key={option.value}
              type="button"
              className={`haus-light-effect-pill ${isSelected ? 'is-selected' : ''}`}
              data-light-effect={isSelected ? option.motion : undefined}
              style={pillStyle(option)}
              aria-pressed={isSelected}
              disabled={disabled}
              onClick={() => handleSelect(option)}
            >
              <span className="haus-light-effect-glyph">
                <LightEffectIcon icon={option.icon} size={13} />
              </span>
              <span className="haus-light-effect-label">{option.label}</span>
            </button>
          );
        })}
        {expanded && visibleOptions.length === 0 && (
          <p className="haus-light-effects-empty">No effects match “{query.trim()}”.</p>
        )}
      </div>

      {hasOverflow && (
        <Button
          className="haus-colour-expand haus-light-effects-expand"
          variant="ghost"
          aria-expanded={expanded}
          onPress={() => {
            setExpanded((prev) => !prev);
            if (expanded) setQuery('');
          }}
        >
          {expanded ? 'Show fewer effects' : `All effects (${dynamicOptions.length})`}{' '}
          <Glyph name="chevron" className={expanded ? 'is-expanded' : ''} />
        </Button>
      )}
    </section>
  );
}
