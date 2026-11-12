/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { DiscoveryRegistry } from './discovery-deduplicator.js';
import type {
  FlowCapabilityRequirement,
  FlowCatalogResolver,
  FlowFormField,
  FlowInitOptions,
  FlowSubmissionOptions,
  IntegrationFlowSession,
  IntegrationFlowStep,
} from './flow-types.js';

interface DomainFlowDefinition {
  readonly authMethod: 'form' | 'oauth' | '2fa' | 'zero_config' | 'unsupported';
  readonly title: string;
  readonly schema?: readonly FlowFormField[];
  readonly oauthUrl?: string;
  readonly unsupported?: readonly FlowCapabilityRequirement[];
  readonly requires2fa?: boolean;
}

const KNOWN_FLOW_DOMAINS: Record<string, DomainFlowDefinition> = {
  homekit_controller: {
    authMethod: 'form',
    title: 'Pair HomeKit Device',
    schema: [{ name: 'pin', type: 'pin', label: 'Setup Code', required: true }],
  },
  matter: {
    authMethod: 'form',
    title: 'Commission Matter Node',
    schema: [{ name: 'code', type: 'string', label: 'Manual or QR code', required: true }],
  },
  'homebridge-govee': {
    authMethod: 'form',
    title: 'Configure Govee Cloud & LAN',
    schema: [
      { name: 'apiKey', type: 'pin', label: 'Govee Platform API key', required: true },
      { name: 'lanControl', type: 'boolean', label: 'Enable local LAN control', defaultValue: true },
    ],
  },
  meross_lan: {
    authMethod: 'form',
    title: 'Add Meross LAN Device',
    schema: [
      { name: 'host', type: 'string', label: 'IP address or hostname', required: true },
      { name: 'key', type: 'pin', label: 'Device key (optional)', required: false },
    ],
  },
  sensibo: {
    authMethod: 'form',
    title: 'Connect Sensibo AirQ',
    schema: [{ name: 'apiKey', type: 'pin', label: 'Sensibo REST API Key', required: true }],
  },
  hue: {
    authMethod: 'form',
    title: 'Connect Philips Hue Bridge',
    schema: [{ name: 'host', type: 'string', label: 'Bridge IP (leave empty to auto-detect)', required: false }],
  },
  eero: {
    authMethod: '2fa',
    title: 'Sign in to Eero',
    requires2fa: true,
    schema: [{ name: 'user_token', type: 'string', label: 'Phone number or email', required: true }],
  },
  nest: {
    authMethod: 'oauth',
    title: 'Link Google Nest Account',
    oauthUrl: 'https://nestservices.google.com/partnerconnections',
  },
  spotify: {
    authMethod: 'oauth',
    title: 'Link Spotify Account',
    oauthUrl: 'https://accounts.spotify.com/authorize',
  },
  mqtt: {
    authMethod: 'form',
    title: 'Configure MQTT Broker',
    schema: [
      { name: 'broker', type: 'string', label: 'Broker Host', required: true, defaultValue: '127.0.0.1' },
      { name: 'port', type: 'number', label: 'Port', required: true, defaultValue: 1883 },
      { name: 'username', type: 'string', label: 'Username', required: false },
      { name: 'password', type: 'pin', label: 'Password', required: false },
    ],
  },
  transmission: {
    authMethod: 'form',
    title: 'Connect Transmission',
    schema: [
      { name: 'host', type: 'string', label: 'Host', required: true, defaultValue: '127.0.0.1' },
      { name: 'port', type: 'number', label: 'Port', required: true, defaultValue: 9091 },
      { name: 'username', type: 'string', label: 'Username', required: false },
      { name: 'password', type: 'pin', label: 'Password', required: false },
    ],
  },
  speedtestdotnet: {
    authMethod: 'zero_config',
    title: 'SpeedTest.net Diagnostics',
  },
  openweathermap: {
    authMethod: 'form',
    title: 'Connect OpenWeatherMap',
    schema: [{ name: 'api_key', type: 'pin', label: 'OpenWeatherMap API Key', required: true }],
  },
  telegram_bot: {
    authMethod: 'form',
    title: 'Configure Telegram Bot',
    schema: [
      { name: 'api_key', type: 'pin', label: 'Telegram Bot Token', required: true },
      { name: 'chat_id', type: 'string', label: 'Allowed Chat ID', required: true },
    ],
  },
};

function generateFlowId(): string {
  return `flow_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export class IntegrationFlowEngine {
  private readonly sessions = new Map<string, IntegrationFlowSession>();

  constructor(
    private readonly discoveryRegistry?: DiscoveryRegistry,
    private catalogResolver?: FlowCatalogResolver,
  ) {}

  setCatalogResolver(resolver: FlowCatalogResolver): void {
    this.catalogResolver = resolver;
  }

  getCatalogResolver(): FlowCatalogResolver | undefined {
    return this.catalogResolver;
  }

  getAvailableDomains(): readonly string[] {
    const known = Object.keys(KNOWN_FLOW_DOMAINS);
    const catalog = this.catalogResolver?.getAllDomains?.() ?? [];
    return Array.from(new Set([...known, ...catalog])).sort();
  }

  async startFlow(options: FlowInitOptions): Promise<IntegrationFlowStep> {
    const { domain, homeId, userId } = options;
    if (!homeId || !userId) {
      throw new Error('home_and_user_required');
    }

    const flowId = generateFlowId();
    const source = options.source ?? 'user';
    const now = Date.now();
    const candidate = options.candidateId
      ? this.discoveryRegistry?.getCandidate(options.candidateId)
      : undefined;

    if (options.candidateId && this.discoveryRegistry) {
      this.discoveryRegistry.markInProgress(options.candidateId, flowId);
    }

    const def = KNOWN_FLOW_DOMAINS[domain];
    const catalogManifest =
      !def && this.catalogResolver ? this.catalogResolver.getManifest(domain) : undefined;
    let initialStep: IntegrationFlowStep;

    if (def) {
      if (def.authMethod === 'zero_config') {
        const entryId = `${domain}_${Date.now()}`;
        initialStep = {
          type: 'create_entry',
          flowId,
          handler: domain,
          stepId: 'done',
          title: def.title,
          result: { entryId, title: def.title },
        };
        if (options.candidateId && this.discoveryRegistry) {
          this.discoveryRegistry.markConfigured(options.candidateId, true);
        }
      } else if (def.authMethod === 'oauth') {
        initialStep = {
          type: 'external',
          flowId,
          handler: domain,
          stepId: 'oauth',
          title: def.title,
          url: def.oauthUrl,
          description: `Authorize ${def.title} in your browser to continue setup.`,
        };
      } else if (options.source === 'reauth') {
        initialStep = {
          type: 'form',
          flowId,
          handler: domain,
          stepId: 'reauth',
          title: `Re-authenticate ${def.title}`,
          dataSchema: def.schema,
        };
      } else {
        const defaultHost = options.manualAddress?.host ?? candidate?.addresses[0];
        const defaultPort = options.manualAddress?.port ?? candidate?.port;
        const schemaWithDefaults = def.schema?.map((f) => {
          if (f.name === 'host' && defaultHost) return { ...f, defaultValue: defaultHost };
          if (f.name === 'port' && defaultPort) return { ...f, defaultValue: defaultPort };
          return f;
        });

        initialStep = {
          type: 'form',
          flowId,
          handler: domain,
          stepId: 'user',
          title: def.title,
          dataSchema: schemaWithDefaults,
        };
      }
    } else if (
      catalogManifest ||
      (this.catalogResolver && this.catalogResolver.hasDomain(domain))
    ) {
      const manifest = catalogManifest ?? { domain, name: domain };
      const name = manifest.name || domain;
      const iotClass = manifest.iot_class ?? 'local_push';
      const isBluetooth = Boolean(manifest.bluetooth && manifest.bluetooth.length > 0);
      const isZeroConfig =
        manifest.config_flow === false || iotClass === 'calculated' || iotClass === 'system';

      if (isZeroConfig) {
        const entryId = `${domain}_${Date.now()}`;
        initialStep = {
          type: 'create_entry',
          flowId,
          handler: domain,
          stepId: 'done',
          title: name,
          result: { entryId, title: name },
        };
        if (options.candidateId && this.discoveryRegistry) {
          this.discoveryRegistry.markConfigured(options.candidateId, true);
        }
      } else if (isBluetooth) {
        const defaultAddress = options.manualAddress?.host ?? candidate?.addresses[0];
        const schema: FlowFormField[] = [
          {
            name: 'address',
            type: 'string',
            label: 'Bluetooth Device MAC',
            required: true,
            defaultValue: defaultAddress,
          },
          {
            name: 'bindkey',
            type: 'pin',
            label: 'Encryption Bindkey (optional)',
            required: false,
          },
        ];
        initialStep = {
          type: 'form',
          flowId,
          handler: domain,
          stepId: 'user',
          title: `Configure ${name}`,
          description: `Enter the Bluetooth address and optional encryption bindkey for ${name}.`,
          dataSchema: schema,
        };
      } else {
        const schema: FlowFormField[] = [];
        const isCloud = iotClass.startsWith('cloud');
        if (isCloud) {
          schema.push(
            { name: 'username', type: 'string', label: 'Account Username / Email', required: true },
            {
              name: 'password',
              type: 'pin',
              label: 'Account Password / API Token',
              required: true,
            },
          );
        } else {
          const defaultHost = options.manualAddress?.host ?? candidate?.addresses[0];
          const defaultPort = options.manualAddress?.port ?? candidate?.port;
          schema.push(
            {
              name: 'host',
              type: 'string',
              label: 'Host / IP Address',
              required: true,
              defaultValue: defaultHost,
            },
            {
              name: 'port',
              type: 'number',
              label: 'Port',
              required: false,
              defaultValue: defaultPort,
            },
            {
              name: 'api_key',
              type: 'pin',
              label: 'API Key or Access Token (optional)',
              required: false,
            },
          );
        }
        initialStep = {
          type: 'form',
          flowId,
          handler: domain,
          stepId: 'user',
          title: `Configure ${name}`,
          description: `Set up ${name} (${iotClass}).`,
          dataSchema: schema,
        };
      }
    } else {
      initialStep = {
        type: 'abort',
        flowId,
        handler: domain,
        stepId: 'abort',
        title: `Unsupported Integration: ${domain}`,
        description: `Integration "${domain}" is not supported natively by Haus without Home Assistant Core.`,
        unsupportedRequirements: [
          {
            category: 'runtime',
            name: domain,
            description: `Integration "${domain}" requires external Python runtime execution.`,
          },
        ],
      };
    }

    const session: IntegrationFlowSession = {
      flowId,
      domain,
      source,
      candidateId: options.candidateId,
      homeId,
      userId,
      createdAt: now,
      updatedAt: now,
      currentStep: initialStep,
      history: [initialStep],
      context: {
        ...options.initialData,
        ...(options.manualAddress ? { manualAddress: options.manualAddress } : {}),
        ...(options.reauthEntryId ? { reauthEntryId: options.reauthEntryId } : {}),
      },
    };

    this.sessions.set(flowId, session);
    return initialStep;
  }

  getFlow(
    flowId: string,
    auth: { homeId: string; userId?: string },
  ): IntegrationFlowStep | undefined {
    const s = this.sessions.get(flowId);
    if (!s || s.homeId !== auth.homeId) return undefined;
    return s.currentStep;
  }

  async submitStep(submission: FlowSubmissionOptions): Promise<IntegrationFlowStep> {
    const s = this.sessions.get(submission.flowId);
    if (!s || s.homeId !== submission.homeId) {
      throw new Error('flow_not_found');
    }

    const def = KNOWN_FLOW_DOMAINS[s.domain];
    const stepId = submission.stepId ?? s.currentStep.stepId;
    const errors: Record<string, string> = {};

    if (s.currentStep.type === 'form' && s.currentStep.dataSchema) {
      for (const field of s.currentStep.dataSchema) {
        const val = submission.values[field.name];
        if (field.required && (val === undefined || val === null || val === '')) {
          errors[field.name] = 'required';
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      const errStep: IntegrationFlowStep = {
        ...s.currentStep,
        errors,
      };
      this.updateSession(s, errStep);
      return errStep;
    }

    if (s.currentStep.type === 'external') {
      const entryId = `${s.domain}_oauth_${Date.now()}`;
      const doneStep: IntegrationFlowStep = {
        type: 'create_entry',
        flowId: s.flowId,
        handler: s.domain,
        stepId: 'done',
        title: def?.title ?? s.domain,
        result: { entryId, title: def?.title ?? s.domain },
      };
      this.updateSession(s, doneStep);
      if (s.candidateId && this.discoveryRegistry) {
        this.discoveryRegistry.markConfigured(s.candidateId, true);
      }
      return doneStep;
    }

    if (def?.requires2fa && stepId === 'user') {
      const twoFaStep: IntegrationFlowStep = {
        type: 'form',
        flowId: s.flowId,
        handler: s.domain,
        stepId: '2fa',
        title: 'Enter Verification Code',
        description: 'A 6-digit verification code was sent to your device.',
        dataSchema: [{ name: 'verification_code', type: 'pin', label: 'SMS Code', required: true }],
      };
      this.updateSession(s, twoFaStep, { userCredentials: submission.values });
      return twoFaStep;
    }

    const entryId = s.context.reauthEntryId
      ? String(s.context.reauthEntryId)
      : `${s.domain}_${Date.now()}`;
    const title = def?.title ?? s.currentStep.title ?? s.domain;

    const completedStep: IntegrationFlowStep = {
      type: 'create_entry',
      flowId: s.flowId,
      handler: s.domain,
      stepId: 'done',
      title,
      result: {
        entryId,
        title,
        deviceId: s.candidateId,
      },
    };

    this.updateSession(s, completedStep, { finalValues: submission.values });

    if (s.candidateId && this.discoveryRegistry) {
      this.discoveryRegistry.markConfigured(s.candidateId, true);
    }

    return completedStep;
  }

  cancelFlow(flowId: string, auth: { homeId: string; userId?: string }): boolean {
    const s = this.sessions.get(flowId);
    if (!s || s.homeId !== auth.homeId) return false;

    if (s.candidateId && this.discoveryRegistry) {
      this.discoveryRegistry.releaseInProgress(flowId);
    }

    this.sessions.delete(flowId);
    return true;
  }

  listActiveFlows(homeId: string): readonly IntegrationFlowStep[] {
    const list: IntegrationFlowStep[] = [];
    for (const s of this.sessions.values()) {
      if (
        s.homeId === homeId &&
        s.currentStep.type !== 'create_entry' &&
        s.currentStep.type !== 'abort'
      ) {
        list.push(s.currentStep);
      }
    }
    return list;
  }

  private updateSession(
    s: IntegrationFlowSession,
    nextStep: IntegrationFlowStep,
    extraContext?: Record<string, unknown>,
  ): void {
    const updated: IntegrationFlowSession = {
      ...s,
      currentStep: nextStep,
      history: [...s.history, nextStep],
      context: { ...s.context, ...extraContext },
      updatedAt: Date.now(),
    };
    this.sessions.set(s.flowId, updated);
  }
}
