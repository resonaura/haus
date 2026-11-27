/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import {
  parseOAuthCallbackInput,
  type NormalizedFlowMenuOption,
  type ParsedOAuthCallbackInput,
} from '@haus/core/transport';
import { colorToken, corners, insets, mixColor, pct, px } from '../../../ir/geometry.js';
import { SolidMaterial } from '../../../ir/materials.js';
import {
  Box,
  HausButton,
  Heading,
  Pressable,
  Row,
  Stack,
  Text,
  TextInput,
  useHausUi,
} from '../../../primitives/index.js';
import { BrandIcon, ManagementGlassCard } from '../../brand/index.js';
import { UiIcon } from '../../icon.js';

export {
  FlowResultStepView,
  FlowTargetFallbackView,
  FlowUnsupportedView,
  type FlowUnsupportedInfo,
  type FlowUnsupportedRequirement,
} from './result-step.js';

/** Electron-matched radio card menu step for HA `type: 'menu'` config flows. */
export function FlowMenuStepView({
  options,
  activeKey,
  description,
  busy = false,
  onSelectKey,
  onDoubleSelect,
}: {
  readonly options: readonly NormalizedFlowMenuOption[];
  readonly activeKey: string;
  readonly description?: string;
  readonly busy?: boolean;
  readonly onSelectKey: (key: string) => void;
  readonly onDoubleSelect?: (key: string) => void;
}) {
  const { theme } = useHausUi();
  const dark = theme.mode === 'dark';

  if (options.length === 0) {
    return (
      <ManagementGlassCard radius={18} padding={insets(16)} style={{ layout: { width: pct(100) } }}>
        <Text size={12.5} tone="muted">
          No setup actions were returned for this step. Go back or close to choose another
          integration.
        </Text>
      </ManagementGlassCard>
    );
  }

  return (
    <Stack gapPx={10} style={{ layout: { width: pct(100) } }}>
      {description && (
        <Text size={13} tone="muted" style={{ typography: { size: 13, lineHeight: 1.45 } }}>
          {description}
        </Text>
      )}
      <Stack gapPx={8} style={{ layout: { width: pct(100) } }}>
        {options.map((opt) => {
          const selected = activeKey === opt.key;
          return (
            <Pressable
              key={opt.key}
              id={`flow-menu-${opt.key}`}
              role="radio"
              ariaChecked={selected}
              disabled={busy}
              onActivate={() => onSelectKey(opt.key)}
              onDoublePress={() => {
                if (!busy) onDoubleSelect?.(opt.key);
              }}
              style={{
                layout: {
                  direction: 'row',
                  alignItems: 'center',
                  gap: px(12),
                  width: pct(100),
                  padding: insets(13, 15),
                },
                material: new SolidMaterial(
                  selected
                    ? mixColor(colorToken('card'), colorToken('accent'), dark ? 0.14 : 0.08)
                    : colorToken('card'),
                ),
                border: {
                  width: 1,
                  color: selected ? colorToken('accent') : colorToken('border'),
                },
                corners: corners(16),
                transitionMs: 150,
              }}
            >
              <Box
                ariaHidden
                style={{
                  layout: {
                    width: px(18),
                    height: px(18),
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  },
                  border: {
                    width: selected ? 5 : 1.5,
                    color: selected ? colorToken('accent') : colorToken('border'),
                  },
                  corners: corners(999, 'round'),
                }}
              />
              <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                <Text size={13.5} weight={600}>
                  {opt.label}
                </Text>
                {opt.description && (
                  <Text
                    size={12}
                    tone="muted"
                    style={{ typography: { size: 12, lineHeight: 1.4 } }}
                  >
                    {opt.description}
                  </Text>
                )}
              </Stack>
              <UiIcon name="chevron-right" size={14} />
            </Pressable>
          );
        })}
      </Stack>
    </Stack>
  );
}

/** OAuth2 external browser sign-in step + expandable manual redirect URL / code relay. */
export function FlowOAuthStepView({
  domain,
  domainName,
  url,
  description,
  busy = false,
  canSubmitManualCallback = false,
  onOpenExternal,
  onSubmitManualCallback,
}: {
  readonly domain: string;
  readonly domainName: string;
  readonly url?: string;
  readonly description?: string;
  readonly busy?: boolean;
  readonly canSubmitManualCallback?: boolean;
  readonly onOpenExternal: () => void;
  readonly onSubmitManualCallback?: (parsed: ParsedOAuthCallbackInput) => void;
}) {
  const { theme } = useHausUi();
  const primaryFg = theme.mode === 'dark' ? '#101010' : '#ffffff';
  const [showManual, setShowManual] = useState(false);
  const [callbackInput, setCallbackInput] = useState('');
  const [localError, setLocalError] = useState('');

  const handleManual = () => {
    const parsed = parseOAuthCallbackInput(callbackInput);
    if (!parsed.code && !parsed.error) {
      setLocalError('Paste the redirect URL or authorization code from your browser.');
      return;
    }
    setLocalError('');
    onSubmitManualCallback?.(parsed);
  };

  return (
    <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
      <ManagementGlassCard
        radius={22}
        padding={insets(22, 20)}
        style={{ layout: { width: pct(100) } }}
      >
        <Stack align="center" gapPx={12} style={{ layout: { width: pct(100) } }}>
          <BrandIcon kind="integration" id={domain} size={52} hint={{ name: domainName }} />
          <Heading level={3} size={16.5} weight={600}>
            {`Sign in with ${domainName}`}
          </Heading>
          <Text
            size={12.5}
            tone="muted"
            style={{ typography: { size: 12.5, align: 'center', lineHeight: 1.45 } }}
          >
            {description ||
              'This provider requires browser authorization. Haus will continue setup automatically once you finish signing in.'}
          </Text>
          {url && (
            <HausButton
              id="flow-open-external"
              variant="primary"
              disabled={busy}
              onPress={onOpenExternal}
            >
              <Text
                size={13}
                style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
              >
                Continue to sign in
              </Text>
              <UiIcon name="external-link" size={14} color={primaryFg} />
            </HausButton>
          )}
          <Row align="center" gapPx={6}>
            <UiIcon name="loader-circle" size={13} />
            <Text size={11.5} tone="muted">
              Waiting for authorization callback…
            </Text>
          </Row>
        </Stack>
      </ManagementGlassCard>

      {canSubmitManualCallback && onSubmitManualCallback && (
        <ManagementGlassCard
          radius={18}
          padding={insets(12, 14)}
          style={{ layout: { width: pct(100), gap: px(10) } }}
        >
          <Pressable
            id="flow-oauth-manual-toggle"
            onActivate={() => setShowManual((prev) => !prev)}
            style={{
              layout: {
                direction: 'row',
                alignItems: 'center',
                justifyContent: 'between',
                width: pct(100),
              },
            }}
          >
            <Text size={12} weight={600} tone="muted">
              {showManual
                ? 'Hide manual redirect helper'
                : 'Finished in browser and did not auto-return?'}
            </Text>
            <UiIcon name={showManual ? 'chevron-up' : 'chevron-down'} size={14} />
          </Pressable>
          {showManual && (
            <Stack gapPx={8} style={{ layout: { width: pct(100) } }}>
              <TextInput
                id="flow-oauth-callback-input"
                ariaLabel="Redirect URL or authorization code"
                placeholder="https://my.home-assistant.io/redirect/oauth?code=…&state=…"
                value={callbackInput}
                disabled={busy}
                onChange={setCallbackInput}
                style={{
                  layout: { width: pct(100), minHeight: px(38), padding: insets(8, 12) },
                  material: new SolidMaterial(colorToken('surface')),
                  border: { width: 1, color: colorToken('border') },
                  corners: corners(10),
                  typography: { size: 12.5, color: colorToken('textPrimary') },
                }}
              />
              {localError && (
                <Text size={11.5} tone="critical">
                  {localError}
                </Text>
              )}
              <Row justify="end">
                <HausButton
                  id="flow-oauth-callback-submit"
                  variant="secondary"
                  size="sm"
                  disabled={busy || !callbackInput.trim()}
                  onPress={handleManual}
                >
                  <Text size={12}>Complete authorization</Text>
                </HausButton>
              </Row>
            </Stack>
          )}
        </ManagementGlassCard>
      )}
    </Stack>
  );
}

/** Progress / waiting step view for `progress`, `progress_done`, and `external_done`. */
export function FlowProgressStepView({ message }: { readonly message: string }) {
  return (
    <ManagementGlassCard
      radius={20}
      padding={insets(26, 20)}
      style={{ layout: { width: pct(100) } }}
    >
      <Stack align="center" gapPx={10} style={{ layout: { width: pct(100) } }}>
        <UiIcon name="loader-circle" size={22} />
        <Text
          size={13.5}
          weight={500}
          tone="muted"
          style={{ typography: { size: 13.5, align: 'center', lineHeight: 1.45 } }}
        >
          {message}
        </Text>
      </Stack>
    </ManagementGlassCard>
  );
}
