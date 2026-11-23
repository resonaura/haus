/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useMemo, useState } from 'react';
import { Box, HausButton, Pressable, Text, TextInput, type HostSurfaceTokens } from '@haus/ui';
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

function pillTokens(option: LightEffectOption): HostSurfaceTokens {
  return {
    '--effect-c1': option.palette[0],
    '--effect-c2': option.palette[1],
    '--effect-c3': option.palette[2],
  };
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
    <Box semantic="section" className="haus-light-effects" ariaLabel="Light effects">
      <Box className="haus-light-effects-header">
        <Text className="haus-light-effects-title">Effects</Text>
        {activeOption && (
          <Text
            className="haus-light-effects-active"
            dataAttrs={{ 'data-light-effect': activeOption.motion }}
            surfaceTokens={pillTokens(activeOption)}
          >
            <LightEffectIcon icon={activeOption.icon} size={12} />
            <Text>{activeOption.label}</Text>
          </Text>
        )}
        {activeEffect && disableOption && (
          <HausButton
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
          </HausButton>
        )}
      </Box>

      {expanded && hasOverflow && (
        <Text semantic="label" className="haus-light-effects-search">
          <Search size={13} aria-hidden="true" />
          <TextInput
            value={query}
            placeholder="Filter effects…"
            ariaLabel="Filter light effects"
            onChange={setQuery}
          />
          {query && (
            <Pressable ariaLabel="Clear effect filter" onPress={() => setQuery('')}>
              <X size={12} aria-hidden="true" />
            </Pressable>
          )}
        </Text>
      )}

      <Box className="haus-light-effects-grid" role="group" ariaLabel="Available light effects">
        {visibleOptions.map((option) => {
          const isSelected = activeEffect === option.value;
          return (
            <Pressable
              key={option.value}
              className={`haus-light-effect-pill ${isSelected ? 'is-selected' : ''}`}
              dataAttrs={{ 'data-light-effect': isSelected ? option.motion : undefined }}
              surfaceTokens={pillTokens(option)}
              ariaPressed={isSelected}
              disabled={disabled}
              onPress={() => handleSelect(option)}
            >
              <Text className="haus-light-effect-glyph">
                <LightEffectIcon icon={option.icon} size={13} />
              </Text>
              <Text className="haus-light-effect-label">{option.label}</Text>
            </Pressable>
          );
        })}
        {expanded && visibleOptions.length === 0 && (
          <Text semantic="p" className="haus-light-effects-empty">
            No effects match “{query.trim()}”.
          </Text>
        )}
      </Box>

      {hasOverflow && (
        <HausButton
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
        </HausButton>
      )}
    </Box>
  );
}
