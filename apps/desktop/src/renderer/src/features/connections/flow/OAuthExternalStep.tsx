/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { Button } from '@heroui/react';
import { ExternalLink, KeyRound } from 'lucide-react';
import { humanize, nativeApi, rest, type FlowStep } from '../../../ha/management';

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
  step,
  isOptions,
  isHubSession,
  description,
  onStep,
  onError,
}: {
  domain: string;
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
    <div className="flow-prepare">
      <ExternalLink size={30} />
      <h3>Sign in with {humanize(domain)}</h3>
      <p className="flow-description">{description}</p>
      <Button
        onPress={() =>
          void nativeApi()
            .openIntegrationLogin(step.flow_id, isOptions)
            .catch((e) => onError(e instanceof Error ? e.message : String(e)))
        }
      >
        Continue to sign in
        <ExternalLink size={15} />
      </Button>
      {isHubSession && (
        <div className="management-expandable">
          <button
            type="button"
            className="management-link-btn"
            onClick={() => setShowManual((prev) => !prev)}
          >
            {showManual
              ? 'Hide manual redirect helper'
              : 'Finished in browser and did not auto-return?'}
          </button>
          {showManual && (
            <div className="management-fields">
              <label className="management-field">
                <span>Redirect URL or authorization code</span>
                <input
                  type="text"
                  placeholder="https://my.home-assistant.io/redirect/oauth?code=…&state=…"
                  value={callbackInput}
                  onChange={(e) => setCallbackInput(e.target.value)}
                />
              </label>
              <Button
                variant="secondary"
                isPending={submitting}
                isDisabled={submitting || !callbackInput.trim()}
                onPress={() => void submitManualCallback()}
              >
                Complete authorization
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Inline Hub Application Credentials setup when an OAuth2 integration aborts with `missing_credentials`. */
export function ApplicationCredentialsPrompt({
  domain,
  onRetry,
  onError,
}: {
  domain: string;
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
    <div className="management-fields management-credentials-box">
      <div className="management-notice">
        <KeyRound size={15} /> {humanize(domain)} requires an OAuth2 Client ID &amp; Secret to sign
        in.
      </div>
      <label className="management-field">
        <span>OAuth Client ID *</span>
        <input
          type="text"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="Client ID"
        />
      </label>
      <label className="management-field">
        <span>OAuth Client Secret</span>
        <input
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          placeholder="Client Secret (if issued)"
        />
      </label>
      <Button
        variant="secondary"
        isPending={saving}
        isDisabled={saving || !clientId.trim()}
        onPress={() => void saveAndRetry()}
      >
        Save credentials &amp; retry setup
      </Button>
    </div>
  );
}
