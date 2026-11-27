/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type {
  DemoOnboardingState,
  FlowStartTarget,
  FlowStepRecord,
  IntegrationCatalogChoice,
  OnboardingDiscoveredFlow,
} from '../onboarding.js';
import type { EcosystemCatalogSourceItem } from './catalog.js';
import { humanizeFlowIdentifier } from './flow.js';

const DEMO_DISCOVERED_FLOWS: readonly OnboardingDiscoveredFlow[] = [
  {
    flowId: 'demo-flow-hue',
    domain: 'hue',
    title: 'Philips Hue',
    label: 'Philips Hue Bridge',
    source: 'zeroconf',
    sourceLabel: 'mDNS',
  },
  {
    flowId: 'demo-flow-matter',
    domain: 'matter',
    title: 'Matter',
    label: 'Matter Smart Plug',
    source: 'matter',
    sourceLabel: 'Matter',
  },
  {
    flowId: 'demo-flow-homekit',
    domain: 'homekit_controller',
    title: 'Apple HomeKit Device',
    label: 'Aqara Presence FP2',
    source: 'homekit',
    sourceLabel: 'HomeKit',
  },
];

function catalogChoice(
  domain: string,
  title: string,
  subtitle: string,
  category: string,
  popular: boolean,
): IntegrationCatalogChoice {
  return { domain, title, subtitle, category, popular };
}

const DEMO_INTEGRATION_CATALOG: readonly IntegrationCatalogChoice[] = [
  catalogChoice('hue', 'Philips Hue', 'Bridges & local lights', 'Lighting', true),
  catalogChoice('matter', 'Matter', 'Thread & Wi-Fi Matter accessories', 'Protocol', true),
  catalogChoice(
    'homekit_controller',
    'HomeKit Device',
    'Local HAP accessories over IP & BLE',
    'Protocol',
    true,
  ),
  catalogChoice('tuya', 'Tuya', 'Smart Life & local LAN pairing', 'Ecosystem', true),
  catalogChoice('shelly', 'Shelly', 'Gen1–Gen3 switches & energy meters', 'Switches', true),
  catalogChoice('esphome', 'ESPHome', 'Native API sensors & relays', 'DIY', true),
  catalogChoice('sonos', 'Sonos', 'Speakers & rooms', 'Media', true),
  catalogChoice('unifiprotect', 'UniFi Protect', 'Cameras, doorbells & NVR', 'Cameras', true),
  catalogChoice('zha', 'Zigbee Home Automation', 'Direct coordinator mesh', 'Protocol', false),
  catalogChoice('mqtt', 'MQTT', 'Broker discovery & devices', 'Protocol', false),
  catalogChoice('govee', 'Govee', 'LAN light strips & lamps', 'Lighting', false),
  catalogChoice('reolink', 'Reolink', 'IP cameras & NVR streams', 'Cameras', false),
];

const DEMO_ECOSYSTEM_APPS: readonly EcosystemCatalogSourceItem[] = [
  {
    id: 'homebridge-govee',
    name: 'Homebridge Govee',
    runtimeType: 'homebridge',
    packageName: 'homebridge-govee',
    description: 'Direct LAN UDP, BLE, and AWS IoT cloud support for Govee lights and smart plugs.',
    latestVersion: '10.6.1',
    verified: true,
    trustScore: 96,
    stabilityTier: 'gold',
    vendorId: 'govee',
    vendorName: 'Haus Govee',
  },
  {
    id: 'govee2mqtt',
    name: 'Govee to MQTT',
    runtimeType: 'docker',
    packageName: 'govee2mqtt',
    description:
      'High-throughput LAN, BLE, and Matter-to-MQTT bridge for Govee RGBIC lights and sensors.',
    latestVersion: '2026.10.2',
    verified: true,
    trustScore: 95,
    stabilityTier: 'gold',
    vendorId: 'govee',
    vendorName: 'Haus Govee',
  },
  {
    id: 'scrypted-reolink',
    name: 'Reolink Camera Plugin (Scrypted)',
    runtimeType: 'scrypted',
    packageName: '@scrypted/reolink',
    description:
      'Low-latency RTSP, ONVIF, HomeKit Secure Video, and smart AI detection for Reolink cameras.',
    latestVersion: '0.1.82',
    verified: true,
    trustScore: 93,
    stabilityTier: 'gold',
    vendorId: 'reolink',
    vendorName: 'Reolink',
  },
  {
    id: 'hacs-localtuya',
    name: 'LocalTuya',
    runtimeType: 'hacs',
    packageName: 'localtuya',
    domain: 'localtuya',
    hacsRepositoryId: 'rospogrigio/localtuya',
    description:
      'Direct local LAN control for Tuya Wi-Fi switches, lights, and plugs without cloud round-trips.',
    latestVersion: '5.2.1',
    verified: true,
    trustScore: 89,
    stabilityTier: 'gold',
    vendorId: 'tuya',
    vendorName: 'Tuya',
    repositoryUrl: 'https://github.com/rospogrigio/localtuya',
  },
  {
    id: 'scrypted-unifi',
    name: 'UniFi Protect (Scrypted)',
    runtimeType: 'scrypted',
    packageName: '@scrypted/unifi-protect',
    description:
      'Native WebRTC & HomeKit Secure Video bridge for UniFi Protect cameras and doorbells.',
    latestVersion: '0.4.19',
    verified: true,
    trustScore: 94,
    stabilityTier: 'gold',
    vendorId: 'unifi',
    vendorName: 'UniFi',
  },
];

export function buildDemoOnboardingState(): DemoOnboardingState {
  return {
    discovered: DEMO_DISCOVERED_FLOWS,
    catalog: DEMO_INTEGRATION_CATALOG,
    ecosystemApps: DEMO_ECOSYSTEM_APPS,
  };
}

export function startDemoConfigFlow(
  domain: string,
  title?: string,
  target?: FlowStartTarget,
): FlowStepRecord {
  const display =
    title ??
    DEMO_INTEGRATION_CATALOG.find((item) => item.domain === domain)?.title ??
    humanizeFlowIdentifier(domain);
  const flowId = `demo-flow-${
    target?.repair
      ? `repair-${target.repair.issue_id}`
      : target?.kind === 'options'
        ? `options-${domain}`
        : target?.reauth
          ? `reauth-${domain}`
          : target?.reconfigure
            ? `reconfigure-${domain}`
            : domain
  }`;

  if (target?.repair) {
    return {
      type: 'form',
      flow_id: flowId,
      handler: domain,
      step_id: 'repair_confirm',
      title: `Fix ${display}`,
      description:
        target.repair.issue_id === 'zigbee_channel_overlap'
          ? 'Your Zigbee coordinator is sharing 2.4 GHz spectrum with nearby Wi-Fi access points. Pick a clean Zigbee channel to migrate the mesh without re-pairing devices.'
          : `Review and apply the recommended repair for ${display}.`,
      submit_label: 'Apply fix',
      documentation_url: `https://www.home-assistant.io/integrations/${domain}`,
      data_schema:
        target.repair.issue_id === 'zigbee_channel_overlap'
          ? [
              {
                name: 'channel',
                type: 'select',
                label: 'Target Zigbee channel',
                default: '25',
                required: true,
                options: [
                  { value: '15', label: 'Channel 15 (Low interference)' },
                  { value: '20', label: 'Channel 20 (Balanced)' },
                  { value: '25', label: 'Channel 25 (Recommended · Clear)' },
                ],
              },
              {
                name: 'backup_first',
                type: 'boolean',
                label: 'Create coordinator NVRAM backup before migration',
                default: true,
              },
            ]
          : [
              {
                name: 'confirm',
                type: 'boolean',
                label: 'Confirm automatic repair',
                default: true,
              },
            ],
    };
  }

  if (target?.kind === 'options') {
    return {
      type: 'form',
      flow_id: flowId,
      handler: domain,
      step_id: 'init',
      title: `${display} options`,
      description: `Customize local polling, event updates, and discovery behavior for ${display}.`,
      submit_label: 'Save options',
      documentation_url: `https://www.home-assistant.io/integrations/${domain}`,
      data_schema: [
        {
          name: 'scan_interval',
          type: 'integer',
          label: 'Polling interval (seconds)',
          default: 15,
          value_min: 5,
          value_max: 300,
          required: true,
        },
        {
          name: 'local_push',
          type: 'boolean',
          label: 'Prefer local push events when supported',
          default: true,
        },
      ],
    };
  }

  if (target?.reauth) {
    return {
      type: 'form',
      flow_id: flowId,
      handler: domain,
      step_id: 'reauth_confirm',
      title: `Reauthenticate ${display}`,
      description: `Saved credentials for ${display} expired or were revoked. Enter updated credentials to restore syncing.`,
      submit_label: 'Reauthenticate',
      data_schema: [
        { name: 'username', type: 'string', label: 'Account email or username', required: true },
        { name: 'password', type: 'password', label: 'Password or access token', required: true },
      ],
    };
  }

  if (target?.reconfigure) {
    return {
      type: 'form',
      flow_id: flowId,
      handler: domain,
      step_id: 'reconfigure',
      title: `Reconfigure ${display}`,
      description: `Update the network host or connection settings for ${display} without losing existing devices.`,
      submit_label: 'Save changes',
      data_schema: [
        {
          name: 'host',
          type: 'string',
          label: 'Host or IP address',
          default: '192.168.1.42',
          required: true,
        },
        { name: 'verify_ssl', type: 'boolean', label: 'Verify TLS certificate', default: false },
      ],
    };
  }

  if (domain === 'hue') {
    return {
      type: 'form',
      flow_id: flowId,
      handler: 'hue',
      step_id: 'link',
      title: display,
      description:
        'Press the link button on your Hue Bridge, or confirm its local IP address to pair.',
      submit_label: 'Connect Bridge',
      documentation_url: 'https://www.home-assistant.io/integrations/hue',
      data_schema: [
        {
          name: 'host',
          type: 'string',
          label: 'Bridge IP / Hostname',
          default: '192.168.1.42',
          required: true,
        },
        {
          name: 'allow_insecure',
          type: 'boolean',
          label: 'Allow local self-signed TLS certificate',
          default: true,
        },
      ],
    };
  }

  if (domain === 'tuya') {
    return {
      type: 'menu',
      flow_id: flowId,
      handler: 'tuya',
      step_id: 'user',
      title: display,
      description: 'Choose how Haus should pair your Tuya devices.',
      documentation_url: 'https://www.home-assistant.io/integrations/tuya',
      menu_options: ['cloud', 'local'],
      menu_descriptions: {
        cloud: 'Smart Life / Tuya Cloud QR & app credentials',
        local: 'Local LAN key pairing on your home subnet',
      },
    };
  }

  return {
    type: 'form',
    flow_id: flowId,
    handler: domain,
    step_id: 'user',
    title: display,
    description: `Enter connection details for ${display} on your local network.`,
    submit_label: 'Set up',
    documentation_url: `https://www.home-assistant.io/integrations/${domain}`,
    data_schema: [
      {
        name: 'host',
        type: 'string',
        label: 'Host or IP address',
        default: '192.168.1.50',
        required: true,
      },
      { name: 'name', type: 'string', label: 'Display name', default: display },
    ],
  };
}

export function advanceDemoConfigFlow(
  step: FlowStepRecord,
  input: Readonly<Record<string, unknown>>,
): FlowStepRecord {
  const display = step.title ?? humanizeFlowIdentifier(step.handler);

  if (step.step_id === 'reauth_confirm') {
    return {
      type: 'abort',
      flow_id: step.flow_id,
      handler: step.handler,
      reason: 'reauth_successful',
      title: display,
      description: `${display} credentials were updated and syncing has resumed.`,
    };
  }

  if (step.step_id === 'reconfigure') {
    return {
      type: 'abort',
      flow_id: step.flow_id,
      handler: step.handler,
      reason: 'reconfigure_successful',
      title: display,
      description: `${display} connection settings were updated.`,
    };
  }

  if (step.step_id === 'repair_confirm') {
    const cleanName = display.replace(/^Fix\s+/i, '');
    return {
      type: 'create_entry',
      flow_id: step.flow_id,
      handler: step.handler,
      title: cleanName,
      description: `Repair completed for ${cleanName}. The issue has been resolved.`,
      result: { title: cleanName },
    };
  }

  if (step.type === 'menu' && step.handler === 'tuya') {
    const mode = String(input.next_step_id ?? 'cloud');
    return {
      type: 'form',
      flow_id: step.flow_id,
      handler: 'tuya',
      step_id: 'credentials',
      title: display,
      description:
        mode === 'local'
          ? 'Enter the local LAN device ID and key to pair without cloud dependency.'
          : 'Confirm your Smart Life account code to link discovered Tuya devices.',
      submit_label: 'Pair Tuya',
      data_schema:
        mode === 'local'
          ? [
              {
                name: 'host',
                type: 'string',
                label: 'Device IP',
                default: '192.168.1.78',
                required: true,
              },
              {
                name: 'local_key',
                type: 'password',
                label: 'Local key',
                default: 'demo-local-key',
                required: true,
              },
            ]
          : [
              {
                name: 'user_code',
                type: 'string',
                label: 'User code',
                default: 'HAUS-DEMO-88',
                required: true,
              },
            ],
    };
  }

  const chosenTitle =
    typeof input.name === 'string' && input.name.trim() ? input.name.trim() : display;
  return {
    type: 'create_entry',
    flow_id: step.flow_id,
    handler: step.handler,
    title: chosenTitle,
    description: `${chosenTitle} is configured and ready in Haus.`,
    result: {
      entry_id: `demo-entry-${step.handler}`,
      title: chosenTitle,
    },
  };
}
