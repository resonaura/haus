/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { CommissioningService } from '../../src/commissioning/service.js';
import { CommissioningController } from '../../src/commissioning/controller.js';
import type { HomeKitControllerService } from '../../src/homekit/service.js';

const mockHomekit = {
  discoverAccessories: async () => [],
} as unknown as HomeKitControllerService;

function mockReq(homeId = 'test-home', clientId = 'client-1'): Request & {
  session?: { homeId?: string; clientId?: string };
} {
  return {
    headers: {},
    session: { homeId, clientId },
  } as unknown as Request & { session?: { homeId?: string; clientId?: string } };
}

describe('Hub Commissioning Discovery & Integration Flows (P18.8)', () => {
  it('deduplicates multi-source host announcements and tracks discovery lifecycle', async () => {
    const service = new CommissioningService(mockHomekit, undefined);
    const controller = new CommissioningController(service);

    // Initial discoveries list is empty
    const initial = controller.listDiscoveries();
    expect(initial).toEqual([]);

    // Step 1: Ingest DHCP announcement
    const d1 = controller.ingestAnnouncement({
      protocol: 'dhcp',
      mac: 'E8:4F:25:99:88:77',
      host: '192.168.1.180',
      name: 'living-room-axis',
      domain: 'axis',
    });

    expect(d1.id).toBe('mac:e84f25998877');
    expect(d1.status).toBe('discovered');
    expect(d1.authenticated).toBe(false); // Invariant!

    // Step 2: Ingest Zeroconf announcement for same physical device
    const d2 = controller.ingestAnnouncement({
      protocol: 'zeroconf',
      mac: 'e84f25998877',
      host: '192.168.1.180',
      port: 80,
      name: 'Axis M1065',
      domain: 'axis',
    });

    // Proves deduplication into same candidate
    expect(d2.id).toBe('mac:e84f25998877');
    expect(d2.port).toBe(80);
    expect(d2.secondaryProtocols).toContain('dhcp');
    expect(d2.secondaryProtocols).toContain('zeroconf');

    const list = controller.listDiscoveries();
    expect(list).toHaveLength(1);

    // Step 3: Ignore candidate
    const ignored = controller.ignoreDiscovery('mac:e84f25998877');
    expect(ignored.status).toBe('ignored');
    expect(controller.listDiscoveries({ status: 'discovered' })).toHaveLength(0);
    expect(controller.listDiscoveries({ status: 'ignored' })).toHaveLength(1);

    // Step 4: Unignore candidate
    const restored = controller.unignoreDiscovery('mac:e84f25998877');
    expect(restored.status).toBe('discovered');
    expect(controller.listDiscoveries({ status: 'discovered' })).toHaveLength(1);
  });

  it('runs an integration flow from discovery through validation, completion, and reconnect', async () => {
    const service = new CommissioningService(mockHomekit, undefined);
    const controller = new CommissioningController(service);

    // Ingest candidate device
    const candidate = controller.ingestAnnouncement({
      protocol: 'zeroconf',
      mac: '445566778899',
      host: '192.168.1.200',
      port: 80,
      domain: 'meross_lan',
      name: 'Meross Smart Plug',
    });

    const req = mockReq('home-main', 'user-1');

    // Step 1: Start integration flow from discovery candidate
    const step1 = await controller.startFlow(req, {
      domain: 'meross_lan',
      candidateId: candidate.id,
      source: 'discovery',
    });

    expect(step1.type).toBe('form');
    expect(step1.stepId).toBe('user');
    expect(step1.flowId).toBeDefined();

    // Verify candidate is locked in_progress
    const inProg = service.getDiscovery(candidate.id);
    expect(inProg?.status).toBe('in_progress');

    // Client reconnect test: GET /flows/:id returns exact same flow step
    const retrieved = await controller.getFlow(req, step1.flowId);
    expect(retrieved.flowId).toBe(step1.flowId);
    expect(retrieved.stepId).toBe('user');

    // Step 2: Submit step with missing required host
    const errStep = await controller.submitFlowStep(req, step1.flowId, {
      values: { host: '' },
    });
    expect(errStep.errors?.host).toBe('required');

    // Step 3: Submit valid step
    const completed = await controller.submitFlowStep(req, step1.flowId, {
      values: { host: '192.168.1.200', key: 'device_key' },
    });

    expect(completed.type).toBe('create_entry');
    expect(completed.result?.entryId).toBeDefined();

    // Verify candidate is now marked configured
    const configured = service.getDiscovery(candidate.id);
    expect(configured?.status).toBe('configured');
  });

  it('handles cancellation and releases in-progress candidate lock', async () => {
    const service = new CommissioningService(mockHomekit, undefined);
    const controller = new CommissioningController(service);

    const candidate = controller.ingestAnnouncement({
      protocol: 'zeroconf',
      mac: 'aabbcc112233',
      domain: 'meross_lan',
      name: 'Plug to Cancel',
    });

    const req = mockReq('home-main', 'user-1');
    const flow = await controller.startFlow(req, {
      domain: 'meross_lan',
      candidateId: candidate.id,
    });

    expect(service.getDiscovery(candidate.id)?.status).toBe('in_progress');

    // Cancel flow
    const cancelled = await controller.cancelFlow(req, flow.flowId);
    expect(cancelled.status).toBe('cancelled');

    // In-progress lock released back to discovered
    expect(service.getDiscovery(candidate.id)?.status).toBe('discovered');

    // Subsequent getFlow throws 404
    await expect(controller.getFlow(req, flow.flowId)).rejects.toThrowError(
      /Not Found|flow_not_found/,
    );
  });

  it('truthfully reports concrete missing capabilities for unsupported domains', async () => {
    const service = new CommissioningService(mockHomekit, undefined);
    const controller = new CommissioningController(service);

    const req = mockReq();
    const abortStep = await controller.startFlow(req, {
      domain: 'unsupported_custom_python_component',
    });

    expect(abortStep.type).toBe('abort');
    expect(abortStep.unsupportedRequirements).toBeDefined();
    expect(abortStep.unsupportedRequirements?.[0].category).toBe('runtime');
  });
});
