/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import {
  ControlService,
  handleControlRoute,
  Host,
  OsProcessRecovery,
} from '../../src/control/index.js';
import type { IntegrationDefinition } from '../../src/control/index.js';
import { codec, command, directory, host, Provider, resource } from './fixtures.js';

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

function listen(
  handler: (req: any, res: any) => Promise<void>,
): Promise<{ server: Server; url: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    servers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
    server.on('error', reject);
  });
}

function createTestDefinition(prepare?: (p: Provider) => void): {
  definition: IntegrationDefinition<string>;
  providers: Provider[];
} {
  const providers: Provider[] = [];
  const definition: IntegrationDefinition<string> = {
    resource,
    codec,
    create: vi.fn(() => {
      const provider = new Provider();
      prepare?.(provider);
      providers.push(provider);
      return provider;
    }),
  };
  return { definition, providers };
}

it('authenticates control routes and rejects unauthorized access', async () => {
  const testHost = await host();
  const { definition, providers } = createTestDefinition();
  let permit = true;
  const permissions = {
    authorize: vi.fn(async () => permit),
  };
  const service = new ControlService({ host: testHost, permissions });
  service.register(definition);

  let authenticatedActor: string | undefined;
  const { url } = await listen(async (req, res) => {
    const handled = await handleControlRoute(req, res, req.url || '/', {
      service,
      actorId: authenticatedActor,
    });
    if (!handled) {
      res.writeHead(404).end();
    }
  });

  // 1. Unauthenticated request -> 401
  const unauthRes = await fetch(`${url}/api/control/integrations/provider/session`);
  expect(unauthRes.status).toBe(401);
  expect(await unauthRes.json()).toEqual({ error: 'authentication_required' });

  // 2. Authenticated but permission denied -> 403
  authenticatedActor = 'user-alice';
  permit = false;
  const deniedRes = await fetch(`${url}/api/control/integrations/provider/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: 'my-token' }),
  });
  expect(deniedRes.status).toBe(403);
  expect(await deniedRes.json()).toEqual({ error: 'control_permission_denied' });

  // 3. Authenticated and permitted -> connects successfully
  permit = true;
  const connectRes = await fetch(`${url}/api/control/integrations/provider/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: 'my-token' }),
  });
  expect(connectRes.status).toBe(200);
  expect(await connectRes.json()).toEqual({ status: 'connected' });
  expect(providers[0].open).toHaveBeenCalledWith('my-token', expect.any(AbortSignal));

  // 4. Session status check
  const sessionRes = await fetch(`${url}/api/control/integrations/provider/session`);
  expect(sessionRes.status).toBe(200);
  expect(await sessionRes.json()).toMatchObject({
    state: 'connected',
    generation: 1,
    owner: { hubId: 'hub', processId: testHost.owner.processId },
  });

  await service.close();
});

it('dispatches commands through API and preserves unknown physical-action outcomes across restart', async () => {
  const dir = directory(await host());
  const host1 = await Host.open({ directory: dir, homeId: 'house', hubId: 'hub' });
  const { definition: def1 } = createTestDefinition((p) => {
    p.execute.mockRejectedValueOnce(Error('transport-lost'));
  });

  const service1 = new ControlService({ host: host1 });
  service1.register(def1);

  const { url: url1 } = await listen(async (req, res) => {
    await handleControlRoute(req, res, req.url || '/', {
      service: service1,
      actorId: 'admin-user',
    });
  });

  // Connect integration
  await fetch(`${url1}/api/control/integrations/provider/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: 'token-1' }),
  });

  // Execute command that experiences lost acknowledgement
  const cmdPayload = {
    idempotencyKey: 'cmd-intent-1',
    command: { ...command, arguments: { value: 42 } },
  };
  const execRes = await fetch(`${url1}/api/control/integrations/provider/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cmdPayload),
  });
  expect(execRes.status).toBe(200);
  const unknownReceipt = (await execRes.json()).receipt;
  expect(unknownReceipt).toMatchObject({ status: 'unknown' });

  // Clean shutdown of first host and service
  await service1.close();

  // Restart: simulate new process starting against the same data directory
  const host2 = await Host.open({ directory: dir, homeId: 'house', hubId: 'hub' });
  const { definition: def2, providers: providers2 } = createTestDefinition();
  const service2 = new ControlService({ host: host2 });
  service2.register(def2);

  const { url: url2 } = await listen(async (req, res) => {
    await handleControlRoute(req, res, req.url || '/', {
      service: service2,
      actorId: 'admin-user',
    });
  });

  // Resume integration under new generation
  const resumeRes = await fetch(`${url2}/api/control/integrations/provider/resume`, {
    method: 'POST',
  });
  expect(resumeRes.status).toBe(200);
  expect(await resumeRes.json()).toEqual({ status: 'connected' });
  expect(providers2[0].open).toHaveBeenCalledWith('token-1', expect.any(AbortSignal));

  // Replay of the previous command with same idempotencyKey:
  // Must return the recorded unknown receipt and NEVER re-execute on provider2!
  const replayRes = await fetch(`${url2}/api/control/integrations/provider/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cmdPayload),
  });
  expect(replayRes.status).toBe(200);
  expect((await replayRes.json()).receipt).toEqual(unknownReceipt);
  expect(providers2[0].execute).not.toHaveBeenCalled();

  // Conflicting command with same idempotencyKey but different operation: rejects with 409
  const conflictRes = await fetch(`${url2}/api/control/integrations/provider/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: 'cmd-intent-1',
      command: { ...command, operation: 'off' },
    }),
  });
  expect(conflictRes.status).toBe(409);
  expect(await conflictRes.json()).toEqual({ error: 'command_idempotency_conflict' });

  // Fresh command with new idempotency key: dispatches to provider2 and succeeds
  const freshRes = await fetch(`${url2}/api/control/integrations/provider/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: 'cmd-intent-2',
      command: { ...command, operation: 'on' },
    }),
  });
  expect(freshRes.status).toBe(200);
  expect((await freshRes.json()).receipt).toMatchObject({ status: 'accepted' });
  expect(providers2[0].execute).toHaveBeenCalledTimes(1);

  await service2.close();
});

it('retains blocked state for interrupted token refresh across restart', async () => {
  const dir = directory(await host());
  const host1 = await Host.open({ directory: dir, homeId: 'house', hubId: 'hub' });
  const { definition: def1 } = createTestDefinition();
  const service1 = new ControlService({ host: host1 });
  service1.register(def1);

  await service1.connect('admin', 'provider', 'token-1');
  const grant = await host1.sessions.read(resource);
  if (!grant) throw Error('missing_grant');

  // Begin refresh that is interrupted before completion
  await host1.vault(codec).begin(grant, 'interrupted-attempt');

  // Crash simulation: host terminates without closing integration/vault
  await host1.close();

  // Second process starts
  const host2 = await Host.open({ directory: dir, homeId: 'house', hubId: 'hub' });
  const { definition: def2, providers: providers2 } = createTestDefinition();
  const service2 = new ControlService({ host: host2 });
  service2.register(def2);

  // Resume detects that credential is blocked/pending -> returns reauth-required
  const status = await service2.resume('admin', 'provider');
  expect(status).toBe('reauth-required');
  expect(providers2.length).toBe(0);

  // New sign-in restores ready credential
  await service2.connect('admin', 'provider', 'new-token');
  expect(providers2[0].open).toHaveBeenCalledWith('new-token', expect.any(AbortSignal));

  await service2.close();
});

it('enforces ordered shutdown: integrations close before host transactions drain', async () => {
  const testHost = await host();
  const { definition, providers } = createTestDefinition();
  const service = new ControlService({ host: testHost });
  service.register(definition);

  await service.connect('user', 'provider', 'token-val');
  expect(providers[0].open).toHaveBeenCalled();

  let integrationClosedBeforeHost = false;
  providers[0].close.mockImplementation(async () => {
    // Check that host is still open while integration is closing
    expect(() => testHost.vault(codec)).not.toThrow();
    integrationClosedBeforeHost = true;
  });

  await service.close();
  expect(integrationClosedBeforeHost).toBe(true);
  expect(providers[0].close).toHaveBeenCalledTimes(1);

  // Host is now closed
  expect(() => testHost.vault(codec)).toThrow('host_closed');
  await expect(service.connect('user', 'provider', 'token')).rejects.toThrow(
    'control_service_closed',
  );
});

it('OsProcessRecovery verifies terminated process and rejects unverified recovery', async () => {
  const testHost = await host();
  const recovery = new OsProcessRecovery(testHost.files);

  const prevRecord = {
    resource,
    owner: { hubId: 'hub', processId: 'old-process-id' },
    generation: 1,
    state: 'connected' as const,
  };
  const currentOwner = { hubId: 'hub', processId: 'current-process-id' };

  // 1. Foreign hub rejects
  await expect(
    recovery.fence(
      { ...prevRecord, owner: { hubId: 'foreign-hub', processId: 'old-id' } },
      currentOwner,
    ),
  ).rejects.toThrow('integration_local_recovery_unavailable');

  // 2. Same processId rejects
  await expect(
    recovery.fence(
      { ...prevRecord, owner: { hubId: 'hub', processId: 'current-process-id' } },
      currentOwner,
    ),
  ).rejects.toThrow('integration_local_recovery_unavailable');

  // 3. Process lease file matching old-process-id with a definitely dead PID (e.g. 999999)
  await testHost.files.publish(
    'process',
    Buffer.from(
      JSON.stringify({
        version: 1,
        hubId: 'hub',
        processId: 'old-process-id',
        pid: 999999, // Unlikely to exist
        startedAt: Date.now() - 5000,
      }),
    ),
  );

  // Must verify dead PID and succeed
  await expect(recovery.fence(prevRecord, currentOwner)).resolves.toBeUndefined();

  // 4. Missing or corrupted process lease rejects
  await testHost.files.remove('process');
  await expect(recovery.fence(prevRecord, currentOwner)).rejects.toThrow(
    'integration_recovery_unverified',
  );

  await testHost.close();
});
