/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { nativeApi } from '../../../ha/management';

interface TuyaLoginState {
  readonly loggedIn: boolean;
  readonly region: string;
  readonly regions: ReadonlyArray<{ id: string; name: string }>;
}

export interface TuyaQrChallenge {
  readonly token: string;
  readonly qrPayload: string;
}

interface TuyaQrPoll {
  readonly loggedIn: boolean;
  readonly error?: string;
}

export function readTuyaLoginState(bridgeId: string): Promise<TuyaLoginState> {
  return nativeApi().nativeProviders({ operation: 'loginState', bridgeId });
}

export async function startTuyaQr(bridgeId: string, region: string): Promise<TuyaQrChallenge> {
  const challenge = await nativeApi().nativeProviders<Partial<TuyaQrChallenge>>({
    operation: 'loginQrStart',
    bridgeId,
    region,
  });
  if (
    typeof challenge?.token !== 'string' ||
    !challenge.token.trim() ||
    typeof challenge.qrPayload !== 'string' ||
    !challenge.qrPayload.trim()
  ) {
    throw new Error('invalid_tuya_qr_response');
  }
  return { token: challenge.token, qrPayload: challenge.qrPayload };
}

export async function pollTuyaQr(bridgeId: string, token: string): Promise<TuyaQrPoll> {
  try {
    const result = await nativeApi().nativeProviders<TuyaQrPoll>({
      operation: 'loginQrPoll',
      bridgeId,
      token,
    });
    if (result.loggedIn || !result.error) return result;
    const state = await readTuyaLoginState(bridgeId).catch(() => undefined);
    return state?.loggedIn === true ? { loggedIn: true } : result;
  } catch (error) {
    if (tuyaQrFailure(error, 'poll').retryable) {
      // The bridge may have saved the login even if inventory refresh or the poll reply timed out.
      const state = await readTuyaLoginState(bridgeId).catch(() => undefined);
      if (state?.loggedIn === true) return { loggedIn: true };
    }
    throw error;
  }
}

export function tuyaQrFailure(
  error: unknown,
  operation: 'check' | 'start' | 'poll',
): { message: string; retryable: boolean } {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const match = /The Hub request failed \((\d{3})(?:: ([a-z0-9_]+))?\)\.?$/.exec(text);
  const status = match?.[1];
  const code = match?.[2] ?? text;
  if (status === '401' || status === '403' || code === 'administrator_required') {
    return {
      message: 'Sign in to Haus with a home administrator account to connect Tuya cameras.',
      retryable: false,
    };
  }
  if (status === '404' && code === 'native_provider_not_found') {
    return { message: 'Pair Tuya Camera Bridge again before signing in.', retryable: false };
  }
  if (code === 'invalid_tuya_region' || text.endsWith('Invalid Tuya region.')) {
    return { message: 'Choose a supported region for your Tuya account.', retryable: false };
  }
  if (code === 'invalid_qr_token' || text.endsWith('Invalid Tuya QR token.')) {
    return { message: 'Refresh the Tuya QR code and scan the new code.', retryable: false };
  }
  const retryable =
    status === '502' ||
    status === '503' ||
    status === '504' ||
    /could not reach the Haus Hub|fetch failed|timed out|timeout/i.test(text);
  const message = {
    check: 'Could not check the Tuya Bridge sign-in. Use Refresh QR to request a new code.',
    start: 'Could not get a QR code from Tuya Camera Bridge. Use Refresh QR to try again.',
    poll: 'Could not verify the Tuya scan. Use Refresh QR to start a new sign-in.',
  }[operation];
  return { message, retryable };
}
