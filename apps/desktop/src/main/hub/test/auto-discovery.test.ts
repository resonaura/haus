/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import { IntegrationFlowEngine, type DiscoveredCandidate } from '@haus/core';
import { validateRequest } from '../../validation.js';
import { HubIntegrationFlowManager } from '../flows.js';
import { normalizeCoreStepToHaStep } from '../management/normalize.js';

describe('Hub desktop auto-discovery dispatch, dedup, scan, and ignore', () => {
  it('starts real integration flows with candidateId, deduplicates HomeKit vs Hue, ignores, and scans', async () => {
    const engine = new IntegrationFlowEngine();
    const candidates: DiscoveredCandidate[] = [
      {
        id: 'hue:bsb002:192.168.5.88',
        domain: 'hue',
        protocol: 'zeroconf',
        secondaryProtocols: [],
        name: 'Philips hue - ABC123',
        authenticated: false,
        durableIdentities: [{ kind: 'mac', value: 'mac:001788aabbcc' }],
        addresses: ['192.168.5.88'],
        port: 80,
        status: 'discovered',
        details: { md: 'BSB002' },
        discoveredAt: 1,
        updatedAt: 1,
      },
      {
        id: 'generic:noise:192.168.5.99',
        domain: 'generic',
        protocol: 'dhcp',
        secondaryProtocols: [],
        name: 'workstation',
        authenticated: false,
        durableIdentities: [{ kind: 'mac', value: 'mac:112233445566' }],
        addresses: ['192.168.5.99'],
        status: 'discovered',
        details: {},
        discoveredAt: 1,
        updatedAt: 1,
      },
      {
        id: 'homekit:outlet:192.168.5.120',
        domain: 'homekit_controller',
        protocol: 'zeroconf',
        secondaryProtocols: [],
        name: 'Eve Energy',
        authenticated: false,
        durableIdentities: [{ kind: 'mac', value: 'mac:aabbcc112233' }],
        addresses: ['192.168.5.120'],
        port: 80,
        status: 'discovered',
        details: { sf: '1' },
        discoveredAt: 1,
        updatedAt: 1,
      },
    ];

    const ignoredIds = new Set<string>();
    const startedBodies: Array<Record<string, unknown>> = [];
    let scanCalls = 0;

    const manager = new HubIntegrationFlowManager(
      async (path, init) => {
        if (path === '/api/discovery/homekit?timeoutMs=1500') {
          return {
            discovered: [
              // Duplicate raw HAP advertisement for Philips Hue BSB002 -> must be suppressed
              {
                id: '00:17:88:AA:BB:CC',
                name: 'Philips hue - ABC123',
                model: 'BSB002',
                address: '192.168.5.88',
                port: 80,
                category: 2,
                paired: false,
                configNumber: 1,
              },
              // Unpaired generic HomeKit outlet matching homekit_controller candidate -> hk_disc_ takes HAP pairing
              {
                id: 'AA:BB:CC:11:22:33',
                name: 'Eve Energy',
                model: 'Eve Energy',
                address: '192.168.5.120',
                port: 80,
                category: 7,
                paired: false,
                configNumber: 2,
              },
            ],
            pairings: [],
          };
        }
        if (path === '/api/commissioning/discoveries/scan' && init?.method === 'POST') {
          scanCalls += 1;
          return { scanned: candidates.length };
        }
        if (path === '/api/commissioning/discoveries') {
          return candidates.filter((c) => !ignoredIds.has(c.id));
        }
        if (path.startsWith('/api/commissioning/discoveries/') && path.endsWith('/ignore')) {
          const encoded = path.slice('/api/commissioning/discoveries/'.length, -'/ignore'.length);
          ignoredIds.add(decodeURIComponent(encoded));
          return { ignored: true };
        }
        if (path === '/api/commissioning/flows' && init?.method === 'POST') {
          const body = init.body as Record<string, unknown>;
          startedBodies.push(body);
          return engine.startFlow({
            domain: String(body.domain),
            source: 'discovery',
            candidateId: typeof body.candidateId === 'string' ? body.candidateId : undefined,
            homeId: 'home-1',
            userId: 'user-1',
          });
        }
        return {};
      },
      async () => {},
      async () => [],
    );

    expect(validateRequest({ type: 'haus/discovery/scan' })).toEqual({
      type: 'haus/discovery/scan',
    });
    expect(validateRequest({ type: 'config_entries/ignore_flow', flow_id: 'f1' })).toBeTruthy();

    await manager.scanDiscovery();
    expect(scanCalls).toBe(1);

    const progress = await manager.listFlowProgress();
    const handlers = progress.map((p) => p.handler);
    expect(handlers).toEqual(['hue', 'homekit_controller']);
    expect(handlers).not.toContain('generic');

    const hueFlow = progress.find((p) => p.handler === 'hue') as { flow_id: string };
    expect(hueFlow.flow_id).toMatch(/^comm_disc_/);

    // Opening discovered Hue flow starts a native commissioning flow (not HomeKit PIN form!)
    const step = normalizeCoreStepToHaStep(
      await manager.handleManagement({
        method: 'GET',
        path: `config/config_entries/flow/${hueFlow.flow_id}`,
      }),
    );
    expect(startedBodies).toHaveLength(1);
    expect(startedBodies[0]).toMatchObject({
      domain: 'hue',
      source: 'discovery',
      candidateId: 'hue:bsb002:192.168.5.88',
    });
    expect(step.handler).toBe('hue');
    expect(step.step_id).not.toBe('pair');
    expect(step.flow_id).toBe(hueFlow.flow_id);

    // Ignoring a discovered commissioning flow persists ignore on Hub and hides it from progress
    await manager.ignoreFlow(hueFlow.flow_id);
    expect(ignoredIds.has('hue:bsb002:192.168.5.88')).toBe(true);

    const afterIgnore = await manager.listFlowProgress();
    expect(afterIgnore.map((p) => p.handler)).toEqual(['homekit_controller']);

    // Ignoring HomeKit discovery removes it as well
    const hkFlow = afterIgnore[0] as { flow_id: string };
    await manager.ignoreFlow(hkFlow.flow_id);
    expect(await manager.listFlowProgress()).toEqual([]);
  });

  it('falls back to native HomeKit PIN form or user flow when discovery_flow_unavailable is returned', async () => {
    const startedSources: Array<{ domain: unknown; source: unknown }> = [];
    const manager = new HubIntegrationFlowManager(
      async (path, init) => {
        if (path === '/api/commissioning/discoveries') {
          return [
            {
              id: 'homekit:aa:bb:cc:dd:ee:ff',
              protocol: 'homekit',
              domain: 'homekit_controller',
              name: 'Indoor Cam E220-6CBC',
              addresses: ['192.168.1.99'],
              port: 49152,
              durableIdentities: [{ kind: 'hap', value: 'AA:BB:CC:DD:EE:FF' }],
              status: 'discovered',
              discoveredAt: '2026-04-04T00:00:00.000Z',
              lastSeenAt: '2026-04-04T00:00:00.000Z',
            },
            {
              id: 'shelly:192.168.1.105',
              protocol: 'zeroconf',
              domain: 'shelly',
              name: 'Shelly Plus 1',
              addresses: ['192.168.1.105'],
              durableIdentities: [],
              status: 'discovered',
              discoveredAt: '2026-04-04T00:00:00.000Z',
              lastSeenAt: '2026-04-04T00:00:00.000Z',
            },
          ];
        }
        if (path === '/api/commissioning/flows' && init?.method === 'POST') {
          const body = init.body as { domain?: string; source?: string };
          startedSources.push({ domain: body.domain, source: body.source });
          if (body.source === 'discovery') {
            throw new Error('The Hub request failed (400: discovery_flow_unavailable).');
          }
          return {
            type: 'form',
            flowId: `ha_${body.domain}_user`,
            handler: body.domain,
            stepId: 'user',
            title: 'Shelly',
            dataSchema: [{ name: 'host', type: 'string', required: true }],
          };
        }
        return {};
      },
      async () => {},
      async () => [],
    );

    await manager.scanDiscovery();
    const progress = await manager.listFlowProgress();
    const hkFlow = progress.find((p) => p.handler === 'homekit_controller') as { flow_id: string };
    const shellyFlow = progress.find((p) => p.handler === 'shelly') as { flow_id: string };

    const hkStep = (await manager.handleManagement({
      method: 'GET',
      path: `config/config_entries/flow/${hkFlow.flow_id}`,
    })) as Record<string, unknown>;
    expect(hkStep.type).toBe('form');
    expect(hkStep.step_id).toBe('pair');
    expect(Array.isArray(hkStep.data_schema)).toBe(true);
    expect((hkStep.data_schema as Array<{ name: string }>)[0]?.name).toBe('pairing_code');

    const shellyStep = (await manager.handleManagement({
      method: 'GET',
      path: `config/config_entries/flow/${shellyFlow.flow_id}`,
    })) as Record<string, unknown>;
    expect(shellyStep.type).toBe('form');
    expect(shellyStep.handler).toBe('shelly');
    expect(shellyStep.step_id).toBe('user');
    expect(startedSources).toEqual([
      { domain: 'homekit_controller', source: 'discovery' },
      { domain: 'shelly', source: 'discovery' },
      { domain: 'shelly', source: 'user' },
    ]);
  });
});
