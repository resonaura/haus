/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { CredentialCodec } from '@haus/core/provider';

export type HaCredential =
  | { readonly kind: 'token'; readonly accessToken: string }
  | {
      readonly kind: 'oauth';
      readonly accessToken: string;
      readonly refreshToken: string;
      readonly clientId: string;
      readonly expiresAt: number;
    };

export function credentialText(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= 16384 && value.trim() === value
  );
}

function parse(value: unknown): HaCredential | undefined {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('kind' in value) ||
    !('accessToken' in value) ||
    !credentialText(value.accessToken)
  )
    return;
  if (value.kind === 'token' && Object.keys(value).sort().join(',') === 'accessToken,kind')
    return { kind: 'token', accessToken: value.accessToken };
  if (
    value.kind !== 'oauth' ||
    !('refreshToken' in value) ||
    !credentialText(value.refreshToken) ||
    !('clientId' in value) ||
    !credentialText(value.clientId) ||
    !('expiresAt' in value) ||
    typeof value.expiresAt !== 'number' ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= 0 ||
    Object.keys(value).sort().join(',') !== 'accessToken,clientId,expiresAt,kind,refreshToken'
  )
    return;
  return {
    kind: 'oauth',
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    clientId: value.clientId,
    expiresAt: value.expiresAt,
  };
}

export const haCredentialCodec: CredentialCodec<HaCredential> = {
  encode(value) {
    const credential = parse(value);
    if (!credential) throw Error('invalid_ha_credential');
    return new TextEncoder().encode(JSON.stringify({ version: 1, credential }));
  },
  decode(bytes) {
    try {
      if (bytes.byteLength > 65536) throw Error('invalid_ha_credential');
      const envelope: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (
        !envelope ||
        typeof envelope !== 'object' ||
        Array.isArray(envelope) ||
        !('version' in envelope) ||
        envelope.version !== 1 ||
        !('credential' in envelope) ||
        Object.keys(envelope).sort().join(',') !== 'credential,version'
      )
        throw Error('invalid_ha_credential');
      const credential = parse(envelope.credential);
      if (!credential) throw Error('invalid_ha_credential');
      return credential;
    } catch {
      throw Error('invalid_ha_credential');
    }
  },
};
