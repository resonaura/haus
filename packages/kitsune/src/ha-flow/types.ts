/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

export interface HaFlowRuntimeOptions {
  readonly pythonBin?: string;
  readonly configDir?: string;
  readonly depsDir?: string;
  readonly frontendBase?: string;
  readonly componentsOverlayDir?: string;
  readonly autoInstallReqs?: boolean;
  readonly setupOnCreate?: boolean;
  readonly startupTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
}

export interface HaRuntimeEntity {
  readonly entityId: string;
  readonly entryId: string;
  readonly integration: string;
  readonly uniqueId: string;
  readonly name: string;
  readonly domain: string;
  readonly state: string;
  readonly entityCategory?: 'config' | 'diagnostic' | null;
  readonly attributes: Record<string, unknown>;
  readonly deviceId: string;
  readonly deviceName?: string;
  readonly deviceEntryType?: 'service' | null;
  readonly manufacturer?: string;
  readonly model?: string;
  readonly areaId?: string;
  readonly areaName?: string;
}

export interface HaRuntimeEvent {
  readonly sessionId?: string;
  readonly sequence: number;
  readonly entityId: string;
  readonly entryId?: string | null;
  readonly eventType: string;
  readonly at: string;
  readonly data?: Record<string, unknown>;
}

export interface HaEntitySnapshot {
  /** Private owner-to-Hub channel; config payloads must be encrypted before persistence. */
  readonly sessionId?: string;
  readonly entries?: readonly {
    readonly entryId: string;
    readonly state: string;
    readonly reason?: string | null;
    readonly config?: HaSyncEntryInput;
  }[];
  readonly entities: readonly HaRuntimeEntity[];
  readonly events: readonly HaRuntimeEvent[];
  readonly sequence: number;
}

export interface HaSerializedFlowSchemaField {
  readonly name: string;
  readonly type?: string;
  readonly required?: boolean;
  readonly optional?: boolean;
  readonly default?: unknown;
  readonly description?: Record<string, unknown>;
  readonly selector?: Record<string, unknown>;
  readonly options?: readonly unknown[] | Record<string, string>;
  readonly schema?: readonly HaSerializedFlowSchemaField[];
  readonly expanded?: boolean;
  readonly valueMin?: number;
  readonly valueMax?: number;
  readonly value_min?: number;
  readonly value_max?: number;
  readonly multiple?: boolean;
  readonly custom?: boolean;
}

export interface HaRawFlowResult {
  readonly type: string;
  readonly flow_id?: string;
  readonly handler: string;
  readonly step_id?: string;
  readonly data_schema?: readonly HaSerializedFlowSchemaField[];
  readonly errors?: Record<string, string>;
  readonly description_placeholders?: Record<string, string>;
  readonly reason?: string;
  readonly url?: string;
  readonly menu_options?: readonly string[] | Record<string, string>;
  readonly last_step?: boolean | null;
  readonly progress_action?: string;
  readonly translation_domain?: string;
  readonly title?: string;
  readonly result?: Record<string, unknown>;
}

export interface HaCreatedConfigEntry {
  readonly entry_id: string;
  readonly domain: string;
  readonly title: string;
  readonly data: Record<string, unknown>;
  readonly options: Record<string, unknown>;
  readonly unique_id: string | null;
  readonly version: number;
  readonly minor_version: number;
  readonly source: string;
}

export interface HaLocalizedFlowStrings {
  readonly title: string;
  readonly integrationTitle: string;
  readonly flowTitle: string | null;
  readonly stepTitle: string | null;
  readonly description: string | null;
  readonly submitLabel: string | null;
  readonly fieldLabels: Readonly<Record<string, string>>;
  readonly dataDescriptions: Readonly<Record<string, string>>;
  readonly errors: Readonly<Record<string, string>>;
  readonly abortReason: string | null;
  readonly menuOptions: Readonly<Record<string, string>>;
  readonly menuOptionDescriptions: Readonly<Record<string, string>>;
  readonly selectorTranslations: Readonly<Record<string, string>>;
  readonly supportedBy: string | null;
}

export interface HaFlowStepEnvelope {
  readonly invalidData?: boolean;
  readonly errors?: Readonly<Record<string, string>>;
  readonly flowResult?: HaRawFlowResult;
  readonly entry?: HaCreatedConfigEntry | null;
  readonly localized?: HaLocalizedFlowStrings;
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface HaFlowProgressItem {
  readonly flow_id: string;
  readonly handler: string;
  readonly step_id?: string;
  readonly context: {
    readonly source?: string;
    readonly entry_id?: string;
    readonly title_placeholders?: Readonly<Record<string, string>>;
    readonly [key: string]: unknown;
  };
  readonly title: string;
}

export interface HaSyncEntryInput {
  readonly entryId: string;
  readonly domain: string;
  readonly title: string;
  readonly data: Record<string, unknown>;
  readonly options?: Record<string, unknown>;
  readonly uniqueId?: string | null;
  readonly version?: number;
  readonly minorVersion?: number;
  readonly source?: string;
  readonly disabledBy?: string | null;
  readonly subentries?: readonly HaConfigSubentryInput[];
}

export interface HaConfigSubentryInput {
  readonly subentryId: string;
  readonly subentryType: string;
  readonly title: string;
  readonly data: Record<string, unknown>;
  readonly uniqueId?: string | null;
}

export interface HaEntryImport {
  readonly entry: HaSyncEntryInput;
  readonly entities?: readonly Record<string, unknown>[];
  readonly devices?: readonly Record<string, unknown>[];
  readonly areas?: readonly { readonly id: string; readonly name: string }[];
}

export interface HaSyncCredentialInput {
  readonly domain: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly authDomain?: string;
  readonly name?: string;
}

export interface HaSyncStateInput {
  readonly frontendBase?: string;
  readonly setupOnCreate?: boolean;
  readonly entries?: readonly HaSyncEntryInput[];
  readonly areas?: readonly { readonly name: string }[];
  readonly applicationCredentials?: readonly HaSyncCredentialInput[];
}

export interface HaDiscoveryTriggerResult extends HaFlowStepEnvelope {
  readonly outcome: string;
}

export interface HaFlowHealth {
  readonly ok: boolean;
  readonly pythonVersion: string;
  readonly haVersion: string;
  readonly depsDir: string;
  readonly autoInstallReqs: boolean;
  readonly entriesCount: number;
}
