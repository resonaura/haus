/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { AuthRequest, ResponseType, makeRedirectUri } from 'expo-auth-session';
import { exchangeCodeAsync } from 'expo-auth-session';
import { normalizeHaBaseUrl } from '../storage/mobile-persistence';
import type { HaSession } from '../storage/mobile-persistence';

export const HA_OAUTH_CLIENT_ID =
  'https://raw.githubusercontent.com/resonaura/haus/main/apps/mobile/ha-client-metadata.json';
export const HA_OAUTH_REDIRECT_URI = makeRedirectUri({ scheme: 'haus', path: 'auth' });

interface OAuthMetadata {
  authorizationEndpoint: string;
  tokenEndpoint: string;
}

function safeEndpoint(value: unknown, base: URL): string | undefined {
  if (typeof value !== 'string') return;
  try {
    const endpoint = new URL(value, base);
    if (
      (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') ||
      endpoint.origin !== base.origin ||
      endpoint.username ||
      endpoint.password ||
      endpoint.hash
    )
      return;
    return endpoint.href;
  } catch {
    return;
  }
}

export async function discoverHaOAuth(
  input: string,
  fetcher: typeof fetch = fetch,
): Promise<{ url: string; metadata: OAuthMetadata }> {
  const url = normalizeHaBaseUrl(input);
  const base = new URL(url);
  const metadataUrl = new URL('/.well-known/oauth-authorization-server', base);
  const response = await fetcher(metadataUrl);
  if (!response.ok) throw new Error('Home Assistant did not provide OAuth discovery metadata.');
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Home Assistant returned invalid OAuth metadata.');
  const record = value as Record<string, unknown>;
  const methods = record.code_challenge_methods_supported;
  if (!Array.isArray(methods) || !methods.includes('S256'))
    throw new Error('This Home Assistant server does not advertise secure PKCE support.');
  const authorizationEndpoint = safeEndpoint(record.authorization_endpoint, base);
  const tokenEndpoint = safeEndpoint(record.token_endpoint, base);
  if (!authorizationEndpoint || !tokenEndpoint)
    throw new Error('Home Assistant returned unsafe OAuth endpoints.');
  return { url, metadata: { authorizationEndpoint, tokenEndpoint } };
}

export async function signInToHomeAssistant(
  discovered: Awaited<ReturnType<typeof discoverHaOAuth>>,
  prompt: (request: AuthRequest) => Promise<Awaited<ReturnType<AuthRequest['promptAsync']>>>,
): Promise<HaSession> {
  const request = new AuthRequest({
    clientId: HA_OAUTH_CLIENT_ID,
    redirectUri: HA_OAUTH_REDIRECT_URI,
    responseType: ResponseType.Code,
    scopes: [],
    usePKCE: true,
  });
  const result = await prompt(request);
  if (result.type === 'cancel' || result.type === 'dismiss') throw new Error('Sign-in cancelled.');
  if (result.type !== 'success' || !result.params.code)
    throw new Error('Home Assistant sign-in did not return an authorization code.');
  if (!request.state || result.params.state !== request.state)
    throw new Error('Home Assistant sign-in could not be verified. Please try again.');
  if (!request.codeVerifier) throw new Error('Secure PKCE verification could not be prepared.');

  const tokens = await exchangeCodeAsync(
    {
      clientId: HA_OAUTH_CLIENT_ID,
      code: result.params.code,
      redirectUri: HA_OAUTH_REDIRECT_URI,
      extraParams: { code_verifier: request.codeVerifier },
    },
    { tokenEndpoint: discovered.metadata.tokenEndpoint },
  );
  if (!tokens.accessToken || !tokens.refreshToken)
    throw new Error('Home Assistant did not return renewable sign-in credentials.');

  let name = 'Home Assistant';
  try {
    const configResponse = await fetch(new URL('/api/config', discovered.url), {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    if (configResponse.ok) {
      const config: unknown = await configResponse.json();
      if (
        config &&
        typeof config === 'object' &&
        'location_name' in config &&
        typeof config.location_name === 'string' &&
        config.location_name.trim()
      )
        name = config.location_name.trim();
    }
  } catch {
    // The websocket bootstrap remains authoritative; a temporary REST failure is not auth loss.
  }

  return {
    url: discovered.url,
    name,
    clientId: HA_OAUTH_CLIENT_ID,
    refreshToken: tokens.refreshToken,
  };
}
