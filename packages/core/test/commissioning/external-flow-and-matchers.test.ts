/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it, vi } from 'vitest';
import {
  DiscoveryRegistry,
  IntegrationFlowEngine,
  matchAllDiscoveryRules,
  selectBestDiscoveryMatch,
  type DiscoveryMatcherRule,
  type ExternalFlowRuntime,
  type IntegrationFlowStep,
} from '../../src/commissioning/index.js';

describe('ExternalFlowRuntime integration in IntegrationFlowEngine', () => {
  it('delegates start, refresh, submit, completeExternal, abort, and progress to ExternalFlowRuntime', async () => {
    const registry = new DiscoveryRegistry();
    const candidate = registry.ingest({
      protocol: 'zeroconf',
      domain: 'ipp',
      name: 'Office Printer',
      host: '192.168.5.77',
      port: 631,
      details: { serviceType: '_ipp._tcp.local.' },
    });

    const initialStep: IntegrationFlowStep = {
      type: 'form',
      flowId: 'ha_flow_1',
      handler: 'ipp',
      stepId: 'user',
      title: 'Internet Printing Protocol',
      dataSchema: [{ name: 'host', type: 'string', required: true, defaultValue: '192.168.5.77' }],
    };
    const progressStep: IntegrationFlowStep = {
      type: 'progress',
      flowId: 'ha_flow_1',
      handler: 'ipp',
      stepId: 'wait',
      progressAction: 'connecting',
    };
    const doneStep: IntegrationFlowStep = {
      type: 'create_entry',
      flowId: 'ha_flow_1',
      handler: 'ipp',
      stepId: 'done',
      title: 'Office Printer',
      result: { entryId: 'entry_ipp_1', title: 'Office Printer', data: { host: '192.168.5.77' } },
    };

    let getCount = 0;
    const abortSpy = vi.fn(async () => {});
    const externalRuntime: ExternalFlowRuntime = {
      supportsDomain: (domain) => domain === 'ipp' || domain === 'spotify',
      startFlow: vi.fn(async (opts) =>
        opts.domain === 'spotify'
          ? {
              type: 'external' as const,
              flowId: 'ha_flow_oauth',
              handler: 'spotify',
              stepId: 'auth',
              url: 'https://accounts.spotify.com/authorize?state=abc',
            }
          : initialStep,
      ),
      getFlow: vi.fn(async (flowId) => {
        if (flowId === 'ha_flow_discovered') {
          return {
            type: 'form' as const,
            flowId: 'ha_flow_discovered',
            handler: 'ipp',
            stepId: 'zeroconf_confirm',
            title: 'Confirm Printer',
          };
        }
        getCount += 1;
        return getCount === 1 ? progressStep : doneStep;
      }),
      submitStep: vi.fn(async () => progressStep),
      abortFlow: abortSpy,
      completeExternal: vi.fn(async () => ({
        type: 'create_entry' as const,
        flowId: 'ha_flow_oauth',
        handler: 'spotify',
        stepId: 'done',
        title: 'Spotify',
        result: { entryId: 'entry_spot_1', title: 'Spotify', data: { token: 'ok' } },
      })),
      listProgressFlows: vi.fn(async () => [
        {
          flowId: 'ha_flow_discovered',
          handler: 'ipp',
          stepId: 'zeroconf_confirm',
          title: 'Printer',
          context: { source: 'zeroconf' },
        },
      ]),
    };

    const engine = new IntegrationFlowEngine(registry, undefined, externalRuntime);
    const step = await engine.startFlow({
      domain: 'ipp',
      homeId: 'home_1',
      userId: 'user_1',
      candidateId: candidate.id,
      showAdvancedOptions: true,
    });
    expect(step.flowId).toBe('ha_flow_1');
    expect(registry.getCandidate(candidate.id)?.status).toBe('in_progress');

    const submitted = await engine.submitStep({
      flowId: 'ha_flow_1',
      homeId: 'home_1',
      userId: 'user_1',
      values: { host: '192.168.5.77' },
    });
    expect(submitted.type).toBe('progress');

    const firstRefresh = await engine.refreshFlow('ha_flow_1', {
      homeId: 'home_1',
      userId: 'user_1',
    });
    expect(firstRefresh?.type).toBe('progress');

    const secondRefresh = await engine.refreshFlow('ha_flow_1', {
      homeId: 'home_1',
      userId: 'user_1',
    });
    expect(secondRefresh?.type).toBe('create_entry');
    expect(registry.getCandidate(candidate.id)?.status).toBe('configured');

    // Adopts discovery flow directly from ExternalFlowRuntime
    const adopted = await engine.refreshFlow('ha_flow_discovered', {
      homeId: 'home_1',
      userId: 'user_1',
    });
    expect(adopted?.stepId).toBe('zeroconf_confirm');
    const cancelled = await engine.cancelFlowAsync('ha_flow_discovered', {
      homeId: 'home_1',
      userId: 'user_1',
    });
    expect(cancelled).toBe(true);
    expect(abortSpy).toHaveBeenCalledWith('ha_flow_discovered', 'discovery');

    // Completes external OAuth flow
    await engine.startFlow({ domain: 'spotify', homeId: 'home_1', userId: 'user_1' });
    const oauthDone = await engine.completeExternalFlow({
      flowId: 'ha_flow_oauth',
      state: 'abc',
      code: 'auth_code',
    });
    expect(oauthDone.type).toBe('create_entry');
    expect(engine.getFlow('ha_flow_oauth', { homeId: 'home_1' })?.type).toBe('create_entry');

    const progressList = await engine.listProgressFlows('home_1');
    expect(progressList.some((p) => p.flowId === 'ha_flow_discovered')).toBe(true);
  });
});

describe('Multi-protocol Discovery Matcher extensions', () => {
  it('handles HomeKit alwaysDiscover suppression and multi-match ordering', () => {
    const rules: DiscoveryMatcherRule[] = [
      { domain: 'homekit_controller', zeroconf: ['_hap._tcp.local.'] },
      { domain: 'hue', homekit: { models: ['BSB002'], alwaysDiscover: false } },
      { domain: 'roku', homekit: { models: ['3810X'], alwaysDiscover: true } },
    ];

    const hueMatches = matchAllDiscoveryRules(rules, {
      protocol: 'zeroconf',
      name: 'Philips hue',
      details: { serviceType: '_hap._tcp.local.', sf: '1', md: 'BSB002' },
    });
    expect(hueMatches.map((m) => m.rule.domain)).toEqual(['hue']);

    const rokuMatches = matchAllDiscoveryRules(rules, {
      protocol: 'zeroconf',
      name: 'Roku Stick',
      details: { serviceType: '_hap._tcp.local.', sf: '1', md: '3810X' },
    });
    expect(rokuMatches.map((m) => m.rule.domain)).toEqual(['roku', 'homekit_controller']);
  });

  it('matches SSDP custom headers, Bluetooth manufacturer_data_start & service_uuids, and USB manufacturer', () => {
    const rules: DiscoveryMatcherRule[] = [
      {
        domain: 'sonos',
        ssdp: [
          {
            st: 'urn:schemas-upnp-org:device:ZonePlayer:1',
            manufacturerURL: 'http://www.sonos.com',
            'X-Sonos-Room': '*',
          },
        ],
      },
      {
        domain: 'govee_ble',
        bluetooth: [
          {
            connectable: false,
            manufacturer_id: 34818,
            manufacturer_data_start: [0x01, 0x02],
            service_uuid: '0000fe95-0000-1000-8000-00805f9b34fb',
          },
        ],
      },
      {
        domain: 'zha',
        usb: [{ vid: '10C4', pid: 'EA60', manufacturer: '*Sonoff*' }],
      },
    ];

    const ssdpMatch = selectBestDiscoveryMatch(rules, {
      protocol: 'ssdp',
      host: '192.168.5.50',
      details: {
        st: 'urn:schemas-upnp-org:device:ZonePlayer:1',
        manufacturerURL: 'http://www.sonos.com',
        headers: { 'x-sonos-room': 'Living Room' },
      },
    });
    expect(ssdpMatch?.rule.domain).toBe('sonos');

    const bleMatch = selectBestDiscoveryMatch(rules, {
      protocol: 'bluetooth',
      name: 'Govee_H5075',
      details: {
        connectable: false,
        manufacturer_data: { '34818': [0x01, 0x02, 0xff] },
        service_uuids: ['fe95'],
      },
    });
    expect(bleMatch?.rule.domain).toBe('govee_ble');

    const bleWrongConnectable = selectBestDiscoveryMatch(rules, {
      protocol: 'bluetooth',
      name: 'Govee_H5075',
      details: {
        connectable: true,
        manufacturer_data: { '34818': [0x01, 0x02, 0xff] },
        service_uuids: ['fe95'],
      },
    });
    expect(bleWrongConnectable).toBeUndefined();

    const usbMatch = selectBestDiscoveryMatch(rules, {
      protocol: 'usb',
      usb: { vid: '10C4', pid: 'EA60', manufacturer: 'ITead Sonoff Zigbee 3.0' },
    });
    expect(usbMatch?.rule.domain).toBe('zha');
  });
});
