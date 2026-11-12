/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { FlowFormField } from '../device/flow.js';

export type { FlowFormField };

export type FlowStepType = 'form' | 'menu' | 'external' | 'progress' | 'create_entry' | 'abort';

export interface FlowCapabilityRequirement {
  readonly category: 'step_type' | 'selector' | 'runtime' | 'hardware';
  readonly name: string;
  readonly description: string;
}

export interface IntegrationFlowStep {
  readonly type: FlowStepType;
  readonly flowId: string;
  readonly handler: string;
  readonly stepId: string;
  readonly dataSchema?: readonly FlowFormField[];
  readonly errors?: Readonly<Record<string, string>>;
  readonly title?: string;
  readonly description?: string;
  readonly url?: string;
  readonly menuOptions?: readonly string[] | Readonly<Record<string, string>>;
  readonly result?: {
    readonly entryId?: string;
    readonly title?: string;
    readonly deviceId?: string;
  };
  readonly unsupportedRequirements?: readonly FlowCapabilityRequirement[];
}

export interface IntegrationFlowSession {
  readonly flowId: string;
  readonly domain: string;
  readonly source: 'user' | 'discovery' | 'reauth' | 'manual';
  readonly candidateId?: string;
  readonly homeId: string;
  readonly userId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly currentStep: IntegrationFlowStep;
  readonly history: readonly IntegrationFlowStep[];
  readonly context: Readonly<Record<string, unknown>>;
}

export interface FlowInitOptions {
  readonly domain: string;
  readonly source?: 'user' | 'discovery' | 'reauth' | 'manual';
  readonly candidateId?: string;
  readonly homeId: string;
  readonly userId: string;
  readonly manualAddress?: { readonly host: string; readonly port?: number };
  readonly reauthEntryId?: string;
  readonly initialData?: Readonly<Record<string, unknown>>;
}

export interface FlowSubmissionOptions {
  readonly flowId: string;
  readonly homeId: string;
  readonly userId: string;
  readonly stepId?: string;
  readonly values: Readonly<Record<string, unknown>>;
}

export interface FlowCatalogManifest {
  readonly domain: string;
  readonly name: string;
  readonly iot_class?: string;
  readonly config_flow?: boolean;
  readonly integration_type?: string;
  readonly documentation?: string;
  readonly bluetooth?: readonly unknown[];
  readonly zeroconf?: readonly unknown[];
  readonly ssdp?: readonly unknown[];
  readonly dhcp?: readonly unknown[];
  readonly mqtt?: readonly unknown[];
  readonly usb?: readonly unknown[];
  readonly homekit?: Readonly<Record<string, unknown>>;
  readonly single_config_entry?: boolean;
}

export interface FlowCatalogResolver {
  hasDomain(domain: string): boolean;
  getManifest(domain: string): FlowCatalogManifest | undefined;
  getAllDomains?(): readonly string[];
}
