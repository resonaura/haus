/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export interface FormField {
  readonly name: string;
  readonly type?: string;
  readonly required?: boolean;
  readonly default?: unknown;
  readonly selector?: Record<string, unknown>;
  readonly options?: readonly unknown[] | Record<string, string>;
  readonly schema?: readonly FormField[];
  readonly value_min?: number;
  readonly value_max?: number;
  readonly multiple?: boolean;
}

export interface FlowStep {
  readonly type: string;
  readonly flow_id: string;
  readonly handler: string;
  readonly step_id?: string;
  readonly data_schema?: readonly FormField[];
  readonly errors?: Record<string, string>;
  readonly reason?: string;
  readonly title?: string;
  readonly url?: string;
  readonly menu_options?: readonly string[] | Record<string, string>;
  readonly description_placeholders?: Record<string, string>;
  readonly progress_action?: string;
  readonly last_step?: boolean;
  readonly result?: { entry_id?: string; title?: string };
}

export interface FlowProgress {
  readonly flow_id: string;
  readonly handler: string;
  readonly context?: {
    readonly source?: string;
    readonly entry_id?: string;
    readonly title_placeholders?: Record<string, string>;
  };
}

export type FlowSupportStatus =
  'supported' | 'supported-oauth' | 'supported-reauth' | 'unsupported';

export interface FlowCapabilityRequirement {
  readonly category: 'step_type' | 'selector' | 'runtime' | 'hardware';
  readonly name: string;
  readonly description: string;
}

export interface FlowAssessment {
  readonly status: FlowSupportStatus;
  readonly domain: string;
  readonly supported: boolean;
  readonly requiresOAuth: boolean;
  readonly requiresReauth: boolean;
  readonly unsupportedRequirements: readonly FlowCapabilityRequirement[];
  readonly fallbackReason?: string;
  readonly fallbackUrl?: string;
}

export interface IntegrationFlowProfile {
  readonly domain: string;
  readonly title: string;
  readonly defaultSupport: FlowSupportStatus;
  readonly authMethod: 'form' | 'oauth' | 'reauth' | 'hardware' | 'external_service';
  readonly notes?: string;
}
