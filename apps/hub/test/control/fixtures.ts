/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host, Integration } from '../../src/control/index.js';
import type {
  ControlPermissions,
  IntegrationDefinition,
  IntegrationProvider,
  LocalRecovery,
} from '../../src/control/index.js';
import type { IntegrationRef } from '@haus/core/session';
import type { Command } from '@haus/core/types';

const hosts: Host[] = [],
  integrations: Integration<string>[] = [],
  roots: string[] = [];
const locations = new WeakMap<Host, string>();
afterEach(async () => {
  for (const integration of integrations.splice(0)) await integration.close();
  for (const host of hosts.splice(0)) await host.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});
export const resource: IntegrationRef = { homeId: 'house', kind: 'integration', id: 'provider' };
export const codec = {
  encode: (credential: string) => new TextEncoder().encode(credential),
  decode: (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(bytes),
};
export const command: Command = {
  id: 'command',
  endpointId: 'endpoint',
  capabilityId: 'power',
  operation: 'on',
  arguments: {},
};

export class Provider implements IntegrationProvider<string> {
  open = vi.fn<IntegrationProvider<string>['open']>(async () => {});
  execute = vi.fn<IntegrationProvider<string>['execute']>(async () => ({ status: 'accepted' }));
  refresh = vi.fn<IntegrationProvider<string>['refresh']>(async () => ({
    status: 'renewed',
    credential: 'replacement-fixture-token',
  }));
  close = vi.fn<IntegrationProvider<string>['close']>(async () => {});
}

export async function host(directory?: string): Promise<Host> {
  if (!directory) {
    directory = await mkdtemp(join(tmpdir(), 'haus-integration-'));
    roots.push(directory);
  }
  const result = await Host.open({ directory, homeId: 'house', hubId: 'hub' });
  hosts.push(result);
  locations.set(result, directory);
  return result;
}

export function directory(host: Host): string {
  const path = locations.get(host);
  if (!path) throw Error('fixture_host_missing');
  return path;
}

export function attach(host: Host, prepare?: (provider: Provider) => void, reference = resource) {
  const providers: Provider[] = [];
  const definition: IntegrationDefinition<string> & {
    create: ReturnType<typeof vi.fn<IntegrationDefinition<string>['create']>>;
  } = {
    resource: reference,
    codec,
    create: vi.fn(() => {
      const provider = new Provider();
      prepare?.(provider);
      providers.push(provider);
      return provider;
    }),
  };
  const permissions = { authorize: vi.fn<ControlPermissions['authorize']>(async () => true) };
  const recovery = {
    fence: vi.fn<LocalRecovery['fence']>(async () => {
      throw Error('no_verified_proof');
    }),
  };
  const integration = new Integration(host, definition, permissions, recovery, 150);
  integrations.push(integration);
  return {
    host,
    definition,
    permissions,
    recovery,
    integration,
    providers,
    current: () => {
      const provider = providers.at(-1);
      if (!provider) throw Error('fixture_provider_missing');
      return provider;
    },
  };
}

/** Stop fixture I/O but deliberately retain Connected metadata to model an interrupted process. */
export async function crash(test: ReturnType<typeof attach>): Promise<void> {
  for (const provider of test.providers) await provider.close();
  const index = integrations.indexOf(test.integration);
  if (index < 0) throw Error('fixture_integration_missing');
  integrations.splice(index, 1);
  await test.host.close();
}
