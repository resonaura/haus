/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export type FlowType = 'form' | 'oauth' | 'reauth' | 'options';

export type FormFieldType = 'string' | 'number' | 'boolean' | 'select' | 'pin';

export interface FlowFormField {
  readonly name: string;
  readonly type: FormFieldType;
  readonly label: string;
  readonly required?: boolean;
  readonly choices?: readonly string[];
  readonly defaultValue?: unknown;
}

/** Interactive configuration flow step (e.g. 2FA, OAuth, reauthentication). */
export interface InteractiveFlow {
  readonly id: string;
  readonly type: FlowType;
  readonly step: string;
  readonly title: string;
  readonly description?: string;
  readonly fields?: readonly FlowFormField[];
  readonly countdownSeconds?: number;
  readonly oauthUrl?: string;
  readonly returnUrl?: string;
}

/** Creates a 2FA verification step with an active countdown timer. */
export function createTwoFactorFlow(
  flowId: string,
  targetName: string,
  countdownSeconds = 60,
): InteractiveFlow {
  return {
    id: flowId,
    type: 'form',
    step: '2fa',
    title: `Two-Factor Authentication: ${targetName}`,
    description: `Enter the verification code sent to your phone or email. Code expires in ${countdownSeconds}s.`,
    countdownSeconds,
    fields: [
      {
        name: 'pin',
        type: 'pin',
        label: 'Verification Code',
        required: true,
      },
    ],
  };
}

/** Creates an OAuth 2.0 authorization step. */
export function createOAuthFlow(
  flowId: string,
  targetName: string,
  oauthUrl: string,
  returnUrl: string,
): InteractiveFlow {
  return {
    id: flowId,
    type: 'oauth',
    step: 'oauth_redirect',
    title: `Authorize ${targetName}`,
    description: `Complete authorization in your browser window.`,
    oauthUrl,
    returnUrl,
  };
}

/** Creates a non-destructive reauthentication flow on expired credentials. */
export function createReauthFlow(
  flowId: string,
  integrationName: string,
  fields: readonly FlowFormField[],
): InteractiveFlow {
  return {
    id: flowId,
    type: 'reauth',
    step: 'reauth_credentials',
    title: `Re-authenticate ${integrationName}`,
    description:
      'Your existing session has expired. Update credentials to restore connection without re-pairing.',
    fields,
  };
}
