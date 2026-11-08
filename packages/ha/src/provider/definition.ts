/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { IntegrationRef } from '@haus/core/session';
import type { CredentialCodec, Provider, ProviderContext } from '@haus/core/provider';
import { haCredentialCodec, type HaCredential } from './credential.js';
import { haProviderAddress, type HaProviderAddress } from './address.js';
import { HaProvider, type HaProviderOptions } from './provider.js';

export interface HaIntegrationDefinition {
  readonly resource: IntegrationRef;
  readonly codec: CredentialCodec<HaCredential>;
  create(context: ProviderContext<HaCredential>): Provider<HaCredential>;
}

export function haIntegrationDefinition(
  resource: IntegrationRef,
  address: HaProviderAddress | string,
  options?: HaProviderOptions,
): HaIntegrationDefinition {
  return {
    resource: Object.freeze({ ...resource }),
    codec: haCredentialCodec,
    create(context) {
      const resolved = typeof address === 'string' ? haProviderAddress(address) : address;
      return new HaProvider(resolved, context, options);
    },
  };
}
