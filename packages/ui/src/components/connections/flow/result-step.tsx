/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import {
  isCompletedFlowStep,
  type FlowLocalizationHelpers,
  type FlowStepRecord,
} from '@haus/core/transport';
import {
  colorToken,
  corners,
  insets,
  mixColor,
  pct,
  px,
  rgba,
  transparentColor,
} from '../../../ir/geometry.js';
import { SolidMaterial } from '../../../ir/materials.js';
import {
  Box,
  HausButton,
  Heading,
  Row,
  Stack,
  Text,
  TextInput,
  useHausUi,
} from '../../../primitives/index.js';
import { ManagementGlassCard, ManagementStatusPill } from '../../brand/index.js';
import { UiIcon } from '../../icon.js';

export interface FlowUnsupportedRequirement {
  readonly category: string;
  readonly name: string;
  readonly description: string;
}

export interface FlowUnsupportedInfo {
  readonly reason: string;
  readonly requirements: readonly FlowUnsupportedRequirement[];
  readonly fallbackUrl?: string;
}

/** Terminal `create_entry` / `abort` step view with optional inline OAuth App Credentials setup. */
export function FlowResultStepView({
  step,
  domain,
  domainName,
  localization,
  isRepair = false,
  canSaveAppCredentials = false,
  busy = false,
  onSaveAppCredentials,
}: {
  readonly step: FlowStepRecord;
  readonly domain: string;
  readonly domainName: string;
  readonly localization: FlowLocalizationHelpers;
  readonly isRepair?: boolean;
  readonly canSaveAppCredentials?: boolean;
  readonly busy?: boolean;
  readonly onSaveAppCredentials?: (clientId: string, clientSecret: string) => void;
}) {
  const { theme } = useHausUi();
  const dark = theme.mode === 'dark';
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');

  const success = isCompletedFlowStep(step);
  const needsOAuthCreds =
    step.type === 'abort' &&
    canSaveAppCredentials &&
    Boolean(onSaveAppCredentials) &&
    (step.reason === 'missing_credentials' || step.reason === 'oauth_unauthorized');

  const headline =
    step.type === 'create_entry'
      ? isRepair
        ? `Repair applied for ${domainName}`
        : `Connected ${step.result?.title ?? step.title ?? domainName}`
      : localization.abortTitle(step.reason);

  const description =
    localization.description ??
    (success
      ? isRepair
        ? 'The repair completed and your integration is healthy.'
        : 'Integration setup completed and saved on your Hub.'
      : undefined);

  return (
    <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
      <ManagementGlassCard
        radius={22}
        padding={insets(22, 20)}
        attention={!success}
        style={{ layout: { width: pct(100) } }}
      >
        <Stack align="center" gapPx={10} style={{ layout: { width: pct(100) } }}>
          <Box
            style={{
              layout: {
                width: px(46),
                height: px(46),
                alignItems: 'center',
                justifyContent: 'center',
              },
              material: new SolidMaterial(
                success
                  ? rgba(52, 211, 153, dark ? 0.16 : 0.14)
                  : mixColor(transparentColor, colorToken('ink'), dark ? 0.1 : 0.06),
              ),
              border: {
                width: 1,
                color: success ? rgba(52, 211, 153, 0.4) : colorToken('border'),
              },
              corners: corners(999, 'round'),
            }}
          >
            <UiIcon
              name={success ? 'check-circle' : 'info'}
              size={22}
              color={success ? '#34d399' : undefined}
            />
          </Box>
          <Heading level={3} size={16.5} weight={600}>
            {headline}
          </Heading>
          {description && (
            <Text
              size={12.5}
              tone="muted"
              style={{ typography: { size: 12.5, align: 'center', lineHeight: 1.45 } }}
            >
              {description}
            </Text>
          )}
          {step.result?.entry_id && (
            <ManagementStatusPill label={`Saved on Hub · ${domainName}`} tone="success" showDot />
          )}
        </Stack>
      </ManagementGlassCard>

      {needsOAuthCreds && (
        <ManagementGlassCard
          radius={20}
          padding={insets(16)}
          style={{ layout: { width: pct(100), gap: px(10) } }}
        >
          <Row align="center" gapPx={8}>
            <UiIcon name="key-round" size={15} />
            <Text size={13} weight={600}>
              {`${domainName || domain} requires OAuth2 Application Credentials`}
            </Text>
          </Row>
          <Stack gapPx={6}>
            <Text size={12} weight={600}>
              OAuth Client ID *
            </Text>
            <TextInput
              id="flow-oauth-client-id"
              ariaLabel="OAuth Client ID"
              placeholder="Client ID"
              value={clientId}
              disabled={busy}
              onChange={setClientId}
              style={{
                layout: { width: pct(100), minHeight: px(38), padding: insets(8, 12) },
                material: new SolidMaterial(colorToken('surface')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(10),
                typography: { size: 13, color: colorToken('textPrimary') },
              }}
            />
          </Stack>
          <Stack gapPx={6}>
            <Text size={12} weight={600}>
              OAuth Client Secret
            </Text>
            <TextInput
              id="flow-oauth-client-secret"
              ariaLabel="OAuth Client Secret"
              inputType="password"
              placeholder="Client Secret (if issued)"
              value={clientSecret}
              disabled={busy}
              onChange={setClientSecret}
              style={{
                layout: { width: pct(100), minHeight: px(38), padding: insets(8, 12) },
                material: new SolidMaterial(colorToken('surface')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(10),
                typography: { size: 13, color: colorToken('textPrimary') },
              }}
            />
          </Stack>
          <Row justify="end">
            <HausButton
              id="flow-oauth-save-creds"
              variant="secondary"
              size="sm"
              disabled={busy || !clientId.trim()}
              onPress={() => onSaveAppCredentials?.(clientId.trim(), clientSecret.trim())}
            >
              <Text size={12}>Save credentials &amp; retry setup</Text>
            </HausButton>
          </Row>
        </ManagementGlassCard>
      )}
    </Stack>
  );
}

/** Fallback card when `evaluateFlowStep` reports HA-web-only selectors/steps. */
export function FlowUnsupportedView({
  unsupported,
  domainName,
  onOpenWeb,
}: {
  readonly unsupported: FlowUnsupportedInfo;
  readonly domainName: string;
  readonly onOpenWeb?: (url: string) => void;
}) {
  const { theme } = useHausUi();
  const primaryFg = theme.mode === 'dark' ? '#101010' : '#ffffff';

  return (
    <ManagementGlassCard
      radius={22}
      padding={insets(20)}
      attention
      style={{ layout: { width: pct(100), gap: px(12) } }}
    >
      <Row align="center" gapPx={10}>
        <UiIcon name="shield-alert" size={20} color="#fbbf24" />
        <Heading level={3} size={15.5} weight={600}>
          Setup requires Home Assistant Web
        </Heading>
      </Row>
      <Text size={12.5} tone="muted" style={{ typography: { size: 12.5, lineHeight: 1.45 } }}>
        {unsupported.reason ||
          `The setup flow for ${domainName} uses controls not yet natively supported in Haus.`}
      </Text>
      {unsupported.requirements.length > 0 && (
        <Stack gapPx={6} style={{ layout: { width: pct(100) } }}>
          {unsupported.requirements.map((req) => (
            <Row
              key={`${req.category}:${req.name}`}
              gapPx={6}
              style={{
                layout: { width: pct(100), padding: insets(8, 10) },
                material: new SolidMaterial(colorToken('surface')),
                border: { width: 1, color: colorToken('borderSubtle') },
                corners: corners(10),
              }}
            >
              <Text size={12} weight={600}>
                {req.name}:
              </Text>
              <Text size={12} tone="muted" style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                {req.description}
              </Text>
            </Row>
          ))}
        </Stack>
      )}
      {unsupported.fallbackUrl && onOpenWeb && (
        <Row justify="end">
          <HausButton
            id="flow-open-ha-web"
            variant="primary"
            size="sm"
            onPress={() => onOpenWeb(unsupported.fallbackUrl!)}
          >
            <Text
              size={12}
              style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
            >
              Open in Home Assistant Web
            </Text>
            <UiIcon name="external-link" size={13} color={primaryFg} />
          </HausButton>
        </Row>
      )}
    </ManagementGlassCard>
  );
}

/** Loading or retryable error state when a specific flow target has no loaded step yet. */
export function FlowTargetFallbackView({
  title,
  busy,
  onRetry,
  onBrowseAll,
}: {
  readonly title: string;
  readonly busy: boolean;
  readonly onRetry?: () => void;
  readonly onBrowseAll?: () => void;
}) {
  const { theme } = useHausUi();
  const primaryFg = theme.mode === 'dark' ? '#101010' : '#ffffff';

  return (
    <Stack
      align="center"
      gapPx={12}
      style={{ layout: { width: pct(100), padding: insets(28, 20), alignItems: 'center' } }}
    >
      {busy ? (
        <>
          <UiIcon name="loader-circle" size={24} />
          <Text size={13} weight={500}>
            {`Preparing setup for ${title}…`}
          </Text>
          <Text size={12} tone="muted">
            Connecting to your Haus Hub and loading configuration steps.
          </Text>
        </>
      ) : (
        <>
          <Text size={13} tone="muted">
            Setup could not be loaded automatically for this device.
          </Text>
          <Row gapPx={8} wrap>
            {onRetry && (
              <HausButton id="flow-target-retry" variant="primary" size="sm" onPress={onRetry}>
                <UiIcon name="refresh-cw" size={14} color={primaryFg} />
                <Text
                  size={12}
                  style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
                >
                  Retry
                </Text>
              </HausButton>
            )}
            {onBrowseAll && (
              <HausButton
                id="flow-target-browse"
                variant="secondary"
                size="sm"
                onPress={onBrowseAll}
              >
                <Text size={12}>Browse all integrations</Text>
              </HausButton>
            )}
          </Row>
        </>
      )}
    </Stack>
  );
}
