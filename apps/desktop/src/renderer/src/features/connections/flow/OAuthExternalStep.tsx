/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { Box, HausButton, Heading, Pressable, Text, TextInput } from '@haus/ui';
import { ExternalLink, KeyRound } from 'lucide-react';
import { nativeApi, rest, type FlowStep } from '../../../ha/management';

function parseCallbackInput(rawInput: string): { state?: string; code?: string; error?: string } {
  const trimmed = rawInput.trim();
  if (!trimmed) return {};
  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get('code') ?? undefined;
    const state = url.searchParams.get('state') ?? undefined;
    const error = url.searchParams.get('error') ?? undefined;
    if (code || state || error) {
      return { state, code, error };
    }
  } catch {
    /* Treat non-URL text as raw OAuth authorization code. */
  }
  return { code: trimmed };
}

/** Renders Home Assistant OAuth2 external browser sign-in plus optional Hub redirect-URL relay. */
export function OAuthExternalStep({
  domain,
  domainName,
  step,
  isOptions,
  isHubSession,
  description,
  onStep,
  onError,
}: {
  domain: string;
  domainName?: string;
  step: FlowStep;
  isOptions: boolean;
  isHubSession: boolean;
  description: string;
  onStep: (next: FlowStep) => void;
  onError: (msg: string) => void;
}) {
  const [showManual, setShowManual] = useState(false);
  const [callbackInput, setCallbackInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submitManualCallback = async () => {
    const parsed = parseCallbackInput(callbackInput);
    if (!parsed.code && !parsed.error) {
      onError('Paste the redirect URL or authorization code from your browser.');
      return;
    }
    setSubmitting(true);
    onError('');
    try {
      const next = await rest<FlowStep>('POST', 'commissioning/oauth/callback', {
        flowId: step.flow_id,
        ...(parsed.state ? { state: parsed.state } : {}),
        ...(parsed.code ? { code: parsed.code } : {}),
        ...(parsed.error ? { error: parsed.error } : {}),
      });
      onStep(next);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to complete authorization.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box className="flow-prepare">
      <ExternalLink size={30} />
      <Heading level={3}>Sign in with {domainName || domain}</Heading>
      <Text semantic="p" className="flow-description">
        {description}
      </Text>
      <HausButton
        onPress={() =>
          void nativeApi()
            .openIntegrationLogin(step.flow_id, isOptions)
            .catch((e) => onError(e instanceof Error ? e.message : String(e)))
        }
      >
        Continue to sign in
        <ExternalLink size={15} />
      </HausButton>
      {isHubSession && (
        <Box className="management-expandable">
          <Pressable className="management-link-btn" onPress={() => setShowManual((prev) => !prev)}>
            {showManual
              ? 'Hide manual redirect helper'
              : 'Finished in browser and did not auto-return?'}
          </Pressable>
          {showManual && (
            <Box className="management-fields">
              <Text semantic="label" className="management-field">
                <Text>Redirect URL or authorization code</Text>
                <TextInput
                  inputType="text"
                  placeholder="https://my.home-assistant.io/redirect/oauth?code=…&state=…"
                  value={callbackInput}
                  onChange={setCallbackInput}
                />
              </Text>
              <HausButton
                variant="secondary"
                isPending={submitting}
                isDisabled={submitting || !callbackInput.trim()}
                onPress={() => void submitManualCallback()}
              >
                Complete authorization
              </HausButton>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

/** Inline Hub Application Credentials setup when an OAuth2 integration aborts with `missing_credentials`. */
export function ApplicationCredentialsPrompt({
  domain,
  domainName,
  onRetry,
  onError,
}: {
  domain: string;
  domainName?: string;
  onRetry: () => void;
  onError: (msg: string) => void;
}) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [saving, setSaving] = useState(false);

  const saveAndRetry = async () => {
    if (!clientId.trim()) {
      onError('Enter your OAuth Client ID.');
      return;
    }
    setSaving(true);
    onError('');
    try {
      await rest('POST', 'commissioning/application-credentials', {
        domain,
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      });
      onRetry();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save application credentials.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box className="management-fields management-credentials-box">
      <Box className="management-notice">
        <KeyRound size={15} /> {domainName || domain} requires an OAuth2 Client ID &amp; Secret to
        sign in.
      </Box>
      <Text semantic="label" className="management-field">
        <Text>OAuth Client ID *</Text>
        <TextInput
          inputType="text"
          value={clientId}
          onChange={setClientId}
          placeholder="Client ID"
        />
      </Text>
      <Text semantic="label" className="management-field">
        <Text>OAuth Client Secret</Text>
        <TextInput
          inputType="password"
          value={clientSecret}
          onChange={setClientSecret}
          placeholder="Client Secret (if issued)"
        />
      </Text>
      <HausButton
        variant="secondary"
        isPending={saving}
        isDisabled={saving || !clientId.trim()}
        onPress={() => void saveAndRetry()}
      >
        Save credentials &amp; retry setup
      </HausButton>
    </Box>
  );
}
